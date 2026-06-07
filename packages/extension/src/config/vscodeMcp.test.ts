import { describe, it, expect } from "vitest";
import { mergeVscodeMcp, type McpServerEntry } from "./vscodeMcp.js";

/**
 * Pure config-merge logic for VS Code's `.vscode/mcp.json` (design Decision E).
 * Uses `servers` root key (not `mcpServers`) with `type: "stdio"`.
 * Read-parse-or-ABORT + scoped mutation of only `servers.vibelens` with a
 * `_vibelensManaged: true` sentinel + idempotency. String-in / result-out. No vscode/fs.
 */
const ENTRY: McpServerEntry = {
  command: "npx",
  args: ["-y", "vibelens-mcp"],
};

describe("mergeVscodeMcp", () => {
  it("fresh file → produces servers.vibelens with type:stdio and sentinel", () => {
    const result = mergeVscodeMcp(null, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.servers.vibelens).toEqual({
        type: "stdio",
        command: "npx",
        args: ["-y", "vibelens-mcp"],
        _vibelensManaged: true,
      });
    }
  });

  it("uses `servers` root key, NOT `mcpServers`", () => {
    const result = mergeVscodeMcp(null, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.mcpServers).toBeUndefined();
      expect(parsed.servers).toBeDefined();
    }
  });

  it("preserves other servers keys", () => {
    const existing = JSON.stringify({
      servers: {
        "other-tool": { type: "stdio", command: "other", args: [] },
      },
    });
    const result = mergeVscodeMcp(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.servers["other-tool"]).toEqual({ type: "stdio", command: "other", args: [] });
      expect(parsed.servers.vibelens).toBeDefined();
    }
  });

  it("preserves top-level non-servers keys", () => {
    const existing = JSON.stringify({
      servers: {},
      version: "1.0",
    });
    const result = mergeVscodeMcp(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.version).toBe("1.0");
    }
  });

  it("already-configured returns noop", () => {
    const existing = JSON.stringify({
      servers: {
        vibelens: {
          type: "stdio",
          command: "npx",
          args: ["-y", "vibelens-mcp"],
          _vibelensManaged: true,
        },
      },
    });
    const result = mergeVscodeMcp(existing, ENTRY);
    expect(result).toEqual({ noop: true });
  });

  it("updates stale vibelens entry (wrong args)", () => {
    const existing = JSON.stringify({
      servers: {
        vibelens: { type: "stdio", command: "npx", args: ["-y", "old-pkg"], _vibelensManaged: true },
      },
    });
    const result = mergeVscodeMcp(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.servers.vibelens.args).toEqual(["-y", "vibelens-mcp"]);
    }
  });

  it("malformed JSON → error (read-parse-or-ABORT)", () => {
    const result = mergeVscodeMcp("{not valid", ENTRY);
    expect(result).toHaveProperty("error");
  });

  it("non-object root JSON → error", () => {
    const result = mergeVscodeMcp("[1,2,3]", ENTRY);
    expect(result).toHaveProperty("error");
  });

  it("pretty-printed with 2-space indent", () => {
    const result = mergeVscodeMcp(null, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      expect(result.json).toContain('\n  "servers"');
    }
  });
});
