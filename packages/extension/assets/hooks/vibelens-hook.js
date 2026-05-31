// vibelens-asset-version: 1
//
// VibeLens cross-platform Node hook (spec R13). Installed to
// ~/.vibelens/hooks/vibelens-hook.js and registered as:
//   - Claude Code PostToolUse hook (~/.claude/settings.json)
//   - Cursor stop hook (~/.cursor/hooks.json)
//
// It reads a JSON event from stdin, gates on `git diff HEAD --quiet` (only emit
// when there are uncommitted changes) plus a per-conversation sentinel (Cursor
// stop, emit at most once per session), and writes the editor-specific JSON to
// stdout. It is FAIL-OPEN BY CONSTRUCTION: ANY error, missing field, missing
// git/node, or non-git cwd results in `process.exit(0)` with no stdout so it can
// never block the agent.
//
// No external deps (no jq, no bash). The pure decision logic below is an inlined
// copy of src/hook/decideEmit.ts (which is the unit-tested source of truth — see
// decideEmit.test.ts). This file is copied verbatim into out/assets at build, so
// it cannot import from the bundled extension; keep the two copies in sync.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ASSET_VERSION = 1;
const STATE_DIR = path.join(os.homedir(), ".vibelens", "state");
const SENTINEL_TTL_MS = 24 * 60 * 60 * 1000; // 24h (design: opportunistic cleanup)

// --- pure (mirror of src/hook/decideEmit.ts) ---
function decideEmit(input, gitDiffNonEmpty, sentinelExists) {
  const evt = input.hook_event_name;
  if (evt === "PostToolUse") {
    const file = input.tool_input && input.tool_input.file_path;
    const cwd = input.cwd;
    if (!file || !cwd || !gitDiffNonEmpty) return { kind: "none" };
    return { kind: "cc", file };
  }
  if (evt === "stop") {
    const ws =
      input.workspace_roots &&
      input.workspace_roots.length > 0 &&
      input.workspace_roots[0];
    if (!ws || !gitDiffNonEmpty || sentinelExists) return { kind: "none" };
    return { kind: "stop", convo: input.conversation_id };
  }
  return { kind: "none" };
}

function renderCc(file) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        "VibeLens: " +
        file +
        " was just edited. When you reach a logical stopping point, call show_diff_explanation with the output of `git diff HEAD` and a brief per-file analysis. Batch multiple edits into ONE call.",
    },
  });
}

function renderStop() {
  return JSON.stringify({
    followup_message:
      "Uncommitted changes remain. Call show_diff_explanation now with the output of `git diff HEAD` and a short analysis of what you changed.",
  });
}

// --- IO helpers ---
function readStdin() {
  try {
    return fs.readFileSync(0, "utf-8");
  } catch (_e) {
    return "";
  }
}

// True only when `cwd` is inside a real git work tree. Guards against the
// pathspec form of `git diff` exiting 1 in a NON-repo (e.g. `git diff HEAD
// --quiet -- <file>` returns 1 even when cwd is not a git repo), which would
// otherwise be a false positive for the loop guard (spec R13.6).
function isGitWorkTree(cwd) {
  try {
    const res = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (res.error || res.status !== 0) return false;
    return String(res.stdout).trim() === "true";
  } catch (_e) {
    return false;
  }
}

// `git diff HEAD --quiet [-- <file>]` exits 1 when there ARE changes, 0 when
// clean. Any other outcome (no repo, no git, spawn failure) is treated as
// "no changes" so we stay silent (fail-open). We first confirm cwd is a real
// git work tree so the pathspec form cannot yield a false positive in a non-repo.
function gitDiffNonEmpty(cwd, file) {
  try {
    if (!isGitWorkTree(cwd)) return false;
    const args = ["diff", "HEAD", "--quiet"];
    if (file) args.push("--", file);
    const res = spawnSync("git", args, { cwd, stdio: "ignore" });
    if (res.error || res.status === null) return false;
    return res.status === 1;
  } catch (_e) {
    return false;
  }
}

function sentinelPath(convo) {
  return path.join(STATE_DIR, convo + ".fired");
}

// Opportunistic self-healing cleanup: drop sentinels older than the TTL so a
// long-lived machine never accumulates stale files. Best-effort only.
function cleanupStaleSentinels() {
  try {
    const now = Date.now();
    const entries = fs.readdirSync(STATE_DIR);
    for (const name of entries) {
      if (!name.endsWith(".fired")) continue;
      const p = path.join(STATE_DIR, name);
      try {
        const st = fs.statSync(p);
        if (now - st.mtimeMs > SENTINEL_TTL_MS) fs.unlinkSync(p);
      } catch (_e) {
        // ignore individual file errors
      }
    }
  } catch (_e) {
    // STATE_DIR may not exist yet — nothing to clean.
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch (_e) {
    process.exit(0);
  }
  if (!input || typeof input !== "object") process.exit(0);

  const evt = input.hook_event_name;
  let cwd;
  let file;
  if (evt === "PostToolUse") {
    cwd = input.cwd;
    file = input.tool_input && input.tool_input.file_path;
  } else if (evt === "stop") {
    cwd =
      input.workspace_roots &&
      input.workspace_roots.length > 0 &&
      input.workspace_roots[0];
  } else {
    process.exit(0);
  }

  if (!cwd) process.exit(0);

  const diffNonEmpty = gitDiffNonEmpty(cwd, evt === "PostToolUse" ? file : undefined);

  let sentinelExists = false;
  if (evt === "stop") {
    cleanupStaleSentinels();
    const convo = input.conversation_id;
    if (convo) {
      try {
        sentinelExists = fs.existsSync(sentinelPath(convo));
      } catch (_e) {
        sentinelExists = false;
      }
    }
  }

  const decision = decideEmit(input, diffNonEmpty, sentinelExists);

  if (decision.kind === "cc") {
    process.stdout.write(renderCc(decision.file));
    process.exit(0);
  }

  if (decision.kind === "stop") {
    // Record the per-conversation sentinel BEFORE emitting so a re-fire after
    // show_diff_explanation runs (which does not commit) stays silent (R13.3).
    try {
      if (decision.convo) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(sentinelPath(decision.convo), String(Date.now()));
      }
    } catch (_e) {
      // If we cannot persist the sentinel, still emit once (fail-open).
    }
    process.stdout.write(renderStop());
    process.exit(0);
  }

  process.exit(0);
}

// Top-level guard: ANY uncaught failure => silent exit 0.
try {
  void ASSET_VERSION;
  main();
} catch (_e) {
  process.exit(0);
}
