import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { openDatabase } from "../connection.js";
import {
  saveReview,
  getReview,
  listReviews,
  searchReviews,
  computeContentHash,
} from "../store.js";
import type Database from "better-sqlite3";

const DEDUP_WINDOW = 5000;

function makeDb(): Database.Database {
  return openDatabase(":memory:");
}

describe("computeContentHash", () => {
  it("produces a hex string", () => {
    const hash = computeContentHash({ title: "t", diff: "d" });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is stable for the same inputs", () => {
    const a = computeContentHash({ title: "t", diff: "d", workspacePath: "/p" });
    const b = computeContentHash({ title: "t", diff: "d", workspacePath: "/p" });
    expect(a).toBe(b);
  });

  it("differs when workspacePath changes", () => {
    const a = computeContentHash({ title: "t", diff: "d", workspacePath: "/a" });
    const b = computeContentHash({ title: "t", diff: "d", workspacePath: "/b" });
    expect(a).not.toBe(b);
  });

  it("is stable when the same annotations are provided", () => {
    const anns = [{ file: "src/a.ts", line: 1, explanation: "note", actions: [{ label: "L", prompt: "P" }] }];
    const a = computeContentHash({ title: "t", diff: "d", annotations: anns });
    const b = computeContentHash({ title: "t", diff: "d", annotations: anns });
    expect(a).toBe(b);
  });

  it("differs when annotations change", () => {
    const annsA = [{ file: "src/a.ts", explanation: "note A" }];
    const annsB = [{ file: "src/a.ts", explanation: "note B" }];
    const a = computeContentHash({ title: "t", diff: "d", annotations: annsA });
    const b = computeContentHash({ title: "t", diff: "d", annotations: annsB });
    expect(a).not.toBe(b);
  });

  it("differs from hash with no annotations when annotations are provided", () => {
    const withAnns = computeContentHash({ title: "t", diff: "d", annotations: [{ file: "f.ts", explanation: "e" }] });
    const withoutAnns = computeContentHash({ title: "t", diff: "d" });
    expect(withAnns).not.toBe(withoutAnns);
  });
});

describe("saveReview + getReview", () => {
  it("inserts a review with annotations and returns them intact", () => {
    const db = makeDb();

    const result = saveReview(db, {
      title: "Add auth",
      diff: "diff --git a/auth.ts ...",
      summary: "Adds JWT auth",
      annotations: [
        {
          file: "src/auth.ts",
          line: 10,
          explanation: "New middleware",
          actions: [
            { label: "Extract helper", prompt: "Move validation to validateToken()" },
          ],
        },
      ],
      workspacePath: "/projects/app",
      editor: "cursor",
      projectName: "my-app",
      projectRemote: "https://github.com/user/my-app.git",
    });

    expect(result.deduped).toBe(false);
    expect(result.id).toBeGreaterThan(0);
    expect(result.sync_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );

    const review = getReview(db, result.id);
    expect(review).not.toBeNull();
    expect(review!.title).toBe("Add auth");
    expect(review!.summary).toBe("Adds JWT auth");
    expect(review!.editor).toBe("cursor");
    expect(review!.project_name).toBe("my-app");
    expect(review!.annotations).toHaveLength(1);

    const ann = review!.annotations[0];
    expect(ann.file).toBe("src/auth.ts");
    expect(ann.line).toBe(10);
    expect(ann.explanation).toBe("New middleware");
    // actions round-trip through JSON
    expect(ann.actions).toEqual([
      { label: "Extract helper", prompt: "Move validation to validateToken()" },
    ]);

    db.close();
  });

  it("handles null actions correctly (round-trip)", () => {
    const db = makeDb();

    const { id } = saveReview(db, {
      title: "No actions",
      diff: "diff --git a/x.ts ...",
      annotations: [{ file: "x.ts", explanation: "simple change" }],
    });

    const review = getReview(db, id);
    expect(review!.annotations[0].actions).toBeNull();

    db.close();
  });

  it("returns null for a non-existent id", () => {
    const db = makeDb();
    expect(getReview(db, 9999)).toBeNull();
    db.close();
  });
});

