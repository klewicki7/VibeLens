#!/usr/bin/env node
// Copies the sql.js WASM binary into out/ so the packaged extension (.vsix)
// can locate it at runtime via context.extensionUri.fsPath + 'out/sql-wasm.wasm'.
// See design Decision A: sql.js runs in the extension host, wasm located by
// filesystem path (NOT asWebviewUri).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const pkgRoot = join(__dirname, "..");
const outDir = join(pkgRoot, "out");

mkdirSync(outDir, { recursive: true });

// Resolve the wasm binary via the package's "./dist/*" export.
const wasmSrc = require.resolve("sql.js/dist/sql-wasm.wasm");
const wasmDest = join(outDir, "sql-wasm.wasm");
copyFileSync(wasmSrc, wasmDest);
console.log(`[copy:wasm] ${wasmSrc} -> ${wasmDest}`);

// Bundle diff2html JS + CSS locally so the webview never loads a CDN.
// See design Decision C (diff2html under strict CSP) and spec R6 (local assets).
const diff2htmlAssets = [
  ["diff2html/bundles/js/diff2html-ui.min.js", "diff2html-ui.min.js"],
  ["diff2html/bundles/css/diff2html.min.css", "diff2html.min.css"],
];

for (const [specifier, outName] of diff2htmlAssets) {
  const assetSrc = require.resolve(specifier);
  const assetDest = join(outDir, outName);
  copyFileSync(assetSrc, assetDest);
  console.log(`[copy:assets] ${assetSrc} -> ${assetDest}`);
}
