// Pure dev-shim MCP command resolution (design Decision, spec R16).
//
// `npx -y vibelens-mcp` is the production default, but it breaks local dev
// before the package is published to npm. So we prefer a locally built dist when
// one is detectable: either via the `VIBELENS_MCP_DIST` env var or a sibling
// monorepo build at `../mcp/dist/index.js`. The result flows through
// mergeMcpConfig in extension.ts, so idempotency / sentinel / no-clobber still
// hold (R16.3, verified in PR2).
//
// Pure + testable: the env var and the sibling fs check are injected via
// `DevShimEnv` so no real filesystem is touched here.
//
// NO `vscode` import here.

/** Relative path (from the extension package root) to the sibling MCP build. */
export const SIBLING_DIST_PATH = "../mcp/dist/index.js" as const;

const NPX_COMMAND = "npx" as const;
const NPX_ARGS = ["-y", "vibelens-mcp"] as const;

export interface McpCommand {
  command: string;
  args: string[];
}

export interface DevShimEnv {
  /** Value of `VIBELENS_MCP_DIST` when set (an absolute path to index.js). */
  distPath?: string;
  /** Returns true when the given candidate sibling dist path exists on disk. */
  siblingDistExists: (candidate: string) => boolean;
}

/**
 * Resolves the MCP server command for the installed config entry.
 *
 * @returns
 *  - `{ command: "node", args: [<dist>] }` when a local dist is detected — the
 *    env var wins (R16-S1) and otherwise the sibling monorepo build (R16-S1b).
 *  - `{ command: "npx", args: ["-y", "vibelens-mcp"] }` otherwise (R16-S2).
 */
export function resolveMcpCommand(env: DevShimEnv): McpCommand {
  // Env var wins — no fs probe needed (R16-S1).
  if (env.distPath && env.distPath.trim() !== "") {
    return { command: "node", args: [env.distPath] };
  }

  // Sibling monorepo build (R16-S1b).
  if (env.siblingDistExists(SIBLING_DIST_PATH)) {
    return { command: "node", args: [SIBLING_DIST_PATH] };
  }

  // Production default (R16-S2).
  return { command: NPX_COMMAND, args: [...NPX_ARGS] };
}
