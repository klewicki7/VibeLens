import { describe, it, expect } from "vitest";
import {
  mergeTextSection,
  VIBELENS_BEGIN,
  VIBELENS_END,
} from "./textSection.js";

/**
 * Pure marker-delimited text-block merge for CLAUDE.md / .cursor/rules (spec R15).
 * Replaces ONLY content between the markers; appends the block when absent;
 * noop when identical. NEVER errors (text files are always mergeable) -> result
 * is `{ text } | { noop: true }`. No vscode/fs import.
 */
const BODY = "## VibeLens\nCall show_diff_explanation after edits.";

describe("mergeTextSection (R15)", () => {
  it("R15-S1 (inject fresh): existing content, no markers -> block appended, prior preserved", () => {
    const existing = "# My Project\nSome docs here.\n";
    const result = mergeTextSection(existing, BODY);
    expect(result).toHaveProperty("text");
    if ("text" in result) {
      expect(result.text.startsWith(existing)).toBe(true);
      expect(result.text).toContain(VIBELENS_BEGIN);
      expect(result.text).toContain(VIBELENS_END);
      expect(result.text).toContain(BODY);
      // Block formatting: \n{BEGIN}\n{body}\n{END}\n
      expect(result.text).toContain(`\n${VIBELENS_BEGIN}\n${BODY}\n${VIBELENS_END}\n`);
    }
  });

  it("R15-S2 (update in place): outdated body replaced, surrounding text byte-for-byte", () => {
    const before = "# Header\nbefore text\n\n";
    const after = "\nafter text\n";
    const existing = `${before}${VIBELENS_BEGIN}\nOLD BODY\n${VIBELENS_END}${after}`;
    const result = mergeTextSection(existing, BODY);
    expect(result).toHaveProperty("text");
    if ("text" in result) {
      expect(result.text).toBe(
        `${before}${VIBELENS_BEGIN}\n${BODY}\n${VIBELENS_END}${after}`
      );
      expect(result.text).not.toContain("OLD BODY");
      expect(result.text.startsWith(before)).toBe(true);
      expect(result.text.endsWith(after)).toBe(true);
    }
  });

  it("R15-S3 (idempotent): block already current -> noop", () => {
    const existing = `# Header\n${VIBELENS_BEGIN}\n${BODY}\n${VIBELENS_END}\ntrailing\n`;
    const result = mergeTextSection(existing, BODY);
    expect(result).toEqual({ noop: true });
  });

  it("R15-S4 (no file): null input -> created with only the marker block", () => {
    const result = mergeTextSection(null, BODY);
    expect(result).toHaveProperty("text");
    if ("text" in result) {
      expect(result.text).toBe(`${VIBELENS_BEGIN}\n${BODY}\n${VIBELENS_END}\n`);
    }
  });

  it("never returns an error for any string input", () => {
    const result = mergeTextSection("{ arbitrary [ not json", BODY);
    expect(result).not.toHaveProperty("error");
    expect(result).toHaveProperty("text");
  });
});
