// Pure marker-delimited text-block merge for CLAUDE.md / .cursor/rules / AGENTS.md
// (design Decision B, spec R15).
//
// Text files have no schema to corrupt, so unlike the JSON merges this NEVER
// errors: the result is `{ text } | { noop: true }`. The block VibeLens owns is
// delimited by `<!-- vibelens:hooks -->` ... `<!-- /vibelens:hooks -->`. On
// re-run only the content strictly between the markers is replaced; all
// surrounding prose is preserved byte-for-byte. When the markers are absent the
// block is appended. All fs reads/writes live in extension.ts.
//
// NO `vscode` import here.

export const VIBELENS_BEGIN = "<!-- vibelens:hooks -->" as const;
export const VIBELENS_END = "<!-- /vibelens:hooks -->" as const;

export interface MergeTextOk {
  text: string;
}

export interface MergeNoopResult {
  noop: true;
}

/** Text merges never error — files are always mergeable. */
export type MergeTextResult = MergeTextOk | MergeNoopResult;

/**
 * Upserts the VibeLens marker block into a text document.
 *
 * @param existingRaw raw file contents, or `null` when the file is absent.
 * @param blockBody the canonical body to place between the markers (no markers).
 * @returns
 *  - `{ noop: true }` when the marker block already contains exactly `blockBody`
 *    (R15-S3) — no write.
 *  - `{ text }` with the block updated in place (R15-S2), appended to existing
 *    content (R15-S1), or as the sole content when the file was absent (R15-S4).
 */
export function mergeTextSection(
  existingRaw: string | null,
  blockBody: string
): MergeTextResult {
  const block = `${VIBELENS_BEGIN}\n${blockBody}\n${VIBELENS_END}`;

  if (existingRaw === null || existingRaw === "") {
    // R15-S4: create a file containing only the marker block.
    return { text: `${block}\n` };
  }

  const beginIdx = existingRaw.indexOf(VIBELENS_BEGIN);
  const endIdx = existingRaw.indexOf(VIBELENS_END);

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    // R15-S2/S3: markers present — replace strictly between them.
    const before = existingRaw.slice(0, beginIdx);
    const after = existingRaw.slice(endIdx + VIBELENS_END.length);
    const next = `${before}${block}${after}`;
    if (next === existingRaw) {
      return { noop: true };
    }
    return { text: next };
  }

  // R15-S1: markers absent — append the block, preserving prior content.
  return { text: `${existingRaw}\n${block}\n` };
}
