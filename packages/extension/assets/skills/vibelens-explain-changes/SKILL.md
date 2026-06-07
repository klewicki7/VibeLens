---
name: vibelens-explain-changes
description: "Trigger: after you edit files / complete code changes in a git repo. Call the show_diff_explanation MCP tool to auto-explain the git diff. Do NOT trigger for read-only questions or when nothing changed."
license: MIT
metadata:
  author: kevin
  version: "2.0"
  vibelens-asset-version: "2"
---

<!-- vibelens-asset-version: 2 -->

## Activation Contract

Call `show_diff_explanation` ONLY after you have actually edited files in a git repository and reached a logical stopping point. Batch ALL edits from one task into a SINGLE call — not once per file.

Do NOT call it for read-only questions, code reviews, explanations, or any turn where you did not change code. If `git diff HEAD` is empty, do nothing.

## Hard Rules

- Get the diff with `git diff HEAD`. For the most recent commit use `git diff HEAD~1 HEAD`. Pass the raw unified diff verbatim as the `diff` argument.
- Always include `title` (short, what changed) and `diff`. Add `summary` (1-3 sentences) and `annotations` (`{ file, line?, explanation }`) when the change is non-trivial.
- Set `workspacePath` to the repository root and `editor` to `"cursor"` or `"vscode"`.
- Do NOT commit on the user's behalf. Do NOT call again for the same unchanged diff.

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
