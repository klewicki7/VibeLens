import { describe, it, expect } from "vitest";
import { parseSignal, SignalSchema } from "./schema.js";

describe("parseSignal (R3)", () => {
  it("R3-S1: parses a valid signal object", () => {
    const result = parseSignal(JSON.stringify({ reviewId: 1, timestamp: 100 }));
    expect(result).toEqual({ reviewId: 1, timestamp: 100 });
  });

  it("R3-S1: preserves optional workspacePath", () => {
    const result = parseSignal(
      JSON.stringify({ reviewId: 2, timestamp: 200, workspacePath: "/repo" })
    );
    expect(result).toEqual({ reviewId: 2, timestamp: 200, workspacePath: "/repo" });
  });

  it("R3-S2: returns null for non-JSON input", () => {
    expect(parseSignal("not json {{")).toBeNull();
  });

  it("R3-S2: returns null for a Zod-invalid signal (negative reviewId)", () => {
    expect(parseSignal(JSON.stringify({ reviewId: -1, timestamp: 100 }))).toBeNull();
  });

  it("R3-S3: returns null when reviewId is missing", () => {
    expect(parseSignal(JSON.stringify({ timestamp: 100 }))).toBeNull();
  });
});

describe("SignalSchema", () => {
  it("rejects a non-integer reviewId", () => {
    expect(SignalSchema.safeParse({ reviewId: 1.5, timestamp: 100 }).success).toBe(false);
  });
});
