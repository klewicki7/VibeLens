// Pure helper for the C1 confirmation gate (no `vscode` import — unit-tested).
// See design Decision D: before opening a deeplink the extension shows a native
// modal with a bounded preview of the prompt; the full prompt stays reachable
// via a "Copy full prompt" choice.

/**
 * Build a bounded preview of a prompt for the confirmation modal.
 *
 * If the prompt is longer than `maxLen`, return the first `maxLen` characters
 * followed by a single ellipsis (`…`). Otherwise return the prompt unchanged.
 *
 * @param prompt the full prompt text the action would send.
 * @param maxLen maximum number of prompt characters to show before truncating
 *   (spec R8-S3 uses 500).
 */
export function buildPreview(prompt: string, maxLen: number): string {
  if (prompt.length <= maxLen) {
    return prompt;
  }
  return prompt.slice(0, maxLen) + "…";
}
