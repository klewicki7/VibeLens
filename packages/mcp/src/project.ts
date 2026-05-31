import { execFileSync } from "node:child_process";
import { basename } from "node:path";

export interface ProjectInfo {
  root: string | null;
  remote: string | null;
  name: string;
}

/**
 * Detects git project info for the given working directory.
 * Never throws — returns best-effort values if the directory is not a git repo.
 */
export function detectProject(cwd: string): ProjectInfo {
  let root: string | null = null;
  let remote: string | null = null;

  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // not a git repo or git not available
  }

  if (root !== null) {
    try {
      remote = execFileSync("git", ["remote", "get-url", "origin"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // no remote configured
    }
  }

  const name = deriveProjectName(remote, root, cwd);
  return { root, remote, name };
}

function deriveProjectName(
  remote: string | null,
  root: string | null,
  cwd: string
): string {
  if (remote !== null && remote.length > 0) {
    // Strip trailing .git and take the last path segment
    const withoutGit = remote.replace(/\.git$/, "");
    const segment = withoutGit.split(/[/:]/g).filter(Boolean).pop();
    if (segment && segment.length > 0) return segment;
  }

  return basename(root ?? cwd);
}
