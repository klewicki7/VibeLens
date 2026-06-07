// Pure cleanup logic for Cursor hooks.json.
//
// VibeLens no longer installs a Cursor `stop` hook — the agent is nudged purely
// via skills/rules, so the tool only fires when the agent actually changed code.
// This module strips the legacy `_vibelensManaged` `stop` entry that older
// versions registered. It keeps the merge module's safety contract: read-parse-
// or-ABORT (never reset a malformed file), scoped mutation that only ever
// touches the managed entry, and an idempotent noop when there is nothing of
// ours to remove. String/JSON in, discriminated-union out. All fs +
// showErrorMessage live in extension.ts.
//
// NO `vscode` import here.

const MANAGED_SENTINEL = "_vibelensManaged" as const;

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

function isManagedEntry(value: unknown): boolean {
  return isPlainObject(value) && value[MANAGED_SENTINEL] === true;
}

/**
 * Removes the legacy VibeLens `stop` hook entry from a Cursor hooks.json string
 * (one-time migration off editor hooks).
 *
 * @param existingRaw raw file contents, or `null` when the file is absent.
 * @returns
 *  - `{ noop: true }` when the file is absent/empty or carries no managed entry
 *    (nothing to remove — never creates or rewrites a file).
 *  - `{ error }` when `existingRaw` is non-null but not a valid JSON object
 *    (caller must surface it and ABORT — no-clobber).
 *  - `{ json }` (pretty-printed, 2-space) with ONLY the managed entry removed;
 *    an emptied `stop` array and an emptied `hooks` object are pruned, and
 *    `version` plus every other hook event/entry is preserved verbatim.
 */
export function stripVibelensStop(existingRaw: string | null): MergeResult {
  if (existingRaw === null || existingRaw.trim() === "") {
    return { noop: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existingRaw);
  } catch {
    return { error: "Existing Cursor hooks config is not valid JSON" };
  }
  if (!isPlainObject(parsed)) {
    return { error: "Existing Cursor hooks config is not a JSON object" };
  }
  const config = parsed;

  const hooks = isPlainObject(config.hooks) ? config.hooks : null;
  const stop = hooks && Array.isArray(hooks.stop) ? (hooks.stop as unknown[]) : null;

  // Nothing of ours to remove → idempotent noop, file untouched.
  if (!stop || !stop.some(isManagedEntry)) {
    return { noop: true };
  }

  const otherStop = stop.filter((e) => !isManagedEntry(e));

  const nextHooks: Record<string, unknown> = { ...hooks };
  if (otherStop.length > 0) {
    nextHooks.stop = otherStop;
  } else {
    delete nextHooks.stop;
  }

  const merged: Record<string, unknown> = { ...config };
  if (Object.keys(nextHooks).length > 0) {
    merged.hooks = nextHooks;
  } else {
    delete merged.hooks;
  }

  return { json: JSON.stringify(merged, null, 2) };
}
