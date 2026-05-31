import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDatabase } from "../connection.js";
import { saveReview, getReview } from "../store.js";

// Regression guard for the WAL/sql.js read bug:
// The MCP writes with a long-lived better-sqlite3 connection in WAL mode.
// Committed rows live in the `-wal` sidecar until SQLite checkpoints. The
// extension reader uses sql.js, which reads ONLY the main `.db` file bytes
// and cannot see the `-wal` sidecar. So an external reader observes a stale
// DB ("no such table: reviews") unless the writer flushes the WAL into the
// main file after each write. saveReview must checkpoint (TRUNCATE) so the
// `-wal` file is emptied and the main file reflects the write immediately.
describe("saveReview WAL checkpoint (file-backed DB)", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it("flushes the -wal sidecar to 0 bytes after a non-deduped save", () => {
    dir = mkdtempSync(join(tmpdir(), "vibelens-wal-"));
    const dbPath = join(dir, "vibelens.db");
    const db = openDatabase(dbPath);

    try {
      const result = saveReview(db, {
        title: "WAL regression",
        diff: "diff --git a/x b/x\n+line",
      });

      expect(result.deduped).toBe(false);

      // After TRUNCATE checkpoint, the WAL file is truncated to 0 bytes
      // (it may still exist while the connection is open).
      const walPath = `${dbPath}-wal`;
      const walSize = existsSync(walPath) ? statSync(walPath).size : 0;
      expect(walSize).toBe(0);

      // And the row is retrievable through the normal read path.
      const review = getReview(db, result.id);
      expect(review).not.toBeNull();
      expect(review?.title).toBe("WAL regression");
    } finally {
      db.close();
    }
  });
});
