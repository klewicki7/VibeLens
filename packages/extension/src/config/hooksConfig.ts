// Pure Cursor hooks.json config-merge logic (design Decision B, spec R12).
//
// Mirrors mergeMcpConfig / mergeClaudeSettings: read-parse-or-ABORT (never reset
// a malformed file), default `{ version: 1 }` when absent, scoped mutation that
// only ever touches the managed `stop` entry, and a `_vibelensManaged: true`
// sentinel powering find-and-replace + idempotency. String/JSON in,
// discriminated-union out. All fs + showErrorMessage live in extension.ts.
//
// NO `vscode` import here.

const MANAGED_SENTINEL = "_vibelensManaged" as const;

/** Default hooks.json schema version when the file is absent. */
const DEFAULT_VERSION = 1 as const;

export interface CursorHookEntry {
  command: string;
  readonly _vibelensManaged: true;
}

export interface CursorHookInput {
  command: string;
}

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

function isManagedEntry(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && value[MANAGED_SENTINEL] === true;
}

/**
 * Merges the VibeLens `stop` hook entry into a Cursor hooks.json string.
 *
 * @param existingRaw raw file contents, or `null` when the file is absent.
 * @param entry the managed command to run on `stop`.
 * @returns
 *  - `{ error }` when `existingRaw` is non-null but not a valid JSON object
 *    (caller must surface it and ABORT — spec R12-S5).
 *  - `{ noop: true }` when the managed `stop` entry already matches (R12-S3).
 *  - `{ json }` (pretty-printed, 2-space) preserving `version`, other hook
 *    events and other `stop` entries, upserting exactly one managed entry
 *    (R12-S1/S2/S4).
 */
export function mergeCursorHooks(
  existingRaw: string | null,
  entry: CursorHookInput
): MergeResult {
  let config: Record<string, unknown> = { version: DEFAULT_VERSION };

  if (existingRaw !== null && existingRaw.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existingRaw);
    } catch {
      return { error: "Existing Cursor hooks config is not valid JSON" };
    }
    if (!isPlainObject(parsed)) {
      return { error: "Existing Cursor hooks config is not a JSON object" };
    }
    config = parsed;
  }

  const existingHooks = isPlainObject(config.hooks) ? config.hooks : {};
  const existingStop = Array.isArray(existingHooks.stop)
    ? (existingHooks.stop as unknown[])
    : [];

  const desired: CursorHookEntry = {
    command: entry.command,
    [MANAGED_SENTINEL]: true,
  };

  const existingManaged = existingStop.find(isManagedEntry);

  // Idempotency (R12-S3): the managed stop entry already matches exactly.
  if (existingManaged && JSON.stringify(existingManaged) === JSON.stringify(desired)) {
    return { noop: true };
  }

  // Scoped mutation (R12-S2/S4): keep every non-managed stop entry verbatim and
  // upsert exactly one managed entry.
  const otherStop = existingStop.filter((e) => !isManagedEntry(e));
  const mergedStop = [...otherStop, desired];

  const version = "version" in config ? config.version : DEFAULT_VERSION;

  const merged: Record<string, unknown> = {
    ...config,
    version,
    hooks: {
      ...existingHooks,
      stop: mergedStop,
    },
  };

  return { json: JSON.stringify(merged, null, 2) };
}