describe("deduplication", () => {
  it("returns the same id within the dedup window", () => {
    const db = makeDb();
    const base = 1_000_000;

    const first = saveReview(
      db,
      { title: "Same", diff: "diff --git a/f.ts ...", workspacePath: "/p" },
      base
    );
    expect(first.deduped).toBe(false);

    // Same content, 1 s later (still within 5 s window)
    const second = saveReview(
      db,
      { title: "Same", diff: "diff --git a/f.ts ...", workspacePath: "/p" },
      base + 1000
    );
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.sync_id).toBe(first.sync_id);

    db.close();
  });

  it("inserts a new row when outside the dedup window", () => {
    const db = makeDb();
    const base = 2_000_000;

    const first = saveReview(
      db,
      { title: "Same2", diff: "diff --git a/g.ts ...", workspacePath: "/q" },
      base
    );

    // 6 s later — beyond the 5 s window
    const second = saveReview(
      db,
      { title: "Same2", diff: "diff --git a/g.ts ...", workspacePath: "/q" },
      base + DEDUP_WINDOW + 1000
    );
    expect(second.deduped).toBe(false);
    expect(second.id).not.toBe(first.id);

    db.close();
  });

  it("does NOT dedup when same title/diff/workspacePath but DIFFERENT annotations (within window)", () => {
    const db = makeDb();
    const base = 8_000_000;
    const sharedFields = { title: "Ann-diff", diff: "diff --git a/z.ts ...", workspacePath: "/r" };

    const first = saveReview(
      db,
      { ...sharedFields, annotations: [{ file: "src/a.ts", explanation: "original note" }] },
      base
    );
    expect(first.deduped).toBe(false);

    // Same base fields, different annotations — still within dedup window
    const second = saveReview(
      db,
      { ...sharedFields, annotations: [{ file: "src/a.ts", explanation: "updated note" }] },
      base + 1000
    );
    expect(second.deduped).toBe(false);
    expect(second.id).not.toBe(first.id);

    // Each row must store its own annotations
    const rowA = getReview(db, first.id);
    const rowB = getReview(db, second.id);
    expect(rowA!.annotations[0].explanation).toBe("original note");
    expect(rowB!.annotations[0].explanation).toBe("updated note");

    db.close();
  });

  it("still dedupes when title/diff/workspacePath AND annotations are all identical (within window)", () => {
    const db = makeDb();
    const base = 9_000_000;
    const input = {
      title: "Full-match",
      diff: "diff --git a/m.ts ...",
      workspacePath: "/s",
      annotations: [{ file: "src/m.ts", explanation: "same note", actions: [{ label: "L", prompt: "P" }] }],
    };

    const first = saveReview(db, input, base);
    expect(first.deduped).toBe(false);

    const second = saveReview(db, input, base + 500);
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);

    db.close();
  });
});

describe("listReviews", () => {
  it("returns most-recent-first and respects limit", () => {
    const db = makeDb();
    const t = 3_000_000;

    saveReview(db, { title: "R1", diff: "d1" }, t);
    saveReview(db, { title: "R2", diff: "d2" }, t + 1000);
    saveReview(db, { title: "R3", diff: "d3" }, t + 2000);

    const all = listReviews(db);
    expect(all[0].title).toBe("R3");
    expect(all[all.length - 1].title).toBe("R1");

    const limited = listReviews(db, { limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0].title).toBe("R3");

    db.close();
  });

  it("filters by projectName", () => {
    const db = makeDb();
    const t = 4_000_000;

    saveReview(db, { title: "P1", diff: "diff1", projectName: "alpha" }, t);
    saveReview(db, { title: "P2", diff: "diff2", projectName: "beta" }, t + 1000);
    saveReview(db, { title: "P3", diff: "diff3", projectName: "alpha" }, t + 2000);

    const alpha = listReviews(db, { projectName: "alpha" });
    expect(alpha).toHaveLength(2);
    expect(alpha.every((r) => r.project_name === "alpha")).toBe(true);

    db.close();
  });
});

describe("searchReviews (FTS5)", () => {
  it("finds a review matching a term in the title", () => {
    const db = makeDb();
    const t = 5_000_000;

    saveReview(db, { title: "Implement OAuth login", diff: "diff --git a/auth.ts" }, t);
    saveReview(db, { title: "Fix typo in readme", diff: "diff --git a/README.md" }, t + 500);

    const results = searchReviews(db, "OAuth");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Implement OAuth login");

    db.close();
  });

  it("finds a review matching a term in the diff", () => {
    const db = makeDb();
    const t = 6_000_000;

    saveReview(
      db,
      {
        title: "Refactor services",
        diff: "diff --git a/service.ts\n+++ b/service.ts\n+export class UserService {",
      },
      t
    );

    const results = searchReviews(db, "UserService");
    expect(results).toHaveLength(1);

    db.close();
  });

  it("returns empty for a query with no match", () => {
    const db = makeDb();
    const t = 7_000_000;

    saveReview(db, { title: "Simple change", diff: "diff --git a/x.ts" }, t);

    const results = searchReviews(db, "nonexistentterm12345");
    expect(results).toHaveLength(0);

    db.close();
  });
});

describe("file-backed database", () => {
  const testDbs: string[] = [];

  afterEach(() => {
    for (const p of testDbs) {
      try {
        rmSync(p, { force: true });
      } catch {
        // ignore cleanup errors
      }
    }
    testDbs.length = 0;
  });

  it("persists data to disk", () => {
    const dir = tmpdir();
    const dbPath = join(dir, `vibelens-test-${randomUUID()}.db`);
    testDbs.push(dbPath);

    const db1 = openDatabase(dbPath);
    const { id } = saveReview(db1, { title: "Persisted", diff: "diff --git a/p.ts" });
    db1.close();

    const db2 = openDatabase(dbPath);
    const review = getReview(db2, id);
    expect(review).not.toBeNull();
    expect(review!.title).toBe("Persisted");
    db2.close();
  });
});
