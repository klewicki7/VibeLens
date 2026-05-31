import { describe, it, expect } from "vitest";
import {
  mergeClaudeSettings,
  CC_MATCHER,
  type ClaudeHookInput,
} from "./claudeSettings.js";

/**
 * Pure config-merge logic for ~/.claude/settings.json (spec R11).
 * Mirrors mergeMcpConfig: read-parse-or-ABORT (no-clobber), scoped mutation of
 * only the managed PostToolUse group, `_vibelensManaged: true` sentinel,
 * idempotency. String/JSON in -> discriminated-union out. No vscode/fs import.
 */
const ENTRY: ClaudeHookInput = {
  command: "node /home/u/.vibelens/hooks/vibelens-hook.js",
};

describe("mergeClaudeSettings (R11)", () => {
  it("R11-S1 (fresh): absent file -> one managed PostToolUse group", () => {
    const result = mergeClaudeSettings(null, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      const groups = parsed.hooks.PostToolUse;
      expect(Array.isArray(groups)).toBe(true);
      expect(groups).toHaveLength(1);
      expect(groups[0].matcher).toBe(CC_MATCHER);
      expect(groups[0]._vibelensManaged).toBe(true);
      const inner = groups[0].hooks[0];
      expect(inner.type).toBe("command");
      expect(inner.command).toBe(ENTRY.command);
      expect(inner.timeout).toBe(30);
    }
  });

  it("R11-S2 (preserve): unrelated PreToolUse + top-level permissions preserved", () => {
    const existing = JSON.stringify({
      permissions: { allow: ["Read"] },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
      },
    });
    const result = mergeClaudeSettings(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.permissions).toEqual({ allow: ["Read"] });
      expect(parsed.hooks.PreToolUse).toEqual([
        { matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] },
      ]);
      expect(parsed.hooks.PostToolUse).toHaveLength(1);
      expect(parsed.hooks.PostToolUse[0]._vibelensManaged).toBe(true);
    }
  });

  it("R11-S2b (preserve): non-VibeLens PostToolUse entries preserved", () => {
    const existing = JSON.stringify({
      hooks: {
        PostToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "user-cmd" }] },
        ],
      },
    });
    const result = mergeClaudeSettings(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      const groups = parsed.hooks.PostToolUse;
      expect(groups).toHaveLength(2);
      const userGroup = groups.find((g: any) => g.matcher === "Bash");
      expect(userGroup.hooks[0].command).toBe("user-cmd");
      const managed = groups.filter((g: any) => g._vibelensManaged === true);
      expect(managed).toHaveLength(1);
    }
  });

  it("R11-S3 (idempotent): exact managed entry -> noop", () => {
    const existing = JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            matcher: CC_MATCHER,
            _vibelensManaged: true,
            hooks: [{ type: "command", command: ENTRY.command, timeout: 30 }],
          },
        ],
      },
    });
    const result = mergeClaudeSettings(existing, ENTRY);
    expect(result).toEqual({ noop: true });
  });

  it("R11-S4 (update): outdated managed command replaced in place, exactly one managed group", () => {
    const existing = JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            matcher: CC_MATCHER,
            _vibelensManaged: true,
            hooks: [{ type: "command", command: "node /old/path.js", timeout: 30 }],
          },
        ],
      },
    });
    const result = mergeClaudeSettings(existing, ENTRY);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      const managed = parsed.hooks.PostToolUse.filter(
        (g: any) => g._vibelensManaged === true
      );
      expect(managed).toHaveLength(1);
      expect(managed[0].hooks[0].command).toBe(ENTRY.command);
    }
  });

  it("R11-S5 (no-clobber): malformed JSON -> error", () => {
    const result = mergeClaudeSettings("{ not valid json", ENTRY);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toMatch(/json/i);
    }
  });

  it("R11-S5b (no-clobber): non-object root -> error", () => {
    const result = mergeClaudeSettings("[1,2,3]", ENTRY);
    expect(result).toHaveProperty("error");
  });

  it("honors a custom timeout when provided", () => {
    const result = mergeClaudeSettings(null, { command: ENTRY.command, timeout: 45 });
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.hooks.PostToolUse[0].hooks[0].timeout).toBe(45);
    }
  });
});
