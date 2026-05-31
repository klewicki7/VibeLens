// Pure emit-decision logic for the bundled Node hook (design Decision C, spec R13).
//
// The hook script is a standalone process at the editor<->MCP boundary, but its
// branch logic (CC vs Cursor stop, git-diff gate, session-sentinel gate) is
// extracted here so vitest can cover every path WITHOUT spawning a process or
// touching git/fs. The thin IO wrapper (`assets/hooks/vibelens-hook.js`) inlines
// an identical copy of this logic and only does stdin/git/fs/stdout.
//
// String/JSON in, discriminated-union out. NO `vscode`, NO `fs`, NO `child_process`.

/** Inbound hook stdin shape (only the fields the decision needs). */
export interface HookInput {
  hook_event_name: string;
  /** PostToolUse (Claude Code): the repo cwd the edit happened in. */
  cwd?: string;
  /** PostToolUse (Claude Code): the edited file. */
  tool_input?: { file_path?: string };
  /** stop (Cursor): workspace roots; [0] is the repo. */
  workspace_roots?: string[];
  /** stop (Cursor): keys the per-session sentinel. */
  conversation_id?: string;
}

export interface EmitCc {
  kind: "cc";
  file: string;
}

export interface EmitStop {
  kind: "stop";
  convo: string | undefined;
}

export interface EmitNone {
  kind: "none";
}

export type EmitResult = EmitCc | EmitStop | EmitNone;

/**
 * Decides whether the hook should emit, and which editor's payload.
 *
 * @param input parsed stdin JSON.
 * @param gitDiffNonEmpty result of the `git diff HEAD --quiet` gate (R13.2).
 * @param sentinelExists whether the per-conversation sentinel already exists
 *   (R13.3) — only consulted on the Cursor `stop` path.
 * @returns
 *  - `{ kind: "cc", file }` for PostToolUse when file + cwd present AND diff
 *    non-empty (R13-S1). The CC path relies on the diff gate alone; the SKILL
 *    tells the agent to batch, so per-edit emission is acceptable.
 *  - `{ kind: "stop", convo }` for stop when a workspace root is present AND
 *    diff non-empty AND no sentinel yet (R13-S2).
 *  - `{ kind: "none" }` otherwise — clean repo, already-fired, bad input, or an
 *    unrecognized event (R13-S3/S4/S5).
 */
export function decideEmit(
  input: HookInput,
  gitDiffNonEmpty: boolean,
  sentinelExists: boolean
): EmitResult {
  const evt = input.hook_event_name;

  if (evt === "PostToolUse") {
    const file = input.tool_input?.file_path;
    const cwd = input.cwd;
    if (!file || !cwd || !gitDiffNonEmpty) {
      return { kind: "none" };
    }
    return { kind: "cc", file };
  }

  if (evt === "stop") {
    const ws = input.workspace_roots?.[0];
    if (!ws || !gitDiffNonEmpty || sentinelExists) {
      return { kind: "none" };
    }
    return { kind: "stop", convo: input.conversation_id };
  }

  return { kind: "none" };
}

/**
 * Claude Code PostToolUse stdout payload (R13.4). The agent batches all edits
 * from one task into a single `show_diff_explanation` call.
 */
export function renderCc(file: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `VibeLens: ${file} was just edited. When you reach a logical stopping point, call show_diff_explanation with the output of \`git diff HEAD\` and a brief per-file analysis. Batch multiple edits into ONE call.`,
    },
  });
}

/**
 * Cursor stop stdout payload (R13.5). The followup_message is fed back to the
 * agent so it calls the tool before the turn fully ends.
 */
export function renderStop(): string {
  return JSON.stringify({
    followup_message: `Uncommitted changes remain. Call show_diff_explanation now with the output of \`git diff HEAD\` and a short analysis of what you changed.`,
  });
}
