import { describe, it, expect } from "vitest";
import { stripVibelensStop } from "./hooksConfig.js";

/**
 * Pure cleanup logic for ~/.cursor/hooks.json.
 *
 * VibeLens no longer installs a Cursor `stop` hook — the agent is nudged purely
 * via skills/rules. This migration strips the legacy managed `stop` entry that
 * older versions registered. Mirrors the merge contract it replaced:
 * read-parse-or-ABORT (no-clobber), scoped mutation of only the
 * `_vibelensManaged` entry, idempotent noop when there is nothing of ours to
 * remove, `version` and other entries preserved. No vscode/fs import.
 */
describe("stripVibelensStop", () => {
  it("absent file -> noop (never creates a file)", () => {
    expect(stripVibelensStop(null)).toEqual({ noop: true });
  });

  it("empty string -> noop", () => {
    expect(stripVibelensStop("")).toEqual({ noop: true });
  });

  it("no managed entry -> noop", () => {
    const existing = JSON.stringify({
      version: 1,
      hooks: { stop: [{ command: "user-stop" }] },
    });
    expect(stripVibelensStop(existing)).toEqual({ noop: true });
  });

  it("only managed stop entry -> removes stop and empty hooks, keeps version", () => {
    const existing = JSON.stringify({
      version: 1,
      hooks: { stop: [{ command: "node /old/hook.js", _vibelensManaged: true }] },
    });
    const result = stripVibelensStop(existing);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.version).toBe(1);
      expect(parsed.hooks).toBeUndefined();
    }
  });

  it("managed + user stop -> removes only managed, preserves user + other events", () => {
    const existing = JSON.stringify({
      version: 1,
      hooks: {
        afterFileEdit: [{ command: "user-after" }],
        stop: [
          { command: "user-stop" },
          { command: "node /old/hook.js", _vibelensManaged: true },
        ],
      },
    });
    const result = stripVibelensStop(existing);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.hooks.afterFileEdit).toEqual([{ command: "user-after" }]);
      expect(parsed.hooks.stop).toEqual([{ command: "user-stop" }]);
    }
  });

  it("no-clobber: malformed JSON -> error", () => {
    const result = stripVibelensStop("{ not valid");
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toMatch(/json/i);
    }
  });

  it("no-clobber: non-object root -> error", () => {
    expect(stripVibelensStop('"a string"')).toHaveProperty("error");
  });
});
