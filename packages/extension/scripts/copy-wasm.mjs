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

// Resolve the wasm binary via the package's "./dist/*" export.
const src = require.resolve("sql.js/dist/sql-wasm.wasm");
const dest = join(outDir, "sql-wasm.wasm");

mkdirSync(outDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[copy:wasm] ${src} -> ${dest}`);
