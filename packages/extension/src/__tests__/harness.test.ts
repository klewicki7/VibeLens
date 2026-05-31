import { describe, it, expect } from "vitest";

// R1-S1: confirms the vitest harness runs in packages/extension.
describe("vitest harness", () => {
  it("runs a trivial assertion", () => {
    expect(1).toBe(1);
  });
});
