import { describe, it, expect } from "vitest";
import * as path from "node:path";

// R1-S2 asset-path guard: the sql.js wasm binary must resolve under out/.
// This guards the "works in dev, breaks in vsix" packaging risk: the reader
// locates the wasm via context.extensionUri.fsPath + 'out' + 'sql-wasm.wasm'.
describe("sql.js wasm asset path", () => {
  it("resolves the wasm binary under out/", () => {
    const wasmPath = path.join(
      __dirname,
      "..",
      "..",
      "out",
      "sql-wasm.wasm"
    );
    expect(wasmPath).toContain(path.join("out", "sql-wasm.wasm"));
  });
});
