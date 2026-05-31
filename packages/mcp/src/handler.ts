import { z } from "zod";
import type Database from "better-sqlite3";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ToolInputSchema } from "./schema.js";
import type { Envelope } from "./schema.js";
import { saveReview } from "./db/store.js";
import type { ProjectInfo } from "./project.js";

// ---------------------------------------------------------------------------
// HandlerDeps — dependency injection interface
// ---------------------------------------------------------------------------

export interface HandlerDeps {
  /** Returns the database instance. Tests inject () => openDatabase(":memory:"). */
  getDb: () => Database.Database;
  /** Detects project info from the given cwd. Never throws. */
  detectProject: (cwd: string) => ProjectInfo;
  /** Clock function. Tests inject a fixed timestamp. */
  now: () => number;
  /** Maximum allowed diff size in bytes (strict >) before Zod parse. */
  maxDiffBytes: number;
  /**
   * Optional hook invoked after a review is successfully persisted. Used to
   * write the extension signal file. A throw here MUST NOT fail the tool call
   * (the review is already saved) — the handler swallows callback errors.
   */
  onReviewSaved?: (info: {
    reviewId: number;
    workspacePath?: string;
    timestamp: number;
  }) => void;
}

// ---------------------------------------------------------------------------
// toResult — build a CallToolResult from an Envelope
// ---------------------------------------------------------------------------

function toResult(env: Envelope): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(env) }],
    isError: env.ok ? undefined : true,
  };
}

// ---------------------------------------------------------------------------
// createShowDiffExplanationHandler
// ---------------------------------------------------------------------------

export function createShowDiffExplanationHandler(
  deps: HandlerDeps
): (request: CallToolRequest) => Promise<CallToolResult> {
  return async (request: CallToolRequest): Promise<CallToolResult> => {
    const rawArgs = (request.params.arguments ?? {}) as Record<string, unknown>;

    try {
      // Step 1: Size guard — executed BEFORE Zod parse and DB access.
      // If diff is missing/non-string we skip the size guard and let Zod reject it.
      const rawDiff = typeof rawArgs.diff === "string" ? rawArgs.diff : "";
      if (rawDiff.length > 0 && Buffer.byteLength(rawDiff, "utf8") > deps.maxDiffBytes) {
        return toResult({
          ok: false,
          error: "DIFF_TOO_LARGE",
          message: `Diff exceeds the maximum allowed size of ${deps.maxDiffBytes} bytes (received ${Buffer.byteLength(rawDiff, "utf8")} bytes). Split the diff into smaller chunks.`,
        });
      }

      // Step 2: Zod parse
      const parsed = ToolInputSchema.parse(rawArgs);

      // Step 3: Project detection
      const project = deps.detectProject(parsed.workspacePath ?? process.cwd());

      // Step 4: Map project fields — remote null → undefined (z.string().optional() rejects null)
      const projectName = project.name;
      const projectRemote = project.remote ?? undefined;

      // Step 5: Persist
      const result = saveReview(
        deps.getDb(),
        { ...parsed, projectName, projectRemote },
        deps.now()
      );

      // Step 5.5: Signal the extension that a review was saved. A failed
      // signal write must NOT fail the tool call — the review is persisted.
      try {
        deps.onReviewSaved?.({
          reviewId: result.id,
          workspacePath: parsed.workspacePath,
          timestamp: deps.now(),
        });
      } catch (signalErr) {
        console.error("[vibelens-mcp] onReviewSaved hook failed (ignored):", signalErr);
      }

      // Step 6: Success envelope
      return toResult({
        ok: true,
        reviewId: result.id,
        syncId: result.sync_id,
        deduped: result.deduped,
      });
    } catch (err) {
      // Single catch — discriminate ZodError vs unexpected
      if (err instanceof z.ZodError) {
        const message = err.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        return toResult({ ok: false, error: "VALIDATION_FAILED", message });
      }

      // Unknown error — log real details to stderr for debuggability, but
      // return a fixed generic message to the client (no paths, no internals).
      console.error("[vibelens-mcp] Unexpected error in show_diff_explanation handler:", err);
      return toResult({
        ok: false,
        error: "UNKNOWN",
        message: "An unexpected error occurred while saving the review.",
      });
    }
  };
}
