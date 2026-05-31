import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionRow {
  label: string;
  prompt: string;
}

export interface AnnotationRow {
  id: number;
  sync_id: string;
  review_id: number;
  file: string;
  line: number | null;
  explanation: string;
  actions: ActionRow[] | null;
  created_at: number;
}

export interface ReviewRow {
  id: number;
  sync_id: string;
  title: string;
  summary: string | null;
  diff: string;
  workspace_path: string | null;
  project_name: string | null;
  project_remote: string | null;
  editor: string | null;
  content_hash: string;
  created_at: number;
  annotations: AnnotationRow[];
}

// ---------------------------------------------------------------------------
// Zod schemas (Zod 4)
// ---------------------------------------------------------------------------

const ActionSchema = z.object({
  label: z.string().min(1),
  prompt: z.string().min(1),
});

const AnnotationInputSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  explanation: z.string().min(1),
  actions: z.array(ActionSchema).optional(),
});

const EDITOR_VALUES = {
  CURSOR: "cursor",
  VSCODE: "vscode",
} as const;

type Editor = (typeof EDITOR_VALUES)[keyof typeof EDITOR_VALUES];

const ReviewInputSchema = z.object({
  title: z.string().min(1),
  diff: z.string().min(1),
  summary: z.string().optional(),
  annotations: z.array(AnnotationInputSchema).optional(),
  workspacePath: z.string().optional(),
  editor: z.enum(["cursor", "vscode"]).optional(),
  projectName: z.string().optional(),
  projectRemote: z.string().optional(),
});

export type ReviewInput = z.infer<typeof ReviewInputSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_DEDUP_WINDOW_MS = 5000;

export function computeContentHash(input: {
  title: string;
  diff: string;
  workspacePath?: string;
}): string {
  const stable = JSON.stringify({
    title: input.title,
    diff: input.diff,
    workspacePath: input.workspacePath ?? null,
  });
  return createHash("sha256").update(stable).digest("hex");
}

// ---------------------------------------------------------------------------
// Internal raw DB row types (before JSON parsing)
// ---------------------------------------------------------------------------

interface RawAnnotationRow {
  id: number;
  sync_id: string;
  review_id: number;
  file: string;
  line: number | null;
  explanation: string;
  actions: string | null;
  created_at: number;
}

interface RawReviewRow {
  id: number;
  sync_id: string;
  title: string;
  summary: string | null;
  diff: string;
  workspace_path: string | null;
  project_name: string | null;
  project_remote: string | null;
  editor: string | null;
  content_hash: string;
  created_at: number;
}

function parseAnnotationRow(raw: RawAnnotationRow): AnnotationRow {
  return {
    ...raw,
    actions: raw.actions ? (JSON.parse(raw.actions) as ActionRow[]) : null,
  };
}

// ---------------------------------------------------------------------------
// saveReview
// ---------------------------------------------------------------------------

export interface SaveReviewResult {
  id: number;
  sync_id: string;
  deduped: boolean;
}

export function saveReview(
  db: Database.Database,
  input: ReviewInput,
  now: number = Date.now(),
  dedupWindowMs: number = DEFAULT_DEDUP_WINDOW_MS
): SaveReviewResult {
  const parsed = ReviewInputSchema.parse(input);
  const contentHash = computeContentHash({
    title: parsed.title,
    diff: parsed.diff,
    workspacePath: parsed.workspacePath,
  });

  // Dedup check: same hash within the time window
  const existing = db
    .prepare<[string, number]>(
      `SELECT id, sync_id FROM reviews
       WHERE content_hash = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(contentHash, now - dedupWindowMs) as
    | { id: number; sync_id: string }
    | undefined;

  if (existing !== undefined) {
    return { id: existing.id, sync_id: existing.sync_id, deduped: true };
  }

  const syncId = randomUUID();
  const createdAt = now;

  const insert = db.transaction(() => {
    db.prepare<[string, string, string | null, string, string | null, string | null, string | null, Editor | null, string, number]>(
      `INSERT INTO reviews
         (sync_id, title, summary, diff, workspace_path, project_name, project_remote, editor, content_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      syncId,
      parsed.title,
      parsed.summary ?? null,
      parsed.diff,
      parsed.workspacePath ?? null,
      parsed.projectName ?? null,
      parsed.projectRemote ?? null,
      (parsed.editor ?? null) as Editor | null,
      contentHash,
      createdAt
    );

    const reviewId = (
      db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }
    ).id;

    for (const ann of parsed.annotations ?? []) {
      db.prepare<[string, number, string, number | null, string, string | null, number]>(
        `INSERT INTO annotations
           (sync_id, review_id, file, line, explanation, actions, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        randomUUID(),
        reviewId,
        ann.file,
        ann.line ?? null,
        ann.explanation,
        ann.actions ? JSON.stringify(ann.actions) : null,
        createdAt
      );
    }

    return reviewId;
  });

  const reviewId = insert() as number;
  return { id: reviewId, sync_id: syncId, deduped: false };
}

// ---------------------------------------------------------------------------
// getReview
// ---------------------------------------------------------------------------

export function getReview(
  db: Database.Database,
  id: number
): ReviewRow | null {
  const row = db
    .prepare<[number]>("SELECT * FROM reviews WHERE id = ?")
    .get(id) as RawReviewRow | undefined;

  if (row === undefined) return null;

  const rawAnnotations = db
    .prepare<[number]>("SELECT * FROM annotations WHERE review_id = ? ORDER BY id ASC")
    .all(id) as RawAnnotationRow[];

  return {
    ...row,
    annotations: rawAnnotations.map(parseAnnotationRow),
  };
}

// ---------------------------------------------------------------------------
// listReviews
// ---------------------------------------------------------------------------

export interface ListReviewsOptions {
  projectName?: string;
  limit?: number;
}

export function listReviews(
  db: Database.Database,
  options: ListReviewsOptions = {}
): ReviewRow[] {
  const { projectName, limit = 50 } = options;

  const rows = projectName
    ? (db
        .prepare<[string, number]>(
          `SELECT * FROM reviews WHERE project_name = ?
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(projectName, limit) as RawReviewRow[])
    : (db
        .prepare<[number]>(
          "SELECT * FROM reviews ORDER BY created_at DESC LIMIT ?"
        )
        .all(limit) as RawReviewRow[]);

  return rows.map((row) => {
    const rawAnnotations = db
      .prepare<[number]>("SELECT * FROM annotations WHERE review_id = ? ORDER BY id ASC")
      .all(row.id) as RawAnnotationRow[];
    return { ...row, annotations: rawAnnotations.map(parseAnnotationRow) };
  });
}

// ---------------------------------------------------------------------------
// searchReviews
// ---------------------------------------------------------------------------

export interface SearchReviewsOptions {
  limit?: number;
}

export function searchReviews(
  db: Database.Database,
  query: string,
  options: SearchReviewsOptions = {}
): ReviewRow[] {
  const { limit = 20 } = options;

  const rows = db
    .prepare<[string, number]>(
      `SELECT r.* FROM reviews r
       JOIN reviews_fts ON reviews_fts.rowid = r.id
       WHERE reviews_fts MATCH ?
       ORDER BY r.created_at DESC LIMIT ?`
    )
    .all(query, limit) as RawReviewRow[];

  return rows.map((row) => {
    const rawAnnotations = db
      .prepare<[number]>("SELECT * FROM annotations WHERE review_id = ? ORDER BY id ASC")
      .all(row.id) as RawAnnotationRow[];
    return { ...row, annotations: rawAnnotations.map(parseAnnotationRow) };
  });
}
