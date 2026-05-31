import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { initSchema } from "./schema.js";

const DEFAULT_DB_PATH = join(homedir(), ".vibelens", "vibelens.db");

/** Open a SQLite database, apply PRAGMAs, and initialize the schema. */
export function openDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? DEFAULT_DB_PATH;

  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true, mode: 0o700 });
  }

  const db = new Database(resolvedPath);

  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");

  initSchema(db);

  return db;
}

let _singleton: Database.Database | null = null;

/**
 * Returns the lazy singleton database instance for production use.
 * Use openDatabase(path) directly in tests to avoid shared state.
 */
export function getDb(): Database.Database {
  if (_singleton === null) {
    _singleton = openDatabase();
  }
  return _singleton;
}
