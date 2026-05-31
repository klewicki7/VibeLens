import { describe, it, expect } from "vitest";
import { mergeMcpConfig, type McpServerEntry } from "./mcpConfig.js";

const ENTRY: McpServerEntry = {
  command: "npx",
  args: ["-y", "vibelens-mcp"],
};

/**
 * Pure config-merge logic (design Decision E, spec R10).
 * Read-parse-or-ABORT + scoped merge of only `mcpServers.vibelens` with a
 * `_vibelensManaged: true` sentinel + idempotency. String in, string/result out.
 */
describe("mergeMcpConfig (R10)", () => {
  it("R10-S1: malformed JSON returns an error and never crashes", () => {
    const result = mergeMcpConfig("{ this is not json", ENTRY);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toMatch(/json/i);
    }
  });

  it("R10-S2: preserves other mcpServers keys", () => {
    const existing = JSON.stringify({
      mcpServers: {
        "some-other-tool": { command: "other", args: ["--flag"] },
      },
    });
    const result = mergeMcpConfig(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.mcpServers["some-other-tool"]).toEqual({
        command: "other",
        args: ["--flag"],
      });
    }
  });

  it("R10-S3: preserves top-level non-mcpServers keys", () => {
    const existing = JSON.stringify({
      mcpServers: {},
      theme: "dark",
      misc: { nested: true },
    });
    const result = mergeMcpConfig(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.theme).toBe("dark");
      expect(parsed.misc).toEqual({ nested: true });
    }
  });

  it("R10-S4: already-configured returns a no-op (no rewrite)", () => {
    const existing = JSON.stringify({
      mcpServers: {
        vibelens: {
          command: "npx",
          args: ["-y", "vibelens-mcp"],
          _vibelensManaged: true,
        },
      },
    });
    const result = mergeMcpConfig(existing, ENTRY);
    expect(result).toEqual({ noop: true });
  });

  it("R10-S5: only the vibelens key is mutated; others untouched", () => {
    const existing = JSON.stringify({
      mcpServers: {
        "tool-a": { command: "a", args: [] },
        "tool-b": { command: "b", args: ["x"] },
      },
      topLevel: "keep-me",
    });
    const result = mergeMcpConfig(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.mcpServers["tool-a"]).toEqual({ command: "a", args: [] });
      expect(parsed.mcpServers["tool-b"]).toEqual({ command: "b", args: ["x"] });
      expect(parsed.topLevel).toBe("keep-me");
      // vibelens added with the managed sentinel.
      expect(parsed.mcpServers.vibelens).toEqual({
        command: "npx",
        args: ["-y", "vibelens-mcp"],
        _vibelensManaged: true,
      });
    }
  });

  it("null existing content produces a fresh config with the vibelens entry", () => {
    const result = mergeMcpConfig(null, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.mcpServers.vibelens).toEqual({
        command: "npx",
        args: ["-y", "vibelens-mcp"],
        _vibelensManaged: true,
      });
      // Pretty-printed with 2-space indent.
      expect(result.json).toContain('\n  "mcpServers"');
    }
  });

  it("updates a stale vibelens entry (wrong args) instead of no-op", () => {
    const existing = JSON.stringify({
      mcpServers: {
        vibelens: { command: "npx", args: ["-y", "old-package"] },
      },
    });
    const result = mergeMcpConfig(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.mcpServers.vibelens.args).toEqual(["-y", "vibelens-mcp"]);
      expect(parsed.mcpServers.vibelens._vibelensManaged).toBe(true);
    }
  });

  it("R10-S1: a JSON value that is not an object aborts with an error", () => {
    const result = mergeMcpConfig("[1, 2, 3]", ENTRY);
    expect(result).toHaveProperty("error");
  });
});
