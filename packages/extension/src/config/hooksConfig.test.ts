import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { mergeCursorHooks, type CursorHookInput } from "./hooksConfig.js";

/**
 * Pure config-merge logic for ~/.cursor/hooks.json (spec R12).
 * Mirrors mergeMcpConfig: read-parse-or-ABORT (no-clobber), default
 * `{ version: 1 }` when absent, scoped mutation of only the managed `stop`
 * entry, `_vibelensManaged: true` sentinel, idempotency. No vscode/fs import.
 */
const ENTRY: CursorHookInput = {
  command: "node /home/u/.vibelens/hooks/vibelens-hook.js",
};

describe("mergeCursorHooks (R12)", () => {
  it("R12-S1 (fresh): absent file -> version 1 + one managed stop entry", () => {
    const result = mergeCursorHooks(null, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.version).toBe(1);
      expect(Array.isArray(parsed.hooks.stop)).toBe(true);
      expect(parsed.hooks.stop).toHaveLength(1);
      expect(parsed.hooks.stop[0].command).toBe(ENTRY.command);
      expect(parsed.hooks.stop[0]._vibelensManaged).toBe(true);
    }
  });

  it("R12-S2 (preserve): afterFileEdit + user stop entry preserved, managed appended", () => {
    const existing = JSON.stringify({
      version: 1,
      hooks: {
        afterFileEdit: [{ command: "user-after" }],
        stop: [{ command: "user-stop" }],
      },
    });
    const result = mergeCursorHooks(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.hooks.afterFileEdit).toEqual([{ command: "user-after" }]);
      expect(parsed.hooks.stop).toHaveLength(2);
      const userStop = parsed.hooks.stop.find((e: any) => e.command === "user-stop");
      expect(userStop).toBeTruthy();
      const managed = parsed.hooks.stop.filter((e: any) => e._vibelensManaged === true);
      expect(managed).toHaveLength(1);
    }
  });

  it("R12-S3 (idempotent): exact managed stop entry -> noop", () => {
    const existing = JSON.stringify({
      version: 1,
      hooks: {
        stop: [{ command: ENTRY.command, _vibelensManaged: true }],
      },
    });
    const result = mergeCursorHooks(existing, ENTRY);
    expect(result).toEqual({ noop: true });
  });

  it("R12-S4 (update): outdated managed stop replaced in place, exactly one managed", () => {
    const existing = JSON.stringify({
      version: 1,
      hooks: {
        stop: [{ command: "node /old/path.js", _vibelensManaged: true }],
      },
    });
    const result = mergeCursorHooks(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      const managed = parsed.hooks.stop.filter((e: any) => e._vibelensManaged === true);
      expect(managed).toHaveLength(1);
      expect(managed[0].command).toBe(ENTRY.command);
    }
  });

  it("R12-S5 (no-clobber): malformed JSON -> error", () => {
    const result = mergeCursorHooks("{ not valid", ENTRY);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toMatch(/json/i);
    }
  });

  it("R12-S5b (no-clobber): non-object root -> error", () => {
    const result = mergeCursorHooks('"a string"', ENTRY);
    expect(result).toHaveProperty("error");
  });

  it("preserves a non-default version value", () => {
    const existing = JSON.stringify({ version: 2, hooks: {} });
    const result = mergeCursorHooks(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      expect(JSON.parse(result.json).version).toBe(2);
    }
  });

  it("R19-S1/R19.4: the module source imports no vscode", () => {
    const src = fs.readFileSync(
      new URL("./hooksConfig.ts", import.meta.url),
      "utf8"
    );
    expect(src).not.toMatch(/from\s+["']vscode["']/);
  });
});
