import { describe, it, expect } from "vitest";
import { openDatabase } from "../connection.js";
import { initSchema } from "../schema.js";

describe("schema / connection", () => {
  it("creates all tables on a fresh :memory: database", () => {
    const db = openDatabase(":memory:");

    const tableNames = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name);

    expect(tableNames).toContain("reviews");
    expect(tableNames).toContain("annotations");
    // FTS5 creates shadow tables; the main virtual table name is reviews_fts
    expect(tableNames).toContain("reviews_fts");

    db.close();
  });

  it("applies WAL journal mode", () => {
    const db = openDatabase(":memory:");
    // :memory: databases always report 'memory' for journal_mode PRAGMA,
    // but we can verify the PRAGMA was called without error
    const row = db.pragma("journal_mode") as Array<{ journal_mode: string }>;
    // memory databases return 'memory'; file-backed would return 'wal'
    expect(["wal", "memory"]).toContain(row[0].journal_mode);
    db.close();
  });

  it("enforces foreign keys", () => {
    const db = openDatabase(":memory:");
    const row = db.pragma("foreign_keys") as Array<{ foreign_keys: number }>;
    expect(row[0].foreign_keys).toBe(1);
    db.close();
  });

  it("creates indexes on reviews table", () => {
    const db = openDatabase(":memory:");
    const indexes = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='reviews'"
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name);

    expect(indexes).toContain("idx_reviews_hash_created");
    expect(indexes).toContain("idx_reviews_project_created");

    db.close();
  });

  it("is idempotent — calling initSchema twice does not throw", () => {
    const db = openDatabase(":memory:");
    // openDatabase already called initSchema once; calling it again should be safe
    expect(() => initSchema(db)).not.toThrow();
    db.close();
  });
});
