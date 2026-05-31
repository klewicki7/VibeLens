import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../db/connection.js";
import { getReview, listReviews } from "../db/store.js";
import { createShowDiffExplanationHandler, type HandlerDeps } from "../handler.js";
import { MAX_DIFF_BYTES } from "../schema.js";
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Test fixtures and helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_700_000_000_000;

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

function makeHandler(over: Partial<HandlerDeps> = {}) {
  return createShowDiffExplanationHandler({
    getDb: () => db,
    detectProject: () => ({
      root: "/repo",
      remote: "git@github.com:acme/widget.git",
      name: "widget",
    }),
    now: () => FIXED_NOW,
    maxDiffBytes: MAX_DIFF_BYTES,
    ...over,
  });
}

function buildRequest(args: Record<string, unknown>): CallToolRequest {
  return {
    method: "tools/call",
    params: {
      name: "show_diff_explanation",
      arguments: args,
    },
  };
}

async function call(
  handler: ReturnType<typeof makeHandler>,
  args: Record<string, unknown>
): Promise<{
  envelope: Record<string, unknown>;
  isError: boolean | undefined;
}> {
  const result = await handler(buildRequest(args));
  const item = result.content[0] as { type: string; text: string };
  const envelope = JSON.parse(item.text) as Record<string, unknown>;
  return { envelope, isError: result.isError };
}

const VALID_ARGS = {
  title: "Add auth",
  diff: "diff --git a/auth.ts b/auth.ts\n--- a/auth.ts\n+++ b/auth.ts\n@@ -1,1 +1,2 @@\n+export function auth() {}",
  summary: "Adds JWT auth",
  annotations: [
    {
      file: "src/auth.ts",
      line: 10,
      explanation: "New middleware",
      actions: [{ label: "Extract helper", prompt: "Move validation to validateToken()" }],
    },
  ],
};

// ---------------------------------------------------------------------------
// S-01: Valid input → success envelope + DB row
// ---------------------------------------------------------------------------
describe("S-01: valid input with annotations + actions", () => {
  it("returns ok:true envelope with reviewId, syncId, deduped:false", async () => {
    const handler = makeHandler();
    const { envelope, isError } = await call(handler, VALID_ARGS);

    expect(envelope.ok).toBe(true);
    expect(typeof envelope.reviewId).toBe("number");
    expect(typeof envelope.syncId).toBe("string");
    expect(envelope.deduped).toBe(false);
    expect(isError).toBeUndefined();
  });

  it("persists the row with correct project_name, project_remote, and created_at", async () => {
    const handler = makeHandler();
    const { envelope } = await call(handler, VALID_ARGS);

    const row = getReview(db, envelope.reviewId as number);
    expect(row).not.toBeNull();
    expect(row!.project_name).toBe("widget");
    expect(row!.project_remote).toBe("git@github.com:acme/widget.git");
    expect(row!.created_at).toBe(FIXED_NOW);
  });
});

