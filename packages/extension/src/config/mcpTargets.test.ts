import { describe, it, expect } from "vitest";
import * as path from "path";
import { getMcpTargets, type McpTarget } from "./mcpTargets.js";

/**
 * Tests for getMcpTargets — discovers all AI agent MCP config paths.
 *
 * Uses injected deps (homedir, dirExists) so no real filesystem is touched.
 * GLOBAL targets: present when their parent directory exists.
 * PROJECT targets: present when workspaceRoot != null.
 */

const HOME = "/Users/testuser";
const WORKSPACE = "/Users/testuser/my-project";

/** Helper: find a target by name */
function findTarget(targets: McpTarget[], name: string): McpTarget | undefined {
  return targets.find((t) => t.name === name);
}

describe("getMcpTargets — global targets", () => {
  it("Cursor global is present when ~/.cursor exists", () => {
    const targets = getMcpTargets(null, {
      homedir: HOME,
      dirExists: (p) => p === path.join(HOME, ".cursor"),
    });
    const t = findTarget(targets, "Cursor (global)");
    expect(t).toBeDefined();
    expect(t!.present).toBe(true);
    expect(t!.format).toBe("json-mcpServers");
    expect(t!.configPath).toBe(path.join(HOME, ".cursor", "mcp.json"));
  });

  it("Cursor global is absent when ~/.cursor does NOT exist", () => {
    const targets = getMcpTargets(null, {
      homedir: HOME,
      dirExists: () => false,
    });
    const t = findTarget(targets, "Cursor (global)");
    expect(t).toBeDefined();
    expect(t!.present).toBe(false);
  });

  it("Windsurf is present when ~/.codeium/windsurf exists", () => {
    const targets = getMcpTargets(null, {
      homedir: HOME,
      dirExists: (p) => p === path.join(HOME, ".codeium", "windsurf"),
    });
    const t = findTarget(targets, "Windsurf");
    expect(t!.present).toBe(true);
    expect(t!.format).toBe("json-mcpServers");
    expect(t!.configPath).toBe(path.join(HOME, ".codeium", "windsurf", "mcp_config.json"));
  });

  it("Codex is present when ~/.codex exists", () => {
    const targets = getMcpTargets(null, {
      homedir: HOME,
      dirExists: (p) => p === path.join(HOME, ".codex"),
    });
    const t = findTarget(targets, "Codex");
    expect(t!.present).toBe(true);
    expect(t!.format).toBe("toml-codex");
    expect(t!.configPath).toBe(path.join(HOME, ".codex", "config.toml"));
  });

  it("Gemini CLI is present when ~/.gemini exists", () => {
    const targets = getMcpTargets(null, {
      homedir: HOME,
      dirExists: (p) => p === path.join(HOME, ".gemini"),
    });
    const t = findTarget(targets, "Gemini CLI");
    expect(t!.present).toBe(true);
    expect(t!.format).toBe("json-mcpServers");
    expect(t!.configPath).toBe(path.join(HOME, ".gemini", "settings.json"));
  });

  it("Zed is present when ~/.config/zed exists", () => {
    const targets = getMcpTargets(null, {
      homedir: HOME,
      dirExists: (p) => p === path.join(HOME, ".config", "zed"),
    });
    const t = findTarget(targets, "Zed");
    expect(t!.present).toBe(true);
    expect(t!.format).toBe("json-contextServers");
    expect(t!.configPath).toBe(path.join(HOME, ".config", "zed", "settings.json"));
  });

  it("Cline is present when its parent dir exists", () => {
    const clineDir = path.join(
      HOME, "Library", "Application Support", "Code", "User",
      "globalStorage", "saoudrizwan.claude-dev", "settings"
    );
    const targets = getMcpTargets(null, {
      homedir: HOME,
      dirExists: (p) => p === clineDir,
    });
    const t = findTarget(targets, "Cline");
    expect(t!.present).toBe(true);
    expect(t!.format).toBe("json-mcpServers");
    expect(t!.configPath).toBe(path.join(clineDir, "cline_mcp_settings.json"));
  });

  it("Roo Code is present when its parent dir exists", () => {
    const rooDir = path.join(
      HOME, "Library", "Application Support", "Code", "User",
      "globalStorage", "rooveterinaryinc.roo-cline", "settings"
    );
    const targets = getMcpTargets(null, {
      homedir: HOME,
      dirExists: (p) => p === rooDir,
    });
    const t = findTarget(targets, "Roo Code");
    expect(t!.present).toBe(true);
    expect(t!.format).toBe("json-mcpServers");
    expect(t!.configPath).toBe(path.join(rooDir, "mcp_settings.json"));
  });

  it("no global targets present when no dirs exist", () => {
    const targets = getMcpTargets(null, {
      homedir: HOME,
      dirExists: () => false,
    });
    const presentGlobals = targets.filter((t) => !t.configPath.startsWith(WORKSPACE) && t.present);
    expect(presentGlobals).toHaveLength(0);
  });
});

describe("getMcpTargets — project targets", () => {
  it("project targets absent when workspaceRoot is null", () => {
    const targets = getMcpTargets(null, {
      homedir: HOME,
      dirExists: () => false,
    });
    const projectTargets = targets.filter((t) =>
      ["Claude Code (.mcp.json)", "Cursor (project)", "VS Code (.vscode/mcp.json)"].includes(t.name)
    );
    expect(projectTargets.every((t) => !t.present)).toBe(true);
  });

  it("project targets present when workspaceRoot is set", () => {
    const targets = getMcpTargets(WORKSPACE, {
      homedir: HOME,
      dirExists: () => false,
    });
    const t1 = findTarget(targets, "Claude Code (.mcp.json)");
    const t2 = findTarget(targets, "Cursor (project)");
    const t3 = findTarget(targets, "VS Code (.vscode/mcp.json)");
    expect(t1!.present).toBe(true);
    expect(t2!.present).toBe(true);
    expect(t3!.present).toBe(true);
  });

  it("Claude Code (.mcp.json) has correct path and format", () => {
    const targets = getMcpTargets(WORKSPACE, { homedir: HOME, dirExists: () => false });
    const t = findTarget(targets, "Claude Code (.mcp.json)");
    expect(t!.configPath).toBe(path.join(WORKSPACE, ".mcp.json"));
    expect(t!.format).toBe("json-mcpServers");
  });

  it("Cursor (project) has correct path and format", () => {
    const targets = getMcpTargets(WORKSPACE, { homedir: HOME, dirExists: () => false });
    const t = findTarget(targets, "Cursor (project)");
    expect(t!.configPath).toBe(path.join(WORKSPACE, ".cursor", "mcp.json"));
    expect(t!.format).toBe("json-mcpServers");
  });

  it("VS Code project target has `json-servers` format", () => {
    const targets = getMcpTargets(WORKSPACE, { homedir: HOME, dirExists: () => false });
    const t = findTarget(targets, "VS Code (.vscode/mcp.json)");
    expect(t!.configPath).toBe(path.join(WORKSPACE, ".vscode", "mcp.json"));
    expect(t!.format).toBe("json-servers");
  });
});

describe("getMcpTargets — combined", () => {
  it("returns all 10 targets (7 global + 3 project) when workspace is set", () => {
    const targets = getMcpTargets(WORKSPACE, { homedir: HOME, dirExists: () => false });
    expect(targets).toHaveLength(10);
  });

  it("returns 7 global targets (all absent) when no workspace", () => {
    const targets = getMcpTargets(null, { homedir: HOME, dirExists: () => false });
    expect(targets).toHaveLength(7);
  });
});
