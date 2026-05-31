import { describe, it, expect } from "vitest";
import { buildPreview } from "./confirmGate.js";

describe("buildPreview (R8-S3)", () => {
  it("truncates a long prompt to maxLen chars plus a single ellipsis", () => {
    const prompt = "a".repeat(600);
    const preview = buildPreview(prompt, 500);
    // 500 retained chars + 1 ellipsis character.
    expect(preview.length).toBe(501);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.slice(0, 500)).toBe("a".repeat(500));
  });

  it("leaves a prompt at or below maxLen untouched (no ellipsis)", () => {
    const prompt = "b".repeat(400);
    const preview = buildPreview(prompt, 500);
    expect(preview.length).toBe(400);
    expect(preview).toBe(prompt);
    expect(preview.endsWith("…")).toBe(false);
  });

  it("leaves a prompt exactly at maxLen untouched", () => {
    const prompt = "c".repeat(500);
    const preview = buildPreview(prompt, 500);
    expect(preview).toBe(prompt);
    expect(preview.endsWith("…")).toBe(false);
  });
});
