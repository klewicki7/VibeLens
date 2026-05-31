import * as fs from "node:fs/promises";
import initSqlJs from "sql.js";
import type { SqlJsStatic, Database } from "sql.js";
import {
  RawReviewRowSchema,
  RawAnnotationRowSchema,
  RawReviewSummaryRowSchema,
  type RawReviewRow,
  type RawAnnotationRow,
} from "./schema.js";

// ---------------------------------------------------------------------------
// ReviewReader — read-only sql.js (WASM) access to ~/.vibelens/vibelens.db
//
// Decision A: runs in the extension host (Node), wasm located by filesystem
// path (locateFile), NOT a webview URI.
// Decision B: opens the DB FRESH per read (new SQL.Database(bytes) → query →
// close). sql.js loads a byte snapshot, so a cached handle would be stale.
//
// Error handling:
//   - missing DB file (ENOENT)            → returns null (benign; not yet written)
//   - row not yet visible (read-after-write race) → one 100ms retry, then null
//   - corrupt DB / Zod validation failure → returns null + logs (never renders garbage)
//
// This is an IO adapter (touches fs + wasm); its pure helpers (schema, mapRow)
// are unit-tested separately. No unit test for this module (per tasks 1.5).
// ---------------------------------------------------------------------------

export interface ReviewBundle {
  review: RawReviewRow;
  annotations: RawAnnotationRow[];
}

// Lightweight summary for the review-history list (Slice 5). Carries no `diff`.
export interface ReviewSummary {
  id: number;
  title: string;
  created_at: number;
  project_name: string | null;
  summary: string | null;
}

export interface ListReviewsOptions {
  projectName: string | null;
  limit: number;
}

export interface ReviewReader {
  getReview(id: number): Promise<ReviewBundle | null>;
  // listReviews skips individual invalid rows (one corrupt historical row must
  // not blank the whole list), whereas getReview ABORTS the whole read on any
  // invalid row (a target review must never render partially). Deliberate,
  // documented difference — see ADR-5. Also opens the DB fresh per call (ADR-6)
  // with NO retry loop (history browsing is not a read-after-write race).
  listReviews(options: ListReviewsOptions): Promise<ReviewSummary[]>;
}

const RETRY_DELAY_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createReviewReader(
  locateFile: () => string,
  dbPath: string
): ReviewReader {
  let sqlJs: SqlJsStatic | null = null;

  async function getSqlJs(): Promise<SqlJsStatic> {
    if (sqlJs === null) {
      sqlJs = await initSqlJs({ locateFile });
    }
    return sqlJs;
  }

  async function readOnce(id: number): Promise<ReviewBundle | null> {
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(dbPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      console.error("[vibelens] failed to read DB file:", err);
      return null;
    }

    const SQL = await getSqlJs();
    let db: Database | null = null;
    try {
      db = new SQL.Database(bytes);

      const reviewStmt = db.prepare("SELECT * FROM reviews WHERE id = ?");
      reviewStmt.bind([id]);
      const reviewRaw = reviewStmt.step() ? reviewStmt.getAsObject() : null;
      reviewStmt.free();
      if (reviewRaw === null) return null;

      const annStmt = db.prepare(
        "SELECT * FROM annotations WHERE review_id = ? ORDER BY id ASC"
      );
      annStmt.bind([id]);
      const annRaws: unknown[] = [];
      while (annStmt.step()) {
        annRaws.push(annStmt.getAsObject());
      }
      annStmt.free();

      const review = RawReviewRowSchema.parse(reviewRaw);
      const annotations = annRaws.map((row) => RawAnnotationRowSchema.parse(row));
      return { review, annotations };
    } catch (err) {
      // Corrupt DB or Zod validation failure — do not render garbage (R4-S3).
      console.error("[vibelens] failed to read/validate review:", err);
      return null;
    } finally {
      db?.close();
    }
  }

  async function listReviewsOnce(
    projectName: string,
    limit: number
  ): Promise<ReviewSummary[]> {
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(dbPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      console.error("[vibelens] failed to read DB file for listReviews:", err);
      return [];
    }

    const SQL = await getSqlJs();
    let db: Database | null = null;
    try {
      db = new SQL.Database(bytes);
      // Column list explicit (no diff); idx_reviews_project_created covers it.
      const stmt = db.prepare(
        "SELECT id, title, summary, project_name, created_at FROM reviews WHERE project_name = ? ORDER BY created_at DESC LIMIT ?"
      );
      stmt.bind([projectName, limit]);

      const summaries: ReviewSummary[] = [];
      while (stmt.step()) {
        const raw = stmt.getAsObject();
        const parsed = RawReviewSummaryRowSchema.safeParse(raw);
        if (parsed.success) {
          summaries.push(parsed.data);
        } else {
          // Skip the single bad row (ADR-5) — do NOT abort the whole list.
          console.error("[vibelens] skipping invalid review summary row:", parsed.error);
        }
      }
      stmt.free();
      return summaries;
    } catch (err) {
      console.error("[vibelens] failed to list reviews:", err);
      return [];
    } finally {
      db?.close();
    }
  }

  return {
    async getReview(id: number): Promise<ReviewBundle | null> {
      const first = await readOnce(id);
      if (first !== null) return first;
      // Read-after-signal race guard: a single retry after 100ms.
      await delay(RETRY_DELAY_MS);
      return readOnce(id);
    },

    async listReviews(options: ListReviewsOptions): Promise<ReviewSummary[]> {
      // No active project → empty history without opening the DB (cheap+correct).
      // (WHERE project_name = NULL matches no rows in SQLite anyway.)
      if (options.projectName === null) return [];
      return listReviewsOnce(options.projectName, options.limit);
    },
  };
}
