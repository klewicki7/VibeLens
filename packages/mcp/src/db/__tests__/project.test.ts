import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { detectProject } from "../../project.js";

describe("detectProject", () => {
  it("detects the repo root and name from a git repository", () => {
    // Run against the actual repo root
    const repoRoot = "/Users/kevin/explain-changes-mcp";
    const info = detectProject(repoRoot);

    expect(info.root).not.toBeNull();
    expect(typeof info.name).toBe("string");
    expect(info.name.length).toBeGreaterThan(0);
  });

  it("returns a sensible name derived from the remote URL", () => {
    const repoRoot = "/Users/kevin/explain-changes-mcp";
    const info = detectProject(repoRoot);

    // The remote URL for this repo contains "VibeLens" or "explain-changes-mcp"
    if (info.remote !== null) {
      expect(info.name).toBeTruthy();
      // Should be derived from the last segment of the remote URL (without .git)
      expect(info.name).not.toContain(".git");
    }
  });

  it("never throws on a non-git temp directory", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "vibelens-test-"));

    let result: ReturnType<typeof detectProject> | undefined;
    expect(() => {
      result = detectProject(tmpDir);
    }).not.toThrow();

    expect(result).toBeDefined();
    expect(result!.root).toBeNull();
    expect(result!.remote).toBeNull();
    expect(typeof result!.name).toBe("string");
    // Falls back to directory basename
    expect(result!.name).toMatch(/vibelens-test-/);
  });

  it("never throws on a completely non-existent path", () => {
    expect(() => detectProject("/definitely/does/not/exist/xyz")).not.toThrow();
  });
});
