import { describe, it, expect } from "vitest";
import { mergeZedMcp, type McpServerEntry } from "./zedMcp.js";

/**
 * Pure config-merge logic for Zed's `~/.config/zed/settings.json`.
 * Uses `context_servers` root key with `source: "custom"`.
 * Read-parse-or-ABORT + scoped mutation of only `context_servers.vibelens` with a
 * `_vibelensManaged: true` sentinel + idempotency. String-in / result-out. No vscode/fs.
 */
const ENTRY: McpServerEntry = {
  command: "npx",
  args: ["-y", "vibelens-mcp"],
};

describe("mergeZedMcp", () => {
  it("fresh file → produces context_servers.vibelens with source:custom and sentinel", () => {
    const result = mergeZedMcp(null, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.context_servers.vibelens).toEqual({
        source: "custom",
        command: "npx",
        args: ["-y", "vibelens-mcp"],
        _vibelensManaged: true,
      });
    }
  });

  it("uses `context_servers` root key, NOT `mcpServers` or `servers`", () => {
    const result = mergeZedMcp(null, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.mcpServers).toBeUndefined();
      expect(parsed.servers).toBeUndefined();
      expect(parsed.context_servers).toBeDefined();
    }
  });

  it("preserves other context_servers keys", () => {
    const existing = JSON.stringify({
      context_servers: {
        "some-tool": { source: "custom", command: "other", args: [] },
      },
    });
    const result = mergeZedMcp(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.context_servers["some-tool"]).toEqual({ source: "custom", command: "other", args: [] });
      expect(parsed.context_servers.vibelens).toBeDefined();
    }
  });

  it("preserves top-level non-context_servers keys (e.g., Zed theme settings)", () => {
    const existing = JSON.stringify({
      context_servers: {},
      theme: "One Dark",
      font_size: 14,
    });
    const result = mergeZedMcp(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.theme).toBe("One Dark");
      expect(parsed.font_size).toBe(14);
    }
  });

  it("already-configured returns noop", () => {
    const existing = JSON.stringify({
      context_servers: {
        vibelens: {
          source: "custom",
          command: "npx",
          args: ["-y", "vibelens-mcp"],
          _vibelensManaged: true,
        },
      },
    });
    const result = mergeZedMcp(existing, ENTRY);
    expect(result).toEqual({ noop: true });
  });

  it("updates stale vibelens entry (wrong command)", () => {
    const existing = JSON.stringify({
      context_servers: {
        vibelens: { source: "custom", command: "node", args: ["/old/path.js"], _vibelensManaged: true },
      },
    });
    const result = mergeZedMcp(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.context_servers.vibelens.command).toBe("npx");
      expect(parsed.context_servers.vibelens.args).toEqual(["-y", "vibelens-mcp"]);
    }
  });

  it("malformed JSON → error (read-parse-or-ABORT)", () => {
    const result = mergeZedMcp("{not valid", ENTRY);
    expect(result).toHaveProperty("error");
  });

  it("non-object root JSON → error", () => {
    const result = mergeZedMcp("[1,2,3]", ENTRY);
    expect(result).toHaveProperty("error");
  });

  it("pretty-printed with 2-space indent", () => {
    const result = mergeZedMcp(null, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      expect(result.json).toContain('\n  "context_servers"');
    }
  });
});
