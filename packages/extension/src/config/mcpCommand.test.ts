import { describe, it, expect } from "vitest";
import {
  resolveMcpCommand,
  type DevShimEnv,
} from "./mcpCommand.js";

/**
 * Pure dev-shim MCP command resolution (spec R16). Prefers a locally built dist
 * (env var or sibling monorepo path) so the chain runs before npm publish; else
 * defaults to npx. fs is injected via DevShimEnv — no real filesystem. No
 * vscode/fs import.
 */
describe("resolveMcpCommand (R16)", () => {
  it("R16-S1 (dev, env var): VIBELENS_MCP_DIST set -> node + dist path", () => {
    const env: DevShimEnv = {
      distPath: "/abs/path/to/index.js",
      siblingDistExists: () => false,
    };
    expect(resolveMcpCommand(env)).toEqual({
      command: "node",
      args: ["/abs/path/to/index.js"],
    });
  });

  it("R16-S1b (dev, sibling): sibling dist exists -> node + sibling path", () => {
    const seen: string[] = [];
    const env: DevShimEnv = {
      siblingDistExists: (p) => {
        seen.push(p);
        return true;
      },
    };
    const result = resolveMcpCommand(env);
    expect(result.command).toBe("node");
    expect(result.args).toHaveLength(1);
    expect(result.args[0]).toContain("index.js");
    // checked the sibling monorepo mcp dist path
    expect(seen.some((p) => p.includes("mcp") && p.includes("dist"))).toBe(true);
  });

  it("R16-S2 (prod): no env, no sibling -> npx form", () => {
    const env: DevShimEnv = {
      siblingDistExists: () => false,
    };
    expect(resolveMcpCommand(env)).toEqual({
      command: "npx",
      args: ["-y", "vibelens-mcp"],
    });
  });

  it("prefers env var over sibling lookup (env wins, no fs probe needed)", () => {
    const env: DevShimEnv = {
      distPath: "/env/dist/index.js",
      siblingDistExists: () => true,
    };
    expect(resolveMcpCommand(env)).toEqual({
      command: "node",
      args: ["/env/dist/index.js"],
    });
  });
});
