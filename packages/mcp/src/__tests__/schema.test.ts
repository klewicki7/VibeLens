import { describe, it, expect } from "vitest";
import { TOOL_INPUT_JSON_SCHEMA, ToolInputSchema, MAX_DIFF_BYTES } from "../schema.js";

describe("TOOL_INPUT_JSON_SCHEMA (derived from ToolInputSchema)", () => {
  it("has type === 'object'", () => {
    expect(TOOL_INPUT_JSON_SCHEMA.type).toBe("object");
  });

  it("required contains 'title' and 'diff'", () => {
    expect(TOOL_INPUT_JSON_SCHEMA.required).toContain("title");
    expect(TOOL_INPUT_JSON_SCHEMA.required).toContain("diff");
  });

  it("does NOT contain a top-level $schema key", () => {
    expect(Object.prototype.hasOwnProperty.call(TOOL_INPUT_JSON_SCHEMA, "$schema")).toBe(false);
  });

  it("properties.title has a non-empty description", () => {
    const titleProp = (TOOL_INPUT_JSON_SCHEMA.properties as Record<string, unknown> | undefined)?.title as
      | { description?: string }
      | undefined;
    expect(typeof titleProp?.description).toBe("string");
    expect((titleProp?.description ?? "").length).toBeGreaterThan(0);
  });

  it("properties.diff has a non-empty description containing key guiding phrases", () => {
    const diffProp = (TOOL_INPUT_JSON_SCHEMA.properties as Record<string, unknown> | undefined)?.diff as
      | { description?: string }
      | undefined;
    expect(typeof diffProp?.description).toBe("string");
    expect((diffProp?.description ?? "").length).toBeGreaterThan(0);
    const desc = diffProp?.description ?? "";
    // Must mention the unified diff format
    expect(desc.toLowerCase()).toContain("unified");
    // Must warn about not passing a file path or shell command
    expect(desc.toLowerCase()).toMatch(/not a file path|shell command|actual diff/);
  });

  it("properties.annotations has a non-empty description", () => {
    const annotProp = (TOOL_INPUT_JSON_SCHEMA.properties as Record<string, unknown> | undefined)?.annotations as
      | { description?: string }
      | undefined;
    expect(typeof annotProp?.description).toBe("string");
    expect((annotProp?.description ?? "").length).toBeGreaterThan(0);
  });
});

describe("ToolInputSchema Zod validation", () => {
  it("parses a valid minimal input", () => {
    const result = ToolInputSchema.parse({ title: "My change", diff: "diff --git a/f b/f" });
    expect(result.title).toBe("My change");
    expect(result.diff).toBe("diff --git a/f b/f");
  });

  it("rejects input with missing title", () => {
    expect(() => ToolInputSchema.parse({ diff: "some diff" })).toThrow();
  });

  it("rejects input with missing diff", () => {
    expect(() => ToolInputSchema.parse({ title: "My change" })).toThrow();
  });

  it("does NOT include projectName or projectRemote in the schema (client cannot set them)", () => {
    // The schema uses strip mode (Zod 4 default) — extra fields are stripped, not rejected
    // but we assert the schema has NO field named projectName or projectRemote
    const shape = ToolInputSchema.shape;
    expect(Object.prototype.hasOwnProperty.call(shape, "projectName")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(shape, "projectRemote")).toBe(false);
  });

  it("parses full input with annotations and actions", () => {
    const result = ToolInputSchema.parse({
      title: "Add auth",
      diff: "diff --git a/auth.ts ...",
      summary: "Adds JWT",
      annotations: [
        {
          file: "src/auth.ts",
          line: 10,
          explanation: "New middleware",
          actions: [{ label: "Extract helper", prompt: "Move to function" }],
        },
      ],
      editor: "cursor",
      workspacePath: "/projects/app",
    });
    expect(result.annotations?.[0].file).toBe("src/auth.ts");
    expect(result.annotations?.[0].actions?.[0].label).toBe("Extract helper");
  });
});

describe("MAX_DIFF_BYTES", () => {
  it("equals 500 * 1024", () => {
    expect(MAX_DIFF_BYTES).toBe(500 * 1024);
  });
});
