import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_DIFF_BYTES = 500 * 1024;

// ---------------------------------------------------------------------------
// ToolInputSchema — single Zod v4 schema for the show_diff_explanation tool.
// This is the CLIENT-FACING schema. It intentionally does NOT include
// projectName or projectRemote — those are server-derived via detectProject.
// ---------------------------------------------------------------------------

const ActionSchema = z.object({
  label: z
    .string()
    .min(1)
    .describe("Short action label (e.g., 'Extract to helper')"),
  prompt: z
    .string()
    .min(1)
    .describe(
      "Full context: what to change, relevant code snippet, and why it would improve the code"
    ),
});

const AnnotationSchema = z.object({
  file: z.string().min(1).describe("File path the annotation refers to"),
  line: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Line number in the new file (optional)"),
  explanation: z
    .string()
    .min(1)
    .describe("Your explanation of this change — what the code does"),
  actions: z
    .array(ActionSchema)
    .optional()
    .describe("Reviewer actions: specific, actionable suggestions for improvements"),
});

export const ToolInputSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("Title for the explanation (e.g., 'Add user authentication')"),
  summary: z
    .string()
    .optional()
    .describe("High-level summary of the changes"),
  diff: z
    .string()
    .min(1)
    .describe(
      "The raw git diff output as a string (unified diff format). IMPORTANT: Pass the actual diff content, not a file path or shell command."
    ),
  annotations: z
    .array(AnnotationSchema)
    .optional()
    .describe("Annotations explaining specific parts of the diff"),
  editor: z
    .enum(["cursor", "vscode"])
    .optional()
    .describe("Which editor you are using"),
  workspacePath: z
    .string()
    .optional()
    .describe(
      "Absolute path to the workspace/project folder. Used to attribute the review to the correct project."
    ),
});

// ---------------------------------------------------------------------------
// Exported TS types
// ---------------------------------------------------------------------------

export type ToolInput = z.infer<typeof ToolInputSchema>;

export type ErrorCode = "DIFF_TOO_LARGE" | "VALIDATION_FAILED" | "UNKNOWN";

export interface SuccessEnvelope {
  ok: true;
  reviewId: number;
  syncId: string;
  deduped: boolean;
}

export interface ErrorEnvelope {
  ok: false;
  error: ErrorCode;
  message: string;
}

export type Envelope = SuccessEnvelope | ErrorEnvelope;

// ---------------------------------------------------------------------------
// TOOL_INPUT_JSON_SCHEMA — derived from ToolInputSchema for use as the MCP
// tool inputSchema. Strips the top-level $schema key (MCP SDK does not need
// it and some clients dislike it).
// ---------------------------------------------------------------------------

function normalizeForMcp(raw: Record<string, unknown>): Record<string, unknown> {
  const result = { ...raw };
  delete result["$schema"];
  return result;
}

export const TOOL_INPUT_JSON_SCHEMA: Record<string, unknown> = normalizeForMcp(
  z.toJSONSchema(ToolInputSchema) as Record<string, unknown>
);
