import { z } from "zod";

// ---------------------------------------------------------------------------
// Signal file schema (~/.vibelens/pending.json)
//
// The signal is a pointer-only payload written atomically by the MCP after a
// review is persisted. It carries the reviewId the extension uses to read the
// full review from SQLite. MUST match packages/mcp/src/signal.ts writeSignal.
// ---------------------------------------------------------------------------

export const SignalSchema = z.object({
  reviewId: z.number().int().positive(),
  timestamp: z.number().int(),
  workspacePath: z.string().optional(),
});

export type SignalFile = z.infer<typeof SignalSchema>;

/**
 * Parses raw signal-file content. Returns null on any failure (bad JSON or
 * Zod-invalid payload) — worst case is simply that no panel is shown.
 */
export function parseSignal(content: string): SignalFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  const result = SignalSchema.safeParse(raw);
  return result.success ? result.data : null;
}
