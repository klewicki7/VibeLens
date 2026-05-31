---
name: vibelens-explain-changes
description: "Trigger: after editing files, after completing code changes, when a VibeLens hook asks. Call the show_diff_explanation MCP tool to auto-explain the git diff."
license: MIT
metadata:
  author: kevin
  version: "1.0"
  vibelens-asset-version: "1"
---

<!-- vibelens-asset-version: 1 -->

## Activation Contract

Call `show_diff_explanation` after you finish editing files in a git repository, or when a VibeLens hook injects an instruction. Batch ALL edits from one task into a SINGLE call at a logical stopping point — not once per file.

## Hard Rules

- Get the diff with `git diff HEAD`. For the most recent commit use `git diff HEAD~1 HEAD`. Pass the raw unified diff verbatim as the `diff` argument.
- Always include `title` (short, what changed) and `diff`. Add `summary` (1-3 sentences) and `annotations` (`{ file, line?, explanation }`) when the change is non-trivial.
- Set `workspacePath` to the repository root and `editor` to `"cursor"` or `"vscode"`.
- Do NOT commit on the user's behalf. Do NOT call again for the same unchanged diff (the hook already enforces a per-session loop guard).

## Execution Steps

1. Run `git diff HEAD`. If the output is empty, do nothing.
2. Compose a `title`, a short `summary`, and per-file `annotations` that explain WHY each change was made.
3. Call `show_diff_explanation` with `{ title, diff, summary, annotations, workspacePath, editor }`.

## Tool Parameters

| Param | Required | Value |
|-------|----------|-------|
| `title` | yes | Short description of what changed |
| `diff` | yes | Raw unified output of `git diff HEAD` |
| `summary` | no | 1-3 sentence high-level overview |
| `annotations` | no | Array of `{ file, line?, explanation }` |
| `workspacePath` | no | Absolute path to the repo root |
| `editor` | no | `"cursor"` or `"vscode"` |
