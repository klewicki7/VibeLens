import type Database from "better-sqlite3";

export function initSchema(db: Database.Database): void {
  addColumnIfNotExists(
    db,
    "reviews",
    "project_remote",
    "TEXT"
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id          TEXT    NOT NULL UNIQUE,
      title            TEXT    NOT NULL,
      summary          TEXT,
      diff             TEXT    NOT NULL,
      workspace_path   TEXT,
      project_name     TEXT,
      project_remote   TEXT,
      editor           TEXT,
      content_hash     TEXT    NOT NULL,
      created_at       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id     TEXT    NOT NULL UNIQUE,
      review_id   INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      file        TEXT    NOT NULL,
      line        INTEGER,
      explanation TEXT    NOT NULL,
      actions     TEXT,
      created_at  INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS reviews_fts
      USING fts5(title, summary, diff, content='reviews', content_rowid='id');

    CREATE INDEX IF NOT EXISTS idx_reviews_hash_created
      ON reviews(content_hash, created_at);

    CREATE INDEX IF NOT EXISTS idx_reviews_project_created
      ON reviews(project_name, created_at);
  `);

  // FTS5 triggers to keep the virtual table in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS reviews_fts_insert
      AFTER INSERT ON reviews BEGIN
        INSERT INTO reviews_fts(rowid, title, summary, diff)
          VALUES (new.id, new.title, new.summary, new.diff);
      END;

    CREATE TRIGGER IF NOT EXISTS reviews_fts_update
      AFTER UPDATE ON reviews BEGIN
        INSERT INTO reviews_fts(reviews_fts, rowid, title, summary, diff)
          VALUES ('delete', old.id, old.title, old.summary, old.diff);
        INSERT INTO reviews_fts(rowid, title, summary, diff)
          VALUES (new.id, new.title, new.summary, new.diff);
      END;

    CREATE TRIGGER IF NOT EXISTS reviews_fts_delete
      AFTER DELETE ON reviews BEGIN
        INSERT INTO reviews_fts(reviews_fts, rowid, title, summary, diff)
          VALUES ('delete', old.id, old.title, old.summary, old.diff);
      END;
  `);
}

/**
 * Idempotent migration helper — adds a column only if it does not yet exist.
 */
export function addColumnIfNotExists(
  db: Database.Database,
  table: string,
  column: string,
  ddl: string
): void {
  const rows = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;

  const exists = rows.some((row) => row.name === column);
  if (!exists && rows.length > 0) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}
