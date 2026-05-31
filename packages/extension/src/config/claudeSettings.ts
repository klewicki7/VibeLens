// Pure Claude Code settings.json config-merge logic (design Decision B, spec R11).
//
// Mirrors mergeMcpConfig: read-parse-or-ABORT (never reset a malformed file),
// scoped mutation that only ever touches the managed PostToolUse group, and a
// non-destructive `_vibelensManaged: true` sentinel that marks the group we own
// (powering the find-and-replace + idempotency check). String/JSON in,
// discriminated-union out. All fs reads/writes + showErrorMessage live in
// extension.ts.
//
// NO `vscode` import here.

const MANAGED_SENTINEL = "_vibelensManaged" as const;

/** The PostToolUse matcher VibeLens owns (edit-like tools). */
export const CC_MATCHER = "Edit|Write|MultiEdit" as const;

/** Default hook timeout (seconds) when the caller does not supply one. */
const DEFAULT_TIMEOUT = 30 as const;

export interface PostToolUseHookEntry {
  type: "command";
  command: string;
  timeout: number;
}

export interface ClaudeHookInput {
  command: string;
  /** Defaults to 30 when omitted (spec R11.1). */
  timeout?: number;
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

interface ManagedPostToolUseGroup {
  matcher: typeof CC_MATCHER;
  readonly _vibelensManaged: true;
  hooks: PostToolUseHookEntry[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManagedGroup(value: unknown): value is Record<string, unknown> {
  return (
    isPlainObject(value) &&
    value.matcher === CC_MATCHER &&
    value[MANAGED_SENTINEL] === true
  );
}

/**
 * Merges the VibeLens PostToolUse hook group into a Claude Code settings.json string.
 *
 * @param existingRaw raw file contents, or `null` when the file is absent.
 * @param entry the managed command + optional timeout (default 30).
 * @returns
 *  - `{ error }` when `existingRaw` is non-null but not a valid JSON object
 *    (caller must surface it and ABORT the write — spec R11-S5).
 *  - `{ noop: true }` when the managed group already matches (R11-S3).
 *  - `{ json }` (pretty-printed, 2-space) with ONLY the managed PostToolUse
 *    group added/updated and all other events/groups/keys preserved
 *    (R11-S1/S2/S4).
 */
export function mergeClaudeSettings(
  existingRaw: string | null,
  entry: ClaudeHookInput
): MergeResult {
  let config: Record<string, unknown> = {};

  if (existingRaw !== null && existingRaw.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existingRaw);
    } catch {
      // Read-parse-or-ABORT: never silently reset a malformed file.
      return { error: "Existing Claude settings is not valid JSON" };
    }
    if (!isPlainObject(parsed)) {
      return { error: "Existing Claude settings is not a JSON object" };
    }
    config = parsed;
  }

  const existingHooks = isPlainObject(config.hooks) ? config.hooks : {};
  const existingPostToolUse = Array.isArray(existingHooks.PostToolUse)
    ? (existingHooks.PostToolUse as unknown[])
    : [];

  const timeout = entry.timeout ?? DEFAULT_TIMEOUT;
  const desired: ManagedPostToolUseGroup = {
    matcher: CC_MATCHER,
    [MANAGED_SENTINEL]: true,
    hooks: [{ type: "command", command: entry.command, timeout }],
  };

  const existingManaged = existingPostToolUse.find(isManagedGroup);

  // Idempotency (R11-S3): the managed group already matches exactly.
  if (existingManaged && groupMatches(existingManaged, desired)) {
    return { noop: true };
  }

  // Scoped mutation (R11-S2/S4): keep every non-managed group verbatim and
  // upsert exactly one managed group.
  const otherGroups = existingPostToolUse.filter((g) => !isManagedGroup(g));
  const mergedPostToolUse = [...otherGroups, desired];

  const merged: Record<string, unknown> = {
    ...config,
    hooks: {
      ...existingHooks,
      PostToolUse: mergedPostToolUse,
    },
  };

  return { json: JSON.stringify(merged, null, 2) };
}

function groupMatches(
  current: Record<string, unknown>,
  desired: ManagedPostToolUseGroup
): boolean {
  return JSON.stringify(current) === JSON.stringify(desired);
}
