import { describe, it, expect } from "vitest";
import { stripVibelensPostToolUse, CC_MATCHER } from "./claudeSettings.js";

/**
 * Pure cleanup logic for ~/.claude/settings.json.
 *
 * VibeLens no longer installs editor hooks — the agent is nudged purely via
 * skills/rules. This migration strips the legacy managed PostToolUse group that
 * older versions registered. It mirrors the merge contract it replaced:
 * read-parse-or-ABORT (no-clobber on malformed JSON), scoped mutation that only
 * ever touches the `_vibelensManaged` group, idempotent noop when there is
 * nothing of ours to remove. No vscode/fs import.
 */
describe("stripVibelensPostToolUse", () => {
  it("absent file -> noop (never creates a file)", () => {
    expect(stripVibelensPostToolUse(null)).toEqual({ noop: true });
  });

  it("empty string -> noop", () => {
    expect(stripVibelensPostToolUse("")).toEqual({ noop: true });
    expect(stripVibelensPostToolUse("   ")).toEqual({ noop: true });
  });

  it("no managed group -> noop, file left untouched", () => {
    const existing = JSON.stringify({
      hooks: {
        PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "user" }] }],
      },
    });
    expect(stripVibelensPostToolUse(existing)).toEqual({ noop: true });
  });

  it("no hooks at all -> noop", () => {
    const existing = JSON.stringify({ permissions: { allow: ["Read"] } });
    expect(stripVibelensPostToolUse(existing)).toEqual({ noop: true });
  });

  it("only managed group -> removes PostToolUse and empty hooks, preserves other keys", () => {
    const existing = JSON.stringify({
      permissions: { allow: ["Read"] },
      hooks: {
        PostToolUse: [
          {
            matcher: CC_MATCHER,
            _vibelensManaged: true,
            hooks: [{ type: "command", command: "node /old/hook.js", timeout: 30 }],
          },
        ],
      },
    });
    const result = stripVibelensPostToolUse(existing);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.permissions).toEqual({ allow: ["Read"] });
      expect(parsed.hooks).toBeUndefined();
    }
  });

  it("managed + user group -> removes only managed, preserves user group", () => {
    const existing = JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "pre" }] }],
        PostToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "user-cmd" }] },
          {
            matcher: CC_MATCHER,
            _vibelensManaged: true,
            hooks: [{ type: "command", command: "node /old/hook.js", timeout: 30 }],
          },
        ],
      },
    });
    const result = stripVibelensPostToolUse(existing);
    expect(result).toHaveProperty("json");
    if ("json" in result) {
      const parsed = JSON.parse(result.json);
      expect(parsed.hooks.PreToolUse).toEqual([
        { matcher: "Bash", hooks: [{ type: "command", command: "pre" }] },
      ]);
      const groups = parsed.hooks.PostToolUse;
      expect(groups).toHaveLength(1);
      expect(groups[0].matcher).toBe("Bash");
      expect(groups.some((g: any) => g._vibelensManaged === true)).toBe(false);
    }
  });

  it("no-clobber: malformed JSON -> error", () => {
    const result = stripVibelensPostToolUse("{ not valid json");
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toMatch(/json/i);
    }
  });

  it("no-clobber: non-object root -> error", () => {
    expect(stripVibelensPostToolUse("[1,2,3]")).toHaveProperty("error");
  });
});
