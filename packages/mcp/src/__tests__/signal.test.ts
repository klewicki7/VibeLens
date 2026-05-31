import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeSignal } from "../signal.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibelens-signal-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("writeSignal (R2)", () => {
  it("R2-S1: writes a pending.json with reviewId, timestamp and workspacePath", () => {
    writeSignal(tmpDir, { reviewId: 7, timestamp: 1234, workspacePath: "/repo" });
    const raw = fs.readFileSync(path.join(tmpDir, "pending.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual({ reviewId: 7, timestamp: 1234, workspacePath: "/repo" });
  });

  it("R2-S1: omits workspacePath when not provided", () => {
    writeSignal(tmpDir, { reviewId: 8, timestamp: 5678 });
    const raw = fs.readFileSync(path.join(tmpDir, "pending.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual({ reviewId: 8, timestamp: 5678 });
  });

  it("R2-S1: creates the target directory if it does not exist", () => {
    const nested = path.join(tmpDir, "deep", ".vibelens");
    writeSignal(nested, { reviewId: 1, timestamp: 1 });
    expect(fs.existsSync(path.join(nested, "pending.json"))).toBe(true);
  });

  it("R2-S1: leaves no temp file behind after an atomic write", () => {
    writeSignal(tmpDir, { reviewId: 1, timestamp: 1 });
    const entries = fs.readdirSync(tmpDir);
    expect(entries).toEqual(["pending.json"]);
  });
});
