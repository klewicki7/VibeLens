// MCP installation target discovery (design Decision, multi-agent fan-out).
//
// `getMcpTargets` returns every AI agent config location where VibeLens should
// install its MCP server. Deps are injected (homedir, dirExists) so this module
// is fully unit-testable without touching the real filesystem.
//
// GLOBAL targets: present when the agent's parent directory exists on disk.
// PROJECT targets: present when workspaceRoot is not null.
//
// NO `vscode`, `fs`, or `os` imports here. String-in / array-out.

import * as path from "path";

/** Format discriminant for the target's config file. */
export type McpTargetFormat =
  | "json-mcpServers"    // Cursor, Windsurf, Gemini, Cline, Roo Code, project files
  | "json-servers"       // VS Code .vscode/mcp.json
  | "json-contextServers" // Zed settings.json
  | "toml-codex";        // Codex config.toml

export interface McpTarget {
  /** Human-readable label for UI messages and logging. */
  name: string;
  /** Absolute path to the config file that should be written. */
  configPath: string;
  /** Serialization format this target expects. */
  format: McpTargetFormat;
  /** Whether this target should be written in the current environment. */
  present: boolean;
}

export interface McpTargetDeps {
  /** Value of `os.homedir()` in the real runtime. */
  homedir: string;
  /**
   * Returns true when the given directory path exists on disk.
   * Injected so tests can control presence without touching real fs.
   */
  dirExists: (dirPath: string) => boolean;
}

/**
 * Returns the complete list of MCP installation targets for VibeLens.
 *
 * @param workspaceRoot absolute path to the open workspace folder, or `null`.
 * @param deps injectable filesystem dependencies.
 */
export function getMcpTargets(
  workspaceRoot: string | null,
  deps: McpTargetDeps
): McpTarget[] {
  const { homedir, dirExists } = deps;

  // --- GLOBAL targets ---
  // Each is present if its parent directory exists, indicating the agent is
  // installed on this machine.

  const clineSettingsDir = path.join(
    homedir,
    "Library", "Application Support", "Code", "User",
    "globalStorage", "saoudrizwan.claude-dev", "settings"
  );

  const rooSettingsDir = path.join(
    homedir,
    "Library", "Application Support", "Code", "User",
    "globalStorage", "rooveterinaryinc.roo-cline", "settings"
  );

  const globalTargets: McpTarget[] = [
    {
      name: "Cursor (global)",
      configPath: path.join(homedir, ".cursor", "mcp.json"),
      format: "json-mcpServers",
      present: dirExists(path.join(homedir, ".cursor")),
    },
    {
      name: "Windsurf",
      configPath: path.join(homedir, ".codeium", "windsurf", "mcp_config.json"),
      format: "json-mcpServers",
      present: dirExists(path.join(homedir, ".codeium", "windsurf")),
    },
    {
      name: "Codex",
      configPath: path.join(homedir, ".codex", "config.toml"),
      format: "toml-codex",
      present: dirExists(path.join(homedir, ".codex")),
    },
    {
      name: "Gemini CLI",
      configPath: path.join(homedir, ".gemini", "settings.json"),
      format: "json-mcpServers",
      present: dirExists(path.join(homedir, ".gemini")),
    },
    {
      name: "Zed",
      configPath: path.join(homedir, ".config", "zed", "settings.json"),
      format: "json-contextServers",
      present: dirExists(path.join(homedir, ".config", "zed")),
    },
    {
      name: "Cline",
      configPath: path.join(clineSettingsDir, "cline_mcp_settings.json"),
      format: "json-mcpServers",
      present: dirExists(clineSettingsDir),
    },
    {
      name: "Roo Code",
      configPath: path.join(rooSettingsDir, "mcp_settings.json"),
      format: "json-mcpServers",
      present: dirExists(rooSettingsDir),
    },
  ];

  // --- PROJECT targets ---
  // Present when a workspace is open. These land in the project root so they
  // are committed alongside the code (per-repo MCP config).

  if (workspaceRoot === null) {
    return globalTargets;
  }

  const projectTargets: McpTarget[] = [
    {
      name: "Claude Code (.mcp.json)",
      configPath: path.join(workspaceRoot, ".mcp.json"),
      format: "json-mcpServers",
      present: true,
    },
    {
      name: "Cursor (project)",
      configPath: path.join(workspaceRoot, ".cursor", "mcp.json"),
      format: "json-mcpServers",
      present: true,
    },
    {
      name: "VS Code (.vscode/mcp.json)",
      configPath: path.join(workspaceRoot, ".vscode", "mcp.json"),
      format: "json-servers",
      present: true,
    },
  ];

  return [...globalTargets, ...projectTargets];
}
