import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// writeSignal — atomic pointer-only signal file (~/.vibelens/pending.json)
//
// After a review is persisted, the MCP writes a tiny signal that the extension
// watches. It carries only the reviewId (the extension reads the full review
// from SQLite). The shape is the contract validated by the extension's
// SignalSchema (packages/extension/src/signal/schema.ts).
//
// Atomic write: write to a temp file then rename, so a watcher never observes
// a half-written file and a crash mid-write cannot corrupt pending.json.
// ---------------------------------------------------------------------------

export interface SignalInfo {
  reviewId: number;
  workspacePath?: string;
  timestamp: number;
}

const SIGNAL_FILENAME = "pending.json";

export function writeSignal(dir: string, info: SignalInfo): void {
  fs.mkdirSync(dir, { recursive: true });

  const payload: SignalInfo = {
    reviewId: info.reviewId,
    timestamp: info.timestamp,
    ...(info.workspacePath !== undefined ? { workspacePath: info.workspacePath } : {}),
  };

  const finalPath = path.join(dir, SIGNAL_FILENAME);
  const tmpPath = path.join(dir, `${SIGNAL_FILENAME}.${process.pid}.tmp`);

  fs.writeFileSync(tmpPath, JSON.stringify(payload), "utf-8");
  fs.renameSync(tmpPath, finalPath);
}
