// Pure MCP config-merge logic (design Decision E, spec R10 — A1 hardening).
//
// JSON files have no comment markers, so the fix for the prior silent-reset bug
// is: read-parse-or-ABORT (never reset to `{}` on malformed input) + a SCOPED
// merge that only ever touches `mcpServers.vibelens`. A non-destructive
// `_vibelensManaged: true` sentinel marks the entry we own and powers the
// idempotency check. This module is string-in / result-out and fully unit
// tested; all fs reads/writes and `showErrorMessage` live in extension.ts.
//
// NO `vscode` import here.

const MANAGED_SENTINEL = "_vibelensManaged" as const;

export interface McpServerEntry {
  command: string;
  args: string[];
}

interface ManagedMcpServerEntry extends McpServerEntry {
  readonly _vibelensManaged: true;
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

export type MergeMcpConfigResult =
  | MergeJsonResult
  | MergeErrorResult
  | MergeNoopResult;

const VIBELENS_KEY = "vibelens" as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merges the VibeLens server entry into an existing MCP config string.
 *
 * @param existingRaw the raw file contents, or `null` when the file is absent.
 * @param entry the canonical VibeLens server entry (command + args).
 * @returns
 *  - `{ error }` when `existingRaw` is non-null but not a valid JSON object
 *    (caller must surface it and ABORT the write — spec R10-S1).
 *  - `{ noop: true }` when `mcpServers.vibelens` already matches (R10-S4).
 *  - `{ json }` (pretty-printed, 2-space) with only `mcpServers.vibelens`
 *    added/updated and all other keys preserved (R10-S2/S3/S5).
 */
export function mergeMcpConfig(
  existingRaw: string | null,
  entry: McpServerEntry
): MergeMcpConfigResult {
  let config: Record<string, unknown> = {};

  if (existingRaw !== null && existingRaw.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existingRaw);
    } catch {
      // Read-parse-or-ABORT: never silently reset a malformed file.
      return { error: "Existing MCP config is not valid JSON" };
    }
    if (!isPlainObject(parsed)) {
      return { error: "Existing MCP config is not a JSON object" };
    }
    config = parsed;
  }

  const existingServers = isPlainObject(config.mcpServers)
    ? config.mcpServers
    : {};

  const desired: ManagedMcpServerEntry = {
    command: entry.command,
    args: [...entry.args],
    [MANAGED_SENTINEL]: true,
  };

  // Idempotency (R10-S4): the vibelens entry already matches exactly.
  if (isManagedMatch(existingServers[VIBELENS_KEY], desired)) {
    return { noop: true };
  }

  // Scoped mutation (R10-S5): clone and overwrite ONLY the vibelens key,
  // preserving every other server and every top-level key.
  const merged: Record<string, unknown> = {
    ...config,
    mcpServers: {
      ...existingServers,
      [VIBELENS_KEY]: desired,
    },
  };

  return { json: JSON.stringify(merged, null, 2) };
}

function isManagedMatch(
  current: unknown,
  desired: ManagedMcpServerEntry
): boolean {
  if (!isPlainObject(current)) {
    return false;
  }
  return (
    current.command === desired.command &&
    JSON.stringify(current.args) === JSON.stringify(desired.args) &&
    current[MANAGED_SENTINEL] === true
  );
}
