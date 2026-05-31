import { z } from "zod";

// ---------------------------------------------------------------------------
// DB row schemas — MUST track packages/mcp/src/db/store.ts
//
// These Zod schemas mirror the SQLite row shapes written by the MCP package
// (RawReviewRow / RawAnnotationRow in packages/mcp/src/db/store.ts). The
// extension reads these rows read-only via sql.js and validates them before
// mapping to a DiffExplanation. If the MCP schema changes, update this file.
// ---------------------------------------------------------------------------

export const RawReviewRowSchema = z.object({
  id: z.number().int().positive(),
  sync_id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  diff: z.string(),
  workspace_path: z.string().nullable(),
  project_name: z.string().nullable(),
  project_remote: z.string().nullable(),
  editor: z.string().nullable(),
  content_hash: z.string(),
  created_at: z.number().int(),
});

export type RawReviewRow = z.infer<typeof RawReviewRowSchema>;

export const RawAnnotationRowSchema = z.object({
  id: z.number().int(),
  sync_id: z.string(),
  review_id: z.number().int(),
  file: z.string(),
  line: z.number().int().nullable(),
  explanation: z.string(),
  // The actions column is stored as a JSON string (or null). It is parsed
  // separately via parseActionsColumn AFTER row validation.
  actions: z.string().nullable(),
  created_at: z.number().int(),
});

export type RawAnnotationRow = z.infer<typeof RawAnnotationRowSchema>;

export const ActionSchema = z.object({
  label: z.string().min(1),
  prompt: z.string().min(1),
});

export type Action = z.infer<typeof ActionSchema>;

export const ActionsJsonSchema = z.array(ActionSchema);

/**
 * Parses the `actions` JSON column of an annotation row.
 * - null column → empty array
 * - otherwise JSON.parse then validate with ActionsJsonSchema
 *
 * Throws on malformed JSON or schema violation (R4-S3). The reader catches
 * this and returns null rather than rendering garbage.
 */
export function parseActionsColumn(raw: string | null): Action[] {
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  return ActionsJsonSchema.parse(parsed);
}