// ---------------------------------------------------------------------------
// S-02: Dedup → second call returns deduped:true, same IDs, one DB row
// ---------------------------------------------------------------------------
describe("S-02: identical input within dedup window", () => {
  it("returns deduped:true on second call", async () => {
    const handler = makeHandler();
    const first = await call(handler, VALID_ARGS);
    const second = await call(handler, VALID_ARGS);

    expect(second.envelope.ok).toBe(true);
    expect(second.envelope.deduped).toBe(true);
    expect(second.envelope.reviewId).toBe(first.envelope.reviewId);
    expect(second.envelope.syncId).toBe(first.envelope.syncId);
  });

  it("results in exactly one DB row", async () => {
    const handler = makeHandler();
    await call(handler, VALID_ARGS);
    await call(handler, VALID_ARGS);

    const rows = listReviews(db);
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// S-03: Missing title → VALIDATION_FAILED, no DB write
// ---------------------------------------------------------------------------
describe("S-03: missing title", () => {
  it("returns VALIDATION_FAILED mentioning title", async () => {
    const handler = makeHandler();
    const { envelope, isError } = await call(handler, { diff: "some diff" });

    expect(envelope.ok).toBe(false);
    expect(envelope.error).toBe("VALIDATION_FAILED");
    expect((envelope.message as string).toLowerCase()).toContain("title");
    expect(isError).toBe(true);
  });

  it("does not write to DB", async () => {
    const handler = makeHandler();
    await call(handler, { diff: "some diff" });
    expect(listReviews(db)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// S-04: Missing diff → VALIDATION_FAILED, no DB write
// ---------------------------------------------------------------------------
describe("S-04: missing diff", () => {
  it("returns VALIDATION_FAILED mentioning diff", async () => {
    const handler = makeHandler();
    const { envelope, isError } = await call(handler, { title: "My change" });

    expect(envelope.ok).toBe(false);
    expect(envelope.error).toBe("VALIDATION_FAILED");
    expect((envelope.message as string).toLowerCase()).toContain("diff");
    expect(isError).toBe(true);
  });

  it("does not write to DB", async () => {
    const handler = makeHandler();
    await call(handler, { title: "My change" });
    expect(listReviews(db)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// S-05: Annotation action missing prompt → VALIDATION_FAILED, no DB write
// ---------------------------------------------------------------------------
describe("S-05: annotation action missing prompt", () => {
  it("returns VALIDATION_FAILED", async () => {
    const handler = makeHandler();
    const { envelope, isError } = await call(handler, {
      title: "My change",
      diff: "diff content",
      annotations: [
        {
          file: "src/foo.ts",
          explanation: "something",
          actions: [{ label: "Fix it" /* missing prompt */ }],
        },
      ],
    });

    expect(envelope.ok).toBe(false);
    expect(envelope.error).toBe("VALIDATION_FAILED");
    expect(isError).toBe(true);
  });

  it("does not write to DB", async () => {
    const handler = makeHandler();
    await call(handler, {
      title: "My change",
      diff: "diff content",
      annotations: [
        { file: "src/foo.ts", explanation: "something", actions: [{ label: "Fix it" }] },
      ],
    });
    expect(listReviews(db)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// S-06: Diff exactly at maxDiffBytes=10 → success (proves > not >=)
// ---------------------------------------------------------------------------
describe("S-06: diff exactly at byte limit", () => {
  it("succeeds when diff is exactly maxDiffBytes bytes", async () => {
    const maxBytes = 10;
    const handler = makeHandler({ maxDiffBytes: maxBytes });
    const diff = "a".repeat(maxBytes); // exactly 10 bytes in UTF-8
    expect(Buffer.byteLength(diff, "utf8")).toBe(maxBytes);

    const { envelope } = await call(handler, { title: "t", diff });
    expect(envelope.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S-07: Diff one byte over limit → DIFF_TOO_LARGE, detectProject/getDb NOT called
// ---------------------------------------------------------------------------
describe("S-07: diff one byte over limit", () => {
  it("returns DIFF_TOO_LARGE with isError:true", async () => {
    const maxBytes = 10;
    const diff = "a".repeat(maxBytes + 1); // 11 bytes
    expect(Buffer.byteLength(diff, "utf8")).toBe(maxBytes + 1);

    const handler = makeHandler({ maxDiffBytes: maxBytes });
    const { envelope, isError } = await call(handler, { title: "t", diff });

    expect(envelope.ok).toBe(false);
    expect(envelope.error).toBe("DIFF_TOO_LARGE");
    expect(envelope.message).toBeTruthy();
    expect(isError).toBe(true);
  });

  it("does not call detectProject or getDb (rejected before parse)", async () => {
    const maxBytes = 10;
    const diff = "a".repeat(maxBytes + 1);

    const detectProjectSpy = vi.fn(() => ({
      root: "/repo",
      remote: "git@github.com:acme/widget.git",
      name: "widget",
    }));
    const getDbSpy = vi.fn(() => db);

    const handler = makeHandler({
      maxDiffBytes: maxBytes,
      detectProject: detectProjectSpy,
      getDb: getDbSpy,
    });

    await call(handler, { title: "t", diff });

    expect(detectProjectSpy).not.toHaveBeenCalled();
    expect(getDbSpy).not.toHaveBeenCalled();
  });

  it("does not write to DB", async () => {
    const maxBytes = 10;
    const diff = "a".repeat(maxBytes + 1);
    const handler = makeHandler({ maxDiffBytes: maxBytes });
    await call(handler, { title: "t", diff });
    expect(listReviews(db)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// S-08: saveReview throws → UNKNOWN, no stack trace in message
// ---------------------------------------------------------------------------
describe("S-08: unexpected internal error", () => {
  it("returns UNKNOWN envelope without stack trace", async () => {
    const throwingGetDb = () => {
      throw new Error("db exploded");
    };
    const handler = makeHandler({ getDb: throwingGetDb as HandlerDeps["getDb"] });
    const { envelope, isError } = await call(handler, VALID_ARGS);

    expect(envelope.ok).toBe(false);
    expect(envelope.error).toBe("UNKNOWN");
    expect(typeof envelope.message).toBe("string");
    // Must not contain stack trace text
    expect(envelope.message as string).not.toMatch(/\bat\b/);
    expect(isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S-08b: UNKNOWN error does NOT leak raw error internals (secret paths etc.)
// ---------------------------------------------------------------------------
describe("S-08b: UNKNOWN error message is sanitized — no raw error details", () => {
  it("returns a fixed generic message, not the raw error.message", async () => {
    const secretPath = "/Users/secret/leak.db";
    const throwingGetDb = () => {
      throw new Error(`SQLITE_CANTOPEN: unable to open database file: ${secretPath}`);
    };

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const handler = makeHandler({ getDb: throwingGetDb as HandlerDeps["getDb"] });
    const { envelope, isError } = await call(handler, VALID_ARGS);

    // Envelope must use a generic message — not the raw error
    expect(envelope.ok).toBe(false);
    expect(envelope.error).toBe("UNKNOWN");
    expect(isError).toBe(true);
    expect(envelope.message).toBe("An unexpected error occurred while saving the review.");
    // Must not leak the secret path or any raw error detail
    expect(envelope.message as string).not.toContain("secret");
    expect(envelope.message as string).not.toContain(secretPath);
    expect(envelope.message as string).not.toContain("SQLITE_CANTOPEN");

    // The real error MUST be logged to stderr for debuggability
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const loggedArg = consoleErrorSpy.mock.calls[0][1] as Error;
    expect(loggedArg).toBeInstanceOf(Error);
    expect(loggedArg.message).toContain(secretPath);

    consoleErrorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// S-09: workspacePath provided → detectProject called with that path
// ---------------------------------------------------------------------------
describe("S-09: workspacePath given → project populated", () => {
  it("calls detectProject with the provided workspacePath", async () => {
    const detectProjectSpy = vi.fn(() => ({
      root: "/some/path",
      remote: "https://github.com/org/repo.git",
      name: "detected",
    }));

    const handler = makeHandler({ detectProject: detectProjectSpy });
    const { envelope } = await call(handler, { ...VALID_ARGS, workspacePath: "/some/path" });

    expect(envelope.ok).toBe(true);
    expect(detectProjectSpy).toHaveBeenCalledWith("/some/path");

    const row = getReview(db, envelope.reviewId as number);
    expect(row!.project_name).toBe("detected");
    expect(row!.project_remote).toBe("https://github.com/org/repo.git");
  });
});

// ---------------------------------------------------------------------------
// S-10: Non-git cwd → null-tolerant, still persists
// ---------------------------------------------------------------------------
describe("S-10: detectProject returns null-tolerant values", () => {
  it("persists with projectName='folder' and projectRemote null", async () => {
    const handler = makeHandler({
      detectProject: () => ({ root: null, remote: null, name: "folder" }),
    });

    const { envelope } = await call(handler, VALID_ARGS);

    expect(envelope.ok).toBe(true);
    const row = getReview(db, envelope.reviewId as number);
    expect(row!.project_name).toBe("folder");
    expect(row!.project_remote).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// W-2: editor field is validated AND persisted
// ---------------------------------------------------------------------------
describe("W-2: editor field persisted through handler", () => {
  it("persists editor:'cursor' when provided", async () => {
    const handler = makeHandler();
    const { envelope } = await call(handler, { ...VALID_ARGS, editor: "cursor" });

    expect(envelope.ok).toBe(true);
    const row = getReview(db, envelope.reviewId as number);
    expect(row).not.toBeNull();
    expect(row!.editor).toBe("cursor");
  });

  it("persists editor:'vscode' when provided", async () => {
    const handler = makeHandler();
    const { envelope } = await call(handler, { ...VALID_ARGS, editor: "vscode" });

    expect(envelope.ok).toBe(true);
    const row = getReview(db, envelope.reviewId as number);
    expect(row).not.toBeNull();
    expect(row!.editor).toBe("vscode");
  });

  it("persists editor as null when omitted", async () => {
    const handler = makeHandler();
    // VALID_ARGS has no editor field
    const { envelope } = await call(handler, VALID_ARGS);

    expect(envelope.ok).toBe(true);
    const row = getReview(db, envelope.reviewId as number);
    expect(row).not.toBeNull();
    expect(row!.editor).toBeNull();
  });
});
