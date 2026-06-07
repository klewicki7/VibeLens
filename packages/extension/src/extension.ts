import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { DiffExplanationPanel } from "./webviewProvider";
import { parseSignal, type SignalFile } from "./signal/schema";
import { createReviewReader, type ReviewReader } from "./db/reader";
import { mapToDiffExplanation } from "./db/mapRow";
import { resolveAdapter, type IEditorAdapter } from "./editor/adapter";
import { mergeMcpConfig } from "./config/mcpConfig";
import { mergeVscodeMcp } from "./config/vscodeMcp";
import { mergeZedMcp } from "./config/zedMcp";
import { mergeCodexToml } from "./config/codexToml";
import { getMcpTargets } from "./config/mcpTargets";
import { resolveMcpCommand } from "./config/mcpCommand";
import { stripVibelensPostToolUse } from "./config/claudeSettings";
import { stripVibelensStop } from "./config/hooksConfig";
import { mergeTextSection } from "./config/textSection";

const WATCH_DIR = path.join(os.homedir(), ".vibelens");
const WATCH_FILE = path.join(WATCH_DIR, "pending.json");
const DB_PATH = path.join(WATCH_DIR, "vibelens.db");

// Legacy directory where older versions installed the bundled Node hook. VibeLens
// no longer installs editor hooks; activation deletes this on cleanup.
const LEGACY_HOOK_DIR = path.join(WATCH_DIR, "hooks");

// Canonical rule injected into CLAUDE.md / AGENTS.md / .cursor/rules. This is the
// single source of truth for the agent nudge: the tool fires only when the agent
// actually changed code, never on read-only questions or an empty diff.
const VIBELENS_RULE_BODY = [
  "## VibeLens — Auto-explain changes",
  "After you modify files in this repo, call the `show_diff_explanation` MCP tool with the output of `git diff HEAD` and a brief per-file analysis (what changed and why). Batch all edits from one task into a single call. Only call it when you actually changed code — skip it for questions, reviews, or when `git diff HEAD` is empty. Do not commit as part of this.",
].join("\n");

let reviewReader: ReviewReader | null = null;
let editorAdapter: IEditorAdapter | null = null;

let fileWatcher: fs.FSWatcher | null = null;
let lastTimestamp = 0;

// Atomic write: temp file + rename so a crash can never leave a half-written
// file behind (shared Slice-3 pattern). Throws on failure so callers in
// activate() can catch + surface a scoped warning (R18).
function atomicWrite(destPath: string, contents: string): void {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, contents, "utf-8");
  fs.renameSync(tmpPath, destPath);
}

// Reads a config file as a string, returning null on ENOENT (fresh file). Any
// other read error is rethrown so the guarded install step surfaces it (R18).
function readConfigOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

type JsonMergeResult =
  | { json: string }
  | { error: string }
  | { noop: true };

// Shared driver for the JSON-merge install steps (Claude settings, Cursor
// hooks). Read-parse-or-ABORT on `{ error }` (no-clobber), skip on `{ noop }`,
// atomic-write on `{ json }`. Returns true only when the file was (re)written.
function applyJsonMerge(
  label: string,
  filePath: string,
  merge: (raw: string | null) => JsonMergeResult
): boolean {
  const existingRaw = readConfigOrNull(filePath);
  const result = merge(existingRaw);

  if ("error" in result) {
    vscode.window.showErrorMessage(
      `VibeLens: could not update ${label} — ${result.error}. ` +
        `Please fix ${filePath} manually.`
    );
    return false;
  }
  if ("noop" in result) {
    return false;
  }
  atomicWrite(filePath, result.json);
  return true;
}

// Marker-delimited text merge install step (CLAUDE.md / .cursor/rules). Text
// merges never error; noop is skipped, otherwise atomic-write (R15).
function applyTextSection(filePath: string, body: string): boolean {
  const existingRaw = readConfigOrNull(filePath);
  const result = mergeTextSection(existingRaw, body);
  if ("noop" in result) {
    return false;
  }
  atomicWrite(filePath, result.text);
  return true;
}

