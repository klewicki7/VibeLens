// Pure Codex MCP config-merge logic for `~/.codex/config.toml`.
//
// Codex uses TOML format with `[mcp_servers.vibelens]` table.
// Same discipline: read-parse-or-ABORT, scoped mutation of only
// `mcp_servers.vibelens`, idempotency by command+args comparison.
//
// TOML does not support a JSON-style `_vibelensManaged` sentinel in an
// idiomatic way (it would appear as a string key, polluting the server config),
// so idempotency is achieved by comparing command+args instead.
//
// Returns `{ json: tomlString }` — reuses the `json` discriminant key so it
// fits the applyJsonMerge driver in extension.ts (content is TOML, not JSON).
// Callers that need to distinguish TOML from JSON can inspect the target.format.
//
// NO `vscode` import here. String-in / result-out.

import { parse, stringify } from "smol-toml";

const VIBELENS_KEY = "vibelens" as const;
const MCP_SERVERS_KEY = "mcp_servers" as const;

export interface McpServerEntry {
  command: string;
  args: string[];
}

export type MergeResult =
  | { json: string }   // `json` field carries TOML string (by convention with the driver)
  | { error: string }
  | { noop: true };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merges the VibeLens server entry into Codex's `~/.codex/config.toml`.
 *
 * @param existingRaw the raw TOML file contents, or `null` / `""` when absent.
 * @param entry the canonical VibeLens server entry (command + args).
 * @returns
 *  - `{ error }` when `existingRaw` is non-null/non-empty but not valid TOML (ABORT).
 *  - `{ noop: true }` when `mcp_servers.vibelens` already matches command+args.
 *  - `{ json: tomlString }` with only `mcp_servers.vibelens` added/updated,
 *    all other keys preserved. Field named `json` to fit applyJsonMerge driver.
 */
export function mergeCodexToml(
  existingRaw: string | null,
  entry: McpServerEntry
): MergeResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: Record<string, any> = {};

  if (existingRaw !== null && existingRaw.trim() !== "") {
    try {
      config = parse(existingRaw) as Record<string, unknown>;
    } catch {
      // Read-parse-or-ABORT: never silently reset a malformed file.
      return { error: "Existing Codex config is not valid TOML" };
    }
  }

  const existingMcpServers = isPlainObject(config[MCP_SERVERS_KEY])
    ? (config[MCP_SERVERS_KEY] as Record<string, unknown>)
    : {};

  const existingEntry = existingMcpServers[VIBELENS_KEY];

  // Idempotency: compare command+args (no sentinel in TOML).
  if (
    isPlainObject(existingEntry) &&
    existingEntry.command === entry.command &&
    JSON.stringify(existingEntry.args) === JSON.stringify(entry.args)
  ) {
    return { noop: true };
  }

  // Scoped mutation: overwrite only mcp_servers.vibelens.
  const merged = {
    ...config,
    [MCP_SERVERS_KEY]: {
      ...existingMcpServers,
      [VIBELENS_KEY]: {
        command: entry.command,
        args: entry.args,
      },
    },
  };

  return { json: stringify(merged) };
}
