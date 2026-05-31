import { describe, it, expect } from "vitest";
import {
  RawReviewRowSchema,
  RawAnnotationRowSchema,
  RawReviewSummaryRowSchema,
  ActionsJsonSchema,
  parseActionsColumn,
} from "./schema.js";

const validReviewRow = {
  id: 1,
  sync_id: "uuid-1",
  title: "Add auth",
  summary: "Adds JWT auth",
  diff: "diff --git a/x b/x",
  workspace_path: "/repo",
  project_name: "widget",
  project_remote: "git@github.com:acme/widget.git",
  editor: "cursor",
  content_hash: "abc",
  created_at: 1_700_000_000_000,
};

const validAnnotationRow = {
  id: 10,
  sync_id: "uuid-ann-1",
  review_id: 1,
  file: "src/auth.ts",
  line: 12,
  explanation: "New middleware",
  actions: JSON.stringify([{ label: "Extract", prompt: "Move to helper" }]),
  created_at: 1_700_000_000_000,
};

describe("DB row schemas (R4)", () => {
  it("R4-S1: parses a valid review row", () => {
    expect(RawReviewRowSchema.parse(validReviewRow)).toMatchObject({ id: 1, title: "Add auth" });
  });

  it("R4-S1: parses a valid annotation row (line + actions string)", () => {
    expect(RawAnnotationRowSchema.parse(validAnnotationRow)).toMatchObject({
      id: 10,
      file: "src/auth.ts",
    });
  });

  it("R4-S1: accepts nullable summary/workspace_path/line/actions", () => {
    expect(
      RawReviewRowSchema.parse({
        ...validReviewRow,
        summary: null,
        workspace_path: null,
        project_name: null,
        project_remote: null,
        editor: null,
      })
    ).toMatchObject({ id: 1 });
    expect(
      RawAnnotationRowSchema.parse({ ...validAnnotationRow, line: null, actions: null })
    ).toMatchObject({ id: 10 });
  });
});

describe("parseActionsColumn (R4-S3)", () => {
  it("returns [] for a null column", () => {
    expect(parseActionsColumn(null)).toEqual([]);
  });

  it("parses a valid actions JSON array", () => {
    expect(parseActionsColumn(JSON.stringify([{ label: "L", prompt: "P" }]))).toEqual([
      { label: "L", prompt: "P" },
    ]);
  });

  it("throws on non-JSON actions column", () => {
    expect(() => parseActionsColumn("not json {{")).toThrow();
  });

  it("throws when an action is missing its label", () => {
    expect(() => parseActionsColumn(JSON.stringify([{ prompt: "P" }]))).toThrow();
  });
});

const validSummaryRow = {
  id: 7,
  title: "Add review history",
  summary: "Lists past reviews",
  project_name: "vibelens",
  created_at: 1_700_000_000_000,
};

describe("RawReviewSummaryRowSchema (R2)", () => {
  it("parses a valid summary row", () => {
    expect(RawReviewSummaryRowSchema.parse(validSummaryRow)).toMatchObject({
      id: 7,
      title: "Add review history",
    });
  });

  it("accepts null summary and null project_name", () => {
    const parsed = RawReviewSummaryRowSchema.parse({
      ...validSummaryRow,
      summary: null,
      project_name: null,
    });
    expect(parsed.summary).toBeNull();
    expect(parsed.project_name).toBeNull();
  });

  it("rejects a non-positive id", () => {
    expect(RawReviewSummaryRowSchema.safeParse({ ...validSummaryRow, id: 0 }).success).toBe(false);
  });

  it("rejects a non-integer id", () => {
    expect(RawReviewSummaryRowSchema.safeParse({ ...validSummaryRow, id: 1.5 }).success).toBe(false);
  });

  it("safeParse returns success:false on a row missing title (skip-on-failure path)", () => {
    const result = RawReviewSummaryRowSchema.safeParse({
      id: 7,
      summary: "x",
      project_name: "vibelens",
      created_at: 1,
    });
    expect(result.success).toBe(false);
  });

  it("does not expose a diff field on the parsed summary", () => {
    const parsed = RawReviewSummaryRowSchema.parse({ ...validSummaryRow, diff: "diff --git a b" });
    expect("diff" in parsed).toBe(false);
  });
});

describe("ActionsJsonSchema", () => {
  it("rejects an action with an empty label", () => {
    expect(ActionsJsonSchema.safeParse([{ label: "", prompt: "P" }]).success).toBe(false);
  });
});
