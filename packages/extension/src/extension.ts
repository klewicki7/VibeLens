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

const WATCH_DIR = path.join(os.homedir(), ".vibelens");
const WATCH_FILE = path.join(WATCH_DIR, "pending.json");
const DB_PATH = path.join(WATCH_DIR, "vibelens.db");

let reviewReader: ReviewReader | null = null;
let editorAdapter: IEditorAdapter | null = null;

// MCP server configuration
const MCP_SERVER_NAME = "vibelens";
const MCP_COMMAND = "npx";
const MCP_ARGS = ["-y", "vibelens-mcp"];

let fileWatcher: fs.FSWatcher | null = null;
let lastTimestamp = 0;

// Auto-install MCP server in the editor's config (A1 hardening, spec R10).
//
// The pure merge lives in `mergeMcpConfig`: read-parse-or-ABORT (never silently
// reset a malformed file) + scoped mutation of only `mcpServers.vibelens`. Here
// we only do IO: read the raw file (null on ENOENT), delegate the decision, then
// surface errors or write atomically (temp file + rename). Returns true only
// when the file was actually (re)written.
async function ensureMcpServerInstalled(mcpConfigPath: string): Promise<boolean> {
  let existingRaw: string | null = null;
  try {
    existingRaw = fs.readFileSync(mcpConfigPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Failed to read MCP config:", err);
      vscode.window.showErrorMessage(
        "VibeLens: could not read the MCP config file"
      );
      return false;
    }
    // ENOENT → no file yet; treat as a fresh config.
  }

  const result = mergeMcpConfig(existingRaw, {
    command: MCP_COMMAND,
    args: MCP_ARGS,
  });

  if ("error" in result) {
    // Read-parse-or-ABORT (R10-S1): surface and do NOT write.
    vscode.window.showErrorMessage(
      `VibeLens: your MCP config could not be updated — ${result.error}. ` +
        `Please fix ${mcpConfigPath} manually.`
    );
    return false;
  }

  if ("noop" in result) {
    // Already configured correctly (R10-S4): no rewrite.
    return false;
  }

  try {
    fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true });
    // Atomic write: write a temp file then rename so a crash can never leave a
    // half-written config behind.
    const tmpPath = `${mcpConfigPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, result.json, "utf-8");
    fs.renameSync(tmpPath, mcpConfigPath);
    return true;
  } catch (err) {
    console.error("Failed to write MCP config:", err);
    vscode.window.showErrorMessage(
      "VibeLens: could not write the MCP config file"
    );
    return false;
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

  // Auto-install MCP server if editor supports file-based config
  const mcpConfigPath = adapter.getMcpConfigPath();
  if (mcpConfigPath) {
    const wasInstalled = await ensureMcpServerInstalled(mcpConfigPath);
    if (wasInstalled) {
      vscode.window.showInformationMessage(
        `VibeLens MCP server has been configured. Restart ${adapter.name} to enable it.`
      );
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
  DiffExplanationPanel.createOrShow(context.extensionUri, explanation, editorAdapter);
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
