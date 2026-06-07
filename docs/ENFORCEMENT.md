# VibeLens Enforcement

VibeLens nudges your AI agent to call the `show_diff_explanation` MCP tool
after it edits files, so the diff panel renders without you having to ask. The
nudge is **advisory, not forced**: VibeLens installs no editor hooks, so the
agent only calls the tool when it actually changed code — never on a read-only
question or an empty diff. This document explains how the chain works and its
prerequisites.

## How it works

On activation the extension installs three independent pieces (one failure never
blocks the others):

1. **MCP server** — registers `vibelens` in every detected agent's MCP config
   (global + project). Prefers a locally built `dist/index.js` (dev-shim) when
   present, otherwise `npx -y vibelens-mcp`. This is what makes
   `show_diff_explanation` resolvable.
2. **Skill / rule** — agent guidance teaching the `show_diff_explanation`
   signature and when to call it:
   - Claude Code: `~/.claude/skills/vibelens-explain-changes/SKILL.md`.
   - Cursor / Windsurf: `<workspace>/.cursor/rules/vibelens.mdc`.
3. **Rule block** — a marker-delimited block injected into the project
   `CLAUDE.md` and `AGENTS.md` so any agent (Claude, Codex, etc.) gets the same
   nudge.

When the agent finishes a task that edited files, the skill/rule tells it to run
`git diff HEAD` and call `show_diff_explanation` with the diff and a brief
per-file analysis. Because the trigger is the agent's own judgment, it skips the
call for questions, reviews, or when the diff is empty.

## Legacy hook cleanup

Earlier versions of VibeLens wired editor hooks that fired on **every** turn:

- Claude Code: a `PostToolUse` hook in `~/.claude/settings.json`.
- Cursor: a `stop` hook in `~/.cursor/hooks.json`, plus a bundled script at
  `~/.vibelens/hooks/vibelens-hook.js`.

These were invasive — they nudged even when the agent only answered a question.
They have been removed. On activation the extension now **strips** those managed
entries (matched by the `_vibelensManaged` sentinel) and deletes the legacy hook
script directory. The cleanup is idempotent and scoped: a config with no managed
entry is left byte-for-byte untouched, and no config file is ever created by the
cleanup.

## Prerequisites

- **`git` on PATH** — the agent shells out to `git diff HEAD`. No `node`-spawned
  hook is involved anymore.
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

Re-running activation never duplicates or corrupts entries. JSON merges (MCP) and
the hook-cleanup strips touch only the VibeLens-owned entry
(`_vibelensManaged: true`); a malformed config aborts the write and leaves the
file byte-for-byte untouched. Asset files (skill, `.cursor/rules`) carry a
`vibelens-asset-version` stamp — a destination file lacking the stamp is treated
as user-owned and left alone. The `CLAUDE.md` / `AGENTS.md` rule block is
replaced only strictly between its markers; all surrounding prose is preserved.
