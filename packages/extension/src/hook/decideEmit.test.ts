import { describe, it, expect } from "vitest";
import { decideEmit, renderCc, renderStop, type HookInput } from "./decideEmit";

const ccInput: HookInput = {
  hook_event_name: "PostToolUse",
  cwd: "/repo",
  tool_input: { file_path: "/repo/src/a.ts" },
};

const stopInput: HookInput = {
  hook_event_name: "stop",
  workspace_roots: ["/repo"],
  conversation_id: "conv-1",
};

describe("decideEmit (R13)", () => {
  it("R13-S1: PostToolUse with file + cwd + non-empty diff -> cc", () => {
    const d = decideEmit(ccInput, true, false);
    expect(d).toEqual({ kind: "cc", file: "/repo/src/a.ts" });
  });

  it("R13-S2: stop with workspace root + non-empty diff + no sentinel -> stop", () => {
    const d = decideEmit(stopInput, true, false);
    expect(d).toEqual({ kind: "stop", convo: "conv-1" });
  });

  it("R13-S3 (clean repo, CC): empty diff -> none", () => {
    expect(decideEmit(ccInput, false, false)).toEqual({ kind: "none" });
  });

  it("R13-S3 (clean repo, stop): empty diff -> none", () => {
    expect(decideEmit(stopInput, false, false)).toEqual({ kind: "none" });
  });

  it("R13-S4: stop already fired (sentinel exists) -> none", () => {
    expect(decideEmit(stopInput, true, true)).toEqual({ kind: "none" });
  });

  it("R13-S5 (CC bad input): missing file_path -> none", () => {
    const bad: HookInput = { hook_event_name: "PostToolUse", cwd: "/repo" };
    expect(decideEmit(bad, true, false)).toEqual({ kind: "none" });
  });

  it("R13-S5 (CC bad input): missing cwd -> none", () => {
    const bad: HookInput = {
      hook_event_name: "PostToolUse",
      tool_input: { file_path: "/repo/a.ts" },
    };
    expect(decideEmit(bad, true, false)).toEqual({ kind: "none" });
  });

  it("R13-S5 (stop bad input): missing workspace_roots -> none", () => {
    const bad: HookInput = { hook_event_name: "stop", conversation_id: "c" };
    expect(decideEmit(bad, true, false)).toEqual({ kind: "none" });
  });

  it("unknown event -> none", () => {
    const bad = { hook_event_name: "PreToolUse" } as unknown as HookInput;
    expect(decideEmit(bad, true, false)).toEqual({ kind: "none" });
  });

  it("R19-S2: CC sentinel gate does not apply (per-edit allowed) but diff gate does", () => {
    // sentinelExists is irrelevant on the CC path; diff gate alone governs.
    expect(decideEmit(ccInput, true, true)).toEqual({
      kind: "cc",
      file: "/repo/src/a.ts",
    });
  });
});

describe("renderCc / renderStop (R13.4/R13.5)", () => {
  it("renderCc returns exact PostToolUse hookSpecificOutput JSON", () => {
    const out = renderCc("/repo/src/a.ts");
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "/repo/src/a.ts"
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "show_diff_explanation"
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain("git diff HEAD");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("ONE call");
  });

  it("renderStop returns exact followup_message JSON", () => {
    const out = renderStop();
    const parsed = JSON.parse(out);
    expect(parsed.followup_message).toContain("show_diff_explanation");
    expect(parsed.followup_message).toContain("git diff HEAD");
    expect(parsed.followup_message).toContain("now");
  });
});
