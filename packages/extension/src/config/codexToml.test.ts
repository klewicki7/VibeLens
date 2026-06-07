import { describe, it, expect } from "vitest";
import { mergeCodexToml, type McpServerEntry } from "./codexToml.js";

/**
 * Pure config-merge logic for Codex's `~/.codex/config.toml`.
 * Uses TOML format with `[mcp_servers.vibelens]` table.
 * Read-parse-or-ABORT + scoped mutation of only `mcp_servers.vibelens`
 * + idempotency (compared by command+args, no sentinel in TOML).
 * Returns `{ json: tomlString }` (reuses the `json` field for consistency
 * with the applyJsonMerge driver — content is TOML, not JSON).
 * String-in / result-out. No vscode/fs.
 */
const ENTRY: McpServerEntry = {
  command: "npx",
  args: ["-y", "vibelens-mcp"],
};

describe("mergeCodexToml", () => {
  it("fresh file → produces [mcp_servers.vibelens] with command and args", () => {
    const result = mergeCodexToml(null, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      // Must contain the TOML table header and key values.
      // smol-toml serializes arrays with spaces inside brackets: [ "a", "b" ]
      expect(result.json).toContain("[mcp_servers.vibelens]");
      expect(result.json).toContain('command = "npx"');
      // Check both args are present (format may vary by smol-toml version)
      expect(result.json).toContain('"-y"');
      expect(result.json).toContain('"vibelens-mcp"');
    }
  });

  it("preserves other top-level TOML keys", () => {
    const existing = `model = "gpt-4o"\nsome_flag = true\n`;
    const result = mergeCodexToml(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      expect(result.json).toContain("gpt-4o");
      expect(result.json).toContain("[mcp_servers.vibelens]");
    }
  });

  it("preserves other mcp_servers entries", () => {
    const existing = `[mcp_servers.other-tool]\ncommand = "other"\nargs = ["--flag"]\n`;
    const result = mergeCodexToml(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      expect(result.json).toContain("[mcp_servers.other-tool]");
      expect(result.json).toContain("[mcp_servers.vibelens]");
    }
  });

  it("already-configured returns noop (idempotency by command+args)", () => {
    const existing = `[mcp_servers.vibelens]\ncommand = "npx"\nargs = ["-y", "vibelens-mcp"]\n`;
    const result = mergeCodexToml(existing, ENTRY);
    expect(result).toEqual({ noop: true });
  });

  it("updates stale vibelens entry (wrong args)", () => {
    const existing = `[mcp_servers.vibelens]\ncommand = "npx"\nargs = ["-y", "old-pkg"]\n`;
    const result = mergeCodexToml(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      // The new args must contain vibelens-mcp and must NOT contain old-pkg
      expect(result.json).toContain('"vibelens-mcp"');
      expect(result.json).not.toContain('"old-pkg"');
    }
  });

  it("malformed TOML → error (read-parse-or-ABORT)", () => {
    const result = mergeCodexToml("= invalid toml !!!!", ENTRY);
    expect(result).toHaveProperty("error");
  });

  it("empty string → treated as fresh file (creates config)", () => {
    const result = mergeCodexToml("", ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      expect(result.json).toContain("[mcp_servers.vibelens]");
    }
  });
});
