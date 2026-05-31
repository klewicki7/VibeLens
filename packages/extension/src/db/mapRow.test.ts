import { describe, it, expect } from "vitest";
import { mapToDiffExplanation, mapHistoricalReview } from "./mapRow.js";
import type { RawReviewRow, RawAnnotationRow } from "./schema.js";
import type { SignalFile } from "../signal/schema.js";

const review: RawReviewRow = {
  id: 1,
  sync_id: "uuid-1",
  title: "Add auth",
  summary: "Adds JWT auth",
  diff: "diff --git a/x b/x",
  workspace_path: "/repo",
  project_name: "widget",
  project_remote: null,
  editor: "vscode",
  content_hash: "abc",
  created_at: 1_700_000_000_000,
};

const annotation: RawAnnotationRow = {
  id: 10,
  sync_id: "uuid-ann-1",
  review_id: 1,
  file: "src/auth.ts",
  line: null,
  explanation: "New middleware",
  actions: JSON.stringify([{ label: "Extract", prompt: "Move to helper" }]),
  created_at: 1_700_000_000_000,
};

const signal: SignalFile = { reviewId: 1, timestamp: 999 };

describe("mapToDiffExplanation (R3, R4)", () => {
  it("uses the signal timestamp, not review.created_at", () => {
    const out = mapToDiffExplanation(review, [annotation], signal);
    expect(out.timestamp).toBe(999);
  });

  it("falls back to review.created_at when the signal omits timestamp", () => {
    const out = mapToDiffExplanation(review, [annotation], {
      reviewId: 1,
      timestamp: undefined as unknown as number,
    });
    expect(out.timestamp).toBe(review.created_at);
  });

  it("maps annotation line null to undefined", () => {
    const out = mapToDiffExplanation(review, [annotation], signal);
    expect(out.annotations[0]?.line).toBeUndefined();
  });

  it("parses annotation actions via parseActionsColumn", () => {
    const out = mapToDiffExplanation(review, [annotation], signal);
    expect(out.annotations[0]?.actions).toEqual([{ label: "Extract", prompt: "Move to helper" }]);
  });

  it("preserves a known editor value (vscode)", () => {
    const out = mapToDiffExplanation(review, [annotation], signal);
    expect(out.editor).toBe("vscode");
  });

  it("coerces an unknown editor value to 'cursor'", () => {
    const out = mapToDiffExplanation({ ...review, editor: "emacs" }, [annotation], signal);
    expect(out.editor).toBe("cursor");
  });

  it("coerces a null editor to 'cursor'", () => {
    const out = mapToDiffExplanation({ ...review, editor: null }, [annotation], signal);
    expect(out.editor).toBe("cursor");
  });

  it("carries title, summary, diff and workspacePath from the review row", () => {
    const out = mapToDiffExplanation(review, [annotation], signal);
    expect(out).toMatchObject({
      title: "Add auth",
      summary: "Adds JWT auth",
      diff: "diff --git a/x b/x",
      workspacePath: "/repo",
    });
  });
});

describe("mapHistoricalReview (Slice 5 — signal-less history re-open)", () => {
  it("uses review.created_at as the timestamp (no signal)", () => {
    const out = mapHistoricalReview(review, [annotation]);
    expect(out.timestamp).toBe(review.created_at);
  });

  it("carries title, summary, diff and workspacePath through from the review row", () => {
    const out = mapHistoricalReview(review, [annotation]);
    expect(out).toMatchObject({
      title: "Add auth",
      summary: "Adds JWT auth",
      diff: "diff --git a/x b/x",
      workspacePath: "/repo",
    });
  });

  it("maps annotation line null to undefined and parses actions", () => {
    const out = mapHistoricalReview(review, [annotation]);
    expect(out.annotations[0]?.line).toBeUndefined();
    expect(out.annotations[0]?.actions).toEqual([{ label: "Extract", prompt: "Move to helper" }]);
  });

  it("still coerces an unknown editor value to 'cursor'", () => {
    const out = mapHistoricalReview({ ...review, editor: "emacs" }, [annotation]);
    expect(out.editor).toBe("cursor");
  });

  it("uses a different review.created_at when given a different row", () => {
    const out = mapHistoricalReview({ ...review, created_at: 42 }, [annotation]);
    expect(out.timestamp).toBe(42);
  });
});
