import { describe, it, expect } from "vitest";
import { getNonce, buildCsp } from "./csp.js";

describe("getNonce", () => {
  it("produces a different nonce on each call", () => {
    const a = getNonce();
    const b = getNonce();
    expect(a).not.toBe(b);
  });

  it("returns at least 22 characters (16 bytes base64-encoded)", () => {
    // 16 bytes -> base64 length 24 (with padding) / 22 unpadded; assert >= 22.
    const nonce = getNonce();
    expect(nonce.length).toBeGreaterThanOrEqual(22);
  });
});

describe("buildCsp", () => {
  const cspSource = "vscode-resource://abc";
  const nonce = "TESTNONCE123456789012";

  it("contains no external origins (no http, cdn, or unsafe-inline)", () => {
    const policy = buildCsp(cspSource, nonce);
    expect(policy).not.toMatch(/http/i);
    expect(policy).not.toMatch(/cdn/i);
    expect(policy).not.toMatch(/unsafe-inline/i);
  });

  it("includes the nonce in both script-src and style-src", () => {
    const policy = buildCsp(cspSource, nonce);
    const scriptSrc = policy
      .split(";")
      .find((d) => d.trim().startsWith("script-src"));
    const styleSrc = policy
      .split(";")
      .find((d) => d.trim().startsWith("style-src"));
    expect(scriptSrc).toContain(`'nonce-${nonce}'`);
    expect(styleSrc).toContain(`'nonce-${nonce}'`);
  });

  it("matches the exact locked policy from the design", () => {
    const policy = buildCsp(cspSource, nonce);
    expect(policy).toBe(
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}' ${cspSource}; font-src ${cspSource}; img-src ${cspSource} data:; connect-src 'none';`
    );
  });

  it("includes ${cspSource} in style-src so diff2html runtime styles render", () => {
    const policy = buildCsp(cspSource, nonce);
    const styleSrc = policy
      .split(";")
      .find((d) => d.trim().startsWith("style-src"));
    expect(styleSrc).toContain(cspSource);
  });
});
