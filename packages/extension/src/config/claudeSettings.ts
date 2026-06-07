// Pure cleanup logic for Claude Code settings.json.
//
// VibeLens no longer installs a PostToolUse hook — the agent is nudged purely
// via skills/rules, so the tool only fires when the agent actually changed code.
// This module strips the legacy `_vibelensManaged` PostToolUse group that older
// versions registered. It keeps the merge module's safety contract: read-parse-
// or-ABORT (never reset a malformed file), scoped mutation that only ever
// touches the managed group, and an idempotent noop when there is nothing of
// ours to remove. String/JSON in, discriminated-union out. All fs reads/writes +
// showErrorMessage live in extension.ts.
//
// NO `vscode` import here.

const MANAGED_SENTINEL = "_vibelensManaged" as const;

/** The PostToolUse matcher VibeLens used to own (edit-like tools). */
export const CC_MATCHER = "Edit|Write|MultiEdit" as const;

export interface MergeJsonResult {
  json: string;
}

export interface MergeErrorResult {
  error: string;
}

export interface MergeNoopResult {
  noop: true;
}

export type MergeResult = MergeJsonResult | MergeErrorResult | MergeNoopResult;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManagedGroup(value: unknown): boolean {
  return isPlainObject(value) && value[MANAGED_SENTINEL] === true;
}

/**
 * Removes the legacy VibeLens PostToolUse hook group from a Claude Code
 * settings.json string (one-time migration off editor hooks).
 *
 * @param existingRaw raw file contents, or `null` when the file is absent.
 * @returns
 *  - `{ noop: true }` when the file is absent/empty or carries no managed group
 *    (nothing to remove — never creates or rewrites a file).
 *  - `{ error }` when `existingRaw` is non-null but not a valid JSON object
 *    (caller must surface it and ABORT the write — no-clobber).
 *  - `{ json }` (pretty-printed, 2-space) with ONLY the managed group removed;
 *    an emptied `PostToolUse` array and an emptied `hooks` object are pruned, and
 *    every other event/group/key is preserved verbatim.
 */
export function stripVibelensPostToolUse(existingRaw: string | null): MergeResult {
  if (existingRaw === null || existingRaw.trim() === "") {
    return { noop: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existingRaw);
  } catch {
    return { error: "Existing Claude settings is not valid JSON" };
  }
  if (!isPlainObject(parsed)) {
    return { error: "Existing Claude settings is not a JSON object" };
  }
  const config = parsed;

  const hooks = isPlainObject(config.hooks) ? config.hooks : null;
  const postToolUse = hooks && Array.isArray(hooks.PostToolUse)
    ? (hooks.PostToolUse as unknown[])
    : null;

  // Nothing of ours to remove → idempotent noop, file untouched.
  if (!postToolUse || !postToolUse.some(isManagedGroup)) {
    return { noop: true };
  }

  const otherGroups = postToolUse.filter((g) => !isManagedGroup(g));

  const nextHooks: Record<string, unknown> = { ...hooks };
  if (otherGroups.length > 0) {
    nextHooks.PostToolUse = otherGroups;
  } else {
    delete nextHooks.PostToolUse;
  }

  const merged: Record<string, unknown> = { ...config };
  if (Object.keys(nextHooks).length > 0) {
    merged.hooks = nextHooks;
  } else {
    delete merged.hooks;
  }

  return { json: JSON.stringify(merged, null, 2) };
}
