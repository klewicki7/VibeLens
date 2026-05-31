import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../db/connection.js";
import { createShowDiffExplanationHandler, type HandlerDeps } from "../handler.js";
import { MAX_DIFF_BYTES } from "../schema.js";
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";

const FIXED_NOW = 1_700_000_000_000;

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

function makeHandler(over: Partial<HandlerDeps> = {}) {
  return createShowDiffExplanationHandler({
    getDb: () => db,
    detectProject: () => ({ root: "/repo", remote: null, name: "widget" }),
    now: () => FIXED_NOW,
    maxDiffBytes: MAX_DIFF_BYTES,
    ...over,
  });
}

function buildRequest(args: Record<string, unknown>): CallToolRequest {
  return { method: "tools/call", params: { name: "show_diff_explanation", arguments: args } };
}

async function call(
  handler: ReturnType<typeof makeHandler>,
  args: Record<string, unknown>
): Promise<{ envelope: Record<string, unknown>; isError: boolean | undefined }> {
  const result = await handler(buildRequest(args));
  const item = result.content[0] as { type: string; text: string };
  return { envelope: JSON.parse(item.text), isError: result.isError };
}

const VALID_ARGS = {
  title: "Add auth",
  diff: "diff --git a/auth.ts b/auth.ts\n+export function auth() {}",
  summary: "Adds JWT auth",
  workspacePath: "/repo",
};

describe("onReviewSaved callback (R2)", () => {
  it("R2-S1: is called with { reviewId, workspacePath, timestamp } after a successful save", async () => {
    const onReviewSaved = vi.fn();
    const handler = makeHandler({ onReviewSaved });
    const { envelope } = await call(handler, VALID_ARGS);

    expect(envelope.ok).toBe(true);
    expect(onReviewSaved).toHaveBeenCalledTimes(1);
    expect(onReviewSaved).toHaveBeenCalledWith({
      reviewId: envelope.reviewId,
      workspacePath: "/repo",
      timestamp: FIXED_NOW,
    });
  });

  it("R2-S2: is NOT called when Zod validation fails", async () => {
    const onReviewSaved = vi.fn();
    const handler = makeHandler({ onReviewSaved });
    const { envelope } = await call(handler, { title: "", diff: "" });

    expect(envelope.ok).toBe(false);
    expect(onReviewSaved).not.toHaveBeenCalled();
  });

  it("R2-S1: a throw inside onReviewSaved does NOT fail the tool result", async () => {
    const onReviewSaved = vi.fn(() => {
      throw new Error("signal write failed");
    });
    const handler = makeHandler({ onReviewSaved });
    const { envelope, isError } = await call(handler, VALID_ARGS);

    expect(envelope.ok).toBe(true);
    expect(isError).toBeUndefined();
    expect(onReviewSaved).toHaveBeenCalledTimes(1);
  });
});
