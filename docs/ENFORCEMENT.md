# VibeLens Enforcement

VibeLens nudges your AI agent to call the `show_diff_explanation` MCP tool
automatically after it edits files, so the diff panel renders without you having
to ask. This document explains how the enforcement chain works and its
prerequisites.

## How it works

On activation the extension installs four independent pieces (one failure never
blocks the others):

1. **MCP server** — registers `vibelens` in the editor's MCP config. Prefers a
   locally built `dist/index.js` (dev-shim) when present, otherwise
   `npx -y vibelens-mcp`.
2. **Hook** — a cross-platform Node script (`~/.vibelens/hooks/vibelens-hook.js`)
   wired into the editor:
   - Claude Code: `PostToolUse` hook in `~/.claude/settings.json` (matcher
     `Edit|Write|MultiEdit`).
   - Cursor: `stop` hook in `~/.cursor/hooks.json`.
3. **Skill / rule** — agent guidance teaching the `show_diff_explanation`
   signature:
   - Claude Code: `~/.claude/skills/vibelens-explain-changes/SKILL.md`.
   - Cursor: `<workspace>/.cursor/rules/vibelens.mdc`.
4. **Fallback rule** — a marker-delimited block injected into the project
   `CLAUDE.md` so the chain still nudges the agent when hooks are absent or
   misfire.

When the agent finishes editing (or completes a turn) and there are uncommitted
changes, the hook emits an instruction to call `show_diff_explanation` with the
output of `git diff HEAD`.

## Loop guards

The hook emits at most once per session so it does not re-fire after
`show_diff_explanation` runs (the tool does not commit, so the diff stays
non-empty):

- **Git-status guard** — emits only when `git diff HEAD` is non-empty.
- **Session guard** — on first emission it writes a per-conversation sentinel at
  `~/.vibelens/state/<conversation-id>.fired`; subsequent invocations for the
  same id stay silent.
- **Sentinel TTL = 24h** — on startup the hook opportunistically deletes
  sentinel files older than 24 hours (by mtime). No daemon, self-healing.

## Prerequisites

- **`node` and `git` on PATH** — the editor spawns the hook with `node`, and the
  hook shells out to `git`. If either is missing the hook fails open (silent
  `exit 0`): no enforcement, no crash, no blocked agent.
- **MCP server availability** — `show_diff_explanation` resolves through the MCP
  config. Until `vibelens-mcp` is **published to npm**, the `npx -y vibelens-mcp`
  form will fail. For local development, build the MCP package and either:
  - set `VIBELENS_MCP_DIST` to the absolute path of the built `index.js`, or
  - rely on the sibling-dist auto-detection (`../mcp/dist/index.js` in the
    monorepo).

  This dev-shim only unblocks local dev — re-running activation reverts the MCP
  config to the `npx` form once the package is published. **Publishing
  `vibelens-mcp` to npm is a prerequisite for end-users.**

## Idempotency and no-clobber

Re-running activation never duplicates or corrupts entries. JSON merges touch
only the VibeLens-owned entry (`_vibelensManaged: true`); a malformed config
aborts the write and leaves the file byte-for-byte untouched. Asset files carry
a `vibelens-asset-version` stamp — a destination file lacking the stamp is
treated as user-owned and left alone.