// Installs a bundled asset (read from out/assets/<srcRel>) to an absolute
// destination, version-stamped for idempotent upgrades (design Decision D).
//
// - The source's first line carries `// vibelens-asset-version: <N>`; we only
//   (re)install when the dest is missing or its stamp differs.
// - A dest that EXISTS but lacks our stamp marker is treated as user-owned: we
//   warn and skip rather than clobber it.
// - Writes are atomic (temp + rename). Throws on fs failure so the caller's
//   guard can surface a scoped warning and continue (R18).
//
// Returns true when the asset was (re)installed, false when skipped (current /
// user-owned / source absent).
const ASSET_VERSION_RE = /vibelens-asset-version:\s*(\d+)/;

function readAssetVersion(contents: string): string | null {
  const match = contents.match(ASSET_VERSION_RE);
  return match ? match[1] : null;
}

function installAsset(
  context: vscode.ExtensionContext,
  srcRel: string,
  destAbs: string
): boolean {
  const srcPath = path.join(context.extensionUri.fsPath, "out", "assets", srcRel);

  let srcContents: string;
  try {
    srcContents = fs.readFileSync(srcPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Source asset not bundled (e.g. content lands in a later PR) — skip
      // quietly rather than hard-fail (R18, tolerant-of-absence).
      console.warn(`VibeLens: bundled asset ${srcRel} not found; skipping install.`);
      return false;
    }
    throw err;
  }

  const srcVersion = readAssetVersion(srcContents);

  let destContents: string | null = null;
  try {
    destContents = fs.readFileSync(destAbs, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  if (destContents !== null) {
    const destVersion = readAssetVersion(destContents);
    if (destVersion === null) {
      // User-owned file lacking our stamp — never clobber.
      vscode.window.showWarningMessage(
        `VibeLens: ${destAbs} exists but is not VibeLens-managed; leaving it untouched.`
      );
      return false;
    }
    if (destVersion === srcVersion) {
      // Already current — idempotent skip.
      return false;
    }
  }

  atomicWrite(destAbs, srcContents);
  return true;
}

// Runs one install step under its own guard so a single failure surfaces a
// scoped warning but never aborts the remaining steps or activate() (R18).
function guardedInstall(label: string, step: () => void): void {
  try {
    step();
  } catch (err) {
    console.error(`VibeLens: ${label} install failed:`, err);
    vscode.window.showErrorMessage(`VibeLens: ${label} setup failed — ${String(err)}`);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const adapter = resolveAdapter(vscode.env.appName);
  editorAdapter = adapter;
  console.log(`VibeLens extension activated in ${adapter.name}`);

  // Ensure watch directory exists
  if (!fs.existsSync(WATCH_DIR)) {
    fs.mkdirSync(WATCH_DIR, { recursive: true });
  }

  // Initialise the read-only DB reader. The sql.js wasm binary is bundled into
  // out/ at build time and located by filesystem path (Decision A).
  reviewReader = createReviewReader(
    () => path.join(context.extensionUri.fsPath, "out", "sql-wasm.wasm"),
    DB_PATH
  );

  // Workspace root used both for MCP project targets (below) and for rule files
  // (step 4). Resolved once here so both blocks share the same value.
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;

  // --- Enforcement install (design Decision E): four INDEPENDENT guarded steps.
  // Each runs under its own try/catch so one failure (e.g. missing ~/.claude on
  // a Cursor-only machine) never aborts the others or activate() itself (R18).
  // The bundled hook script is installed BEFORE any config that references its
  // path so the registered command always points at a real file.

  // (1) MCP fan-out: install the VibeLens MCP server in EVERY detected AI agent
  // config (global + project). Each target runs under its own guardedInstall so
  // one failure never aborts the others (R18). The correct serializer is chosen
  // by target.format; idempotency, ABORT-on-corrupt, and atomic writes are
  // preserved for every target.
  {
    const { command, args } = resolveMcpCommand({
      distPath: process.env.VIBELENS_MCP_DIST,
      siblingDistExists: (p) =>
        fs.existsSync(path.join(context.extensionUri.fsPath, p)),
    });

    const targets = getMcpTargets(workspaceRoot, {
      homedir: os.homedir(),
      dirExists: (p) => fs.existsSync(p),
    });

    const installedNames: string[] = [];

    for (const target of targets.filter((t) => t.present)) {
      guardedInstall(`MCP: ${target.name}`, () => {
        let wrote = false;

        if (target.format === "toml-codex") {
          // TOML path: use applyJsonMerge but the merge fn returns TOML text
          // in the `json` field (design decision: reuse the driver field name).
          wrote = applyJsonMerge(target.name, target.configPath, (raw) =>
            mergeCodexToml(raw, { command, args })
          );
        } else if (target.format === "json-servers") {
          wrote = applyJsonMerge(target.name, target.configPath, (raw) =>
            mergeVscodeMcp(raw, { command, args })
          );
        } else if (target.format === "json-contextServers") {
          wrote = applyJsonMerge(target.name, target.configPath, (raw) =>
            mergeZedMcp(raw, { command, args })
          );
        } else {
          // json-mcpServers: Cursor, Windsurf, Gemini, Cline, Roo Code, Claude Code
          wrote = applyJsonMerge(target.name, target.configPath, (raw) =>
            mergeMcpConfig(raw, { command, args })
          );
        }

        if (wrote) {
          installedNames.push(target.name);
        }
      });
    }

    // Single summary message after all installs: only show when ≥1 target was
    // actually (re)written. Lists the agent names so the user knows what changed.
    if (installedNames.length > 0) {
      vscode.window.showInformationMessage(
        `VibeLens MCP configured in ${installedNames.length} agent(s): ${installedNames.join(", ")}. Restart the agent to activate it.`
      );
    }
  }

  // (2) Legacy hook cleanup: VibeLens no longer installs editor hooks. Older
  // versions registered a Cursor `stop` hook and a Claude Code PostToolUse hook
  // that fired on EVERY turn — invasive, since they nudged even when the agent
  // only answered a question. Strip those managed entries and delete the bundled
  // hook script. Each strip is idempotent (a config with no managed entry is a
  // noop) and never creates a file, so this is safe to run on every activation.
  const hooksConfigPath = adapter.getHooksConfigPath();
  if (hooksConfigPath) {
    guardedInstall("Cursor hook cleanup", () => {
      applyJsonMerge("Cursor hooks", hooksConfigPath, (raw) => stripVibelensStop(raw));
    });
  }
  const claudeSettingsPath = adapter.getClaudeSettingsPath();
  if (claudeSettingsPath) {
    guardedInstall("Claude Code hook cleanup", () => {
      applyJsonMerge("Claude Code settings", claudeSettingsPath, (raw) =>
        stripVibelensPostToolUse(raw)
      );
    });
  }
  guardedInstall("Legacy hook script cleanup", () => {
    fs.rmSync(LEGACY_HOOK_DIR, { recursive: true, force: true });
  });

  // (3) Claude Code skill: agent guidance teaching the show_diff_explanation
  // signature. Version-stamped install, tolerant of a missing bundled asset.
  const skillInstallPath = adapter.getSkillInstallPath();
  if (skillInstallPath) {
    guardedInstall("Claude Code skill", () => {
      installAsset(context, "skills/vibelens-explain-changes/SKILL.md", skillInstallPath);
    });
  }

  // (4) Rule files: the marker-delimited block in the workspace CLAUDE.md and
  // AGENTS.md (universal agent nudge), plus the .cursor/rules/vibelens.mdc
  // template under Cursor. workspaceRoot was resolved at the top of activate()
  // for the MCP fan-out. AGENTS.md is auto-written alongside CLAUDE.md so
  // non-Claude agents (Codex, etc.) get the same nudge.
  if (workspaceRoot) {
    guardedInstall("CLAUDE.md rule", () => {
      applyTextSection(path.join(workspaceRoot, "CLAUDE.md"), VIBELENS_RULE_BODY);
    });
    guardedInstall("AGENTS.md rule", () => {
      applyTextSection(path.join(workspaceRoot, "AGENTS.md"), VIBELENS_RULE_BODY);
    });
    const cursorRulesPath = adapter.getCursorRulesPath(workspaceRoot);
    if (cursorRulesPath) {
      guardedInstall("Cursor rule", () => {
        installAsset(context, "rules/vibelens.mdc", cursorRulesPath);
      });
    }
  }

  // Register command to manually show panel
  const showPanelCommand = vscode.commands.registerCommand(
    "vibelens.showPanel",
    async () => {
      const shown = await loadAndShowFromSignal(context, { enforceWorkspace: false });
      if (!shown) {
        vscode.window.showInformationMessage(
          "No pending diff explanation found."
        );
      }
    }
  );
  context.subscriptions.push(showPanelCommand);

  // Register URI handler for deep links
  // Works with: vscode://VladTansky.vibelens-extension/show
  //         or: cursor://VladTansky.vibelens-extension/show
  //         or: windsurf://VladTansky.vibelens-extension/show
  const uriHandler = vscode.window.registerUriHandler({
    async handleUri(uri: vscode.Uri) {
      if (uri.path === "/show" || uri.path === "") {
        const shown = await loadAndShowFromSignal(context, { enforceWorkspace: false });
        if (!shown) {
          vscode.window.showInformationMessage(
            "No pending diff explanation found."
          );
        }
      }
    },
  });
  context.subscriptions.push(uriHandler);

  // Start file watcher
  startFileWatcher(context);

  // Check for an existing signal on activation.
  await loadAndShowFromSignal(context, { enforceWorkspace: true });
}

function startFileWatcher(context: vscode.ExtensionContext) {
  // Watch the directory for changes
  try {
    fileWatcher = fs.watch(WATCH_DIR, (eventType, filename) => {
      if (filename === "pending.json") {
        handleFileChange(context);
      }
    });

    context.subscriptions.push({
      dispose: () => {
        if (fileWatcher) {
          fileWatcher.close();
          fileWatcher = null;
        }
      },
    });
  } catch (err) {
    console.error("Failed to start file watcher:", err);
  }
}

function handleFileChange(context: vscode.ExtensionContext) {
  // Debounce rapid changes
  setTimeout(() => {
    void loadAndShowFromSignal(context, { enforceWorkspace: true, notify: true });
  }, 100);
}

/**
 * Reads the signal file, validates it, applies workspace + timestamp guards,
 * reads the full review from SQLite, maps it to a DiffExplanation and renders
 * the panel. Returns true when a panel was shown.
 *
 * The signal is a pointer only — the review payload comes from the validated
 * DB read, replacing the previous unvalidated JSON.parse of the full review.
 */
async function loadAndShowFromSignal(
  context: vscode.ExtensionContext,
  options: { enforceWorkspace: boolean; notify?: boolean }
): Promise<boolean> {
  const signal = readSignalFile();
  if (!signal) {
    return false;
  }

  // Freshness guard: ignore signals we have already rendered.
  if (signal.timestamp <= lastTimestamp) {
    return false;
  }

  // Workspace filtering (R3-S3): only render in the matching window.
  if (options.enforceWorkspace && !isWorkspaceMatch(signal.workspacePath)) {
    return false;
  }

  if (!reviewReader || !editorAdapter) {
    return false;
  }

  let bundle: Awaited<ReturnType<ReviewReader["getReview"]>>;
  try {
    bundle = await reviewReader.getReview(signal.reviewId);
  } catch (err) {
    console.error("VibeLens: failed to read review:", err);
    vscode.window.showErrorMessage("VibeLens: could not read review");
    return false;
  }

  if (!bundle) {
    return false;
  }

  const explanation = mapToDiffExplanation(bundle.review, bundle.annotations, signal);
  lastTimestamp = signal.timestamp;
  // Active-project source for the history filter is the just-shown review
  // (ADR-1 / design §4): the review carries the project the history must match.
  DiffExplanationPanel.createOrShow(context.extensionUri, explanation, editorAdapter, {
    reviewId: bundle.review.id,
    projectName: bundle.review.project_name,
    reader: reviewReader,
  });
  if (options.notify) {
    vscode.window.showInformationMessage("New diff explanation received!");
  }
  return true;
}

function readSignalFile(): SignalFile | null {
  try {
    if (!fs.existsSync(WATCH_FILE)) {
      return null;
    }
    const content = fs.readFileSync(WATCH_FILE, "utf-8");
    return parseSignal(content);
  } catch (err) {
    console.error("Failed to read signal file:", err);
    return null;
  }
}

function isWorkspaceMatch(workspacePath: string | undefined): boolean {
  // If no workspace path specified, show in all windows (backwards compatible)
  if (!workspacePath) {
    return true;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return false;
  }

  // Check if any workspace folder matches the signal's workspace path
  const normalizedDataPath = workspacePath.replace(/\/$/, "").toLowerCase();
  return workspaceFolders.some((folder) => {
    const normalizedFolderPath = folder.uri.fsPath.replace(/\/$/, "").toLowerCase();
    return normalizedFolderPath === normalizedDataPath;
  });
}

export function deactivate() {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
  reviewReader = null;
  editorAdapter = null;
}
