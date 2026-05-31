import type { DiffExplanation, Annotation } from "../types";
import type { SignalFile } from "../signal/schema.js";
import type { RawReviewRow, RawAnnotationRow } from "./schema.js";
import { parseActionsColumn } from "./schema.js";

const EDITOR = {
  CURSOR: "cursor",
  VSCODE: "vscode",
} as const;

type Editor = (typeof EDITOR)[keyof typeof EDITOR];

/** Coerce an arbitrary stored editor value to a known editor; unknown → cursor. */
function coerceEditor(value: string | null): Editor {
  return value === EDITOR.VSCODE ? EDITOR.VSCODE : EDITOR.CURSOR;
}

function mapAnnotation(row: RawAnnotationRow): Annotation {
  const actions = parseActionsColumn(row.actions);
  return {
    file: row.file,
    line: row.line ?? undefined,
    explanation: row.explanation,
    actions: actions.length > 0 ? actions : undefined,
  };
}

/**
 * Assembles a DiffExplanation from a validated review row, its annotation rows,
 * and the triggering signal. The signal is authoritative for `timestamp`
 * (freshness), falling back to the review's created_at when absent. The editor
 * is coerced to a known value (unknown → 'cursor').
 */
export function mapToDiffExplanation(
  review: RawReviewRow,
  annotations: RawAnnotationRow[],
  signal: SignalFile
): DiffExplanation {
  return {
    title: review.title,
    summary: review.summary ?? undefined,
    diff: review.diff,
    annotations: annotations.map(mapAnnotation),
    editor: coerceEditor(review.editor),
    workspacePath: review.workspace_path ?? undefined,
    timestamp: signal.timestamp ?? review.created_at,
  };
}
