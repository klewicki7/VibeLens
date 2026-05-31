// Pure CSP / nonce helpers for the webview (no `vscode` import — unit-tested).
// See design Decision C: strict CSP with a per-load nonce; style-src must also
// include ${cspSource} so diff2html's runtime-injected <style> tags render.
import { randomBytes } from "node:crypto";

/**
 * Generate a fresh CSP nonce: 16 bytes of randomness, base64-encoded.
 * A new value MUST be produced on every webview load (R5-S1).
 */
export function getNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * Build the strict Content-Security-Policy string.
 *
 * Locked policy (design Decision C, spec R5):
 *   default-src 'none';
 *   script-src 'nonce-{n}';                 // no 'unsafe-inline', no external origins
 *   style-src 'nonce-{n}' ${cspSource};     // cspSource covers diff2html runtime <style>
 *   font-src ${cspSource};
 *   img-src ${cspSource} data:;
 *   connect-src 'none';
 *
 * @param cspSource the webview's `webview.cspSource` (local-resource origin).
 * @param nonce a freshly generated nonce from {@link getNonce}.
 */
export function buildCsp(cspSource: string, nonce: string): string {
  return [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}' ${cspSource}`,
    `font-src ${cspSource}`,
    `img-src ${cspSource} data:`,
    `connect-src 'none'`,
  ].join("; ") + ";";
}
