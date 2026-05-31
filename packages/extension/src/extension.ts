import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { DiffExplanationPanel } from "./webviewProvider";
import { parseSignal, type SignalFile } from "./signal/schema";
import { createReviewReader, type ReviewReader } from "./db/reader";
import { mapToDiffExplanation } from "./db/mapRow";
import { resolveAdapter } from "./editor/adapter";

const WATCH_DIR = path.join(os.homedir(), ".vibelens");
const WATCH_FILE = path.join(WATCH_DIR, "pending.json");
const DB_PATH = path.join(WATCH_DIR, "vibelens.db");

let reviewReader: ReviewReader | null = null;

// MCP server configuration
const MCP_SERVER_NAME = "vibelens";
const MCP_COMMAND = "npx";
const MCP_ARGS = ["-y", "vibelens-mcp"];

let fileWatcher: fs.FSWatcher | null = null;
let lastTimestamp = 0;

type McpServerConfig = {
  command: string;
  args: string[];
};

type McpConfig = {
  mcpServers: Record<string, McpServerConfig>;
};

// Auto-install MCP server in editor's config
async function ensureMcpServerInstalled(mcpConfigPath: string): Promise<boolean> {
  try {
    let config: McpConfig = { mcpServers: {} };

    // Read existing config if it exists
    if (fs.existsSync(mcpConfigPath)) {
      try {
        const content = fs.readFileSync(mcpConfigPath, "utf-8");
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === "object" && parsed.mcpServers) {
          config = parsed as McpConfig;
        }
      } catch {
        // Invalid JSON, will create new config
      }
    }

    // Check if already configured
    const existingServer = config.mcpServers[MCP_SERVER_NAME];
    if (
      existingServer &&
      existingServer.command === MCP_COMMAND &&
      JSON.stringify(existingServer.args) === JSON.stringify(MCP_ARGS)
    ) {
      return false; // Already configured correctly
    }

    // Add/update server config
    config.mcpServers[MCP_SERVER_NAME] = {
      command: MCP_COMMAND,
      args: MCP_ARGS,
    };

    // Ensure directory exists and write config
    fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true });
    fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2), "utf-8");

    return true; // Config was updated
  } catch (err) {
    console.error("Failed to configure MCP server:", err);
    return false;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const adapter = resolveAdapter(vscode.env.appName);
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

  if (!reviewReader) {
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
  DiffExplanationPanel.createOrShow(context.extensionUri, explanation);
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
}
