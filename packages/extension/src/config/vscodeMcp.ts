// Pure VS Code MCP config-merge logic for `.vscode/mcp.json`.
//
// VS Code uses `servers` as the root key (not `mcpServers`) and requires
// `type: "stdio"` on each entry. Same discipline as mcpConfig.ts:
// read-parse-or-ABORT, scoped mutation of only `servers.vibelens`,
// `_vibelensManaged: true` sentinel, idempotency.
//
// NO `vscode` import here. String-in / result-out.

const MANAGED_SENTINEL = "_vibelensManaged" as const;
const VIBELENS_KEY = "vibelens" as const;

export interface McpServerEntry {
  command: string;
  args: string[];
}

interface ManagedVscodeEntry extends McpServerEntry {
  readonly type: "stdio";
  readonly _vibelensManaged: true;
}

export type MergeResult =
  | { json: string }
  | { error: string }
  | { noop: true };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManagedMatch(current: unknown, desired: ManagedVscodeEntry): boolean {
  if (!isPlainObject(current)) {
    return false;
  }
  return (
    current.type === "stdio" &&
    current.command === desired.command &&
    JSON.stringify(current.args) === JSON.stringify(desired.args) &&
    current[MANAGED_SENTINEL] === true
  );
}

/**
 * Merges the VibeLens server entry into a VS Code `.vscode/mcp.json` config.
 *
 * @param existingRaw the raw file contents, or `null` when the file is absent.
 * @param entry the canonical VibeLens server entry (command + args).
 * @returns
 *  - `{ error }` when `existingRaw` is non-null but not a valid JSON object (ABORT).
 *  - `{ noop: true }` when `servers.vibelens` already matches exactly.
 *  - `{ json }` (pretty-printed, 2-space) with only `servers.vibelens`
 *    added/updated and all other keys preserved.
 */
export function mergeVscodeMcp(
  existingRaw: string | null,
  entry: McpServerEntry
): MergeResult {
  let config: Record<string, unknown> = {};

  if (existingRaw !== null && existingRaw.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existingRaw);
    } catch {
      return { error: "Existing VS Code MCP config is not valid JSON" };
    }
    if (!isPlainObject(parsed)) {
      return { error: "Existing VS Code MCP config is not a JSON object" };
    }
    config = parsed;
  }

  const existingServers = isPlainObject(config.servers) ? config.servers : {};

  const desired: ManagedVscodeEntry = {
    type: "stdio",
    command: entry.command,
    args: [...entry.args],
    [MANAGED_SENTINEL]: true,
  };

  // Idempotency: already matches exactly → no rewrite needed.
  if (isManagedMatch(existingServers[VIBELENS_KEY], desired)) {
    return { noop: true };
  }

  // Scoped mutation: clone and overwrite ONLY the vibelens key.
  const merged: Record<string, unknown> = {
    ...config,
    servers: {
      ...existingServers,
      [VIBELENS_KEY]: desired,
    },
  };

  return { json: JSON.stringify(merged, null, 2) };
}
