import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveAdapter,
  CursorAdapter,
  VSCodeAdapter,
  WindsurfAdapter,
  FallbackAdapter,
} from "./adapter.js";

describe("CursorAdapter (R9-S1)", () => {
  const adapter = new CursorAdapter();

  it("buildDeeplink returns a cursor:// URL", () => {
    const url = adapter.buildDeeplink("some prompt");
    expect(url).not.toBeNull();
    expect(url!.startsWith("cursor://")).toBe(true);
  });

  it("encodes the prompt in the deeplink", () => {
    const url = adapter.buildDeeplink("a b&c");
    expect(url).toContain(encodeURIComponent("a b&c"));
  });

  it("getMcpConfigPath returns the Cursor config path", () => {
    expect(adapter.getMcpConfigPath()).toBe(
      path.join(os.homedir(), ".cursor", "mcp.json")
    );
  });

  it("logo is a non-empty SVG string", () => {
    expect(adapter.logo).toContain("<svg");
    expect(adapter.logo.length).toBeGreaterThan(0);
  });

  it("name is Cursor", () => {
    expect(adapter.name).toBe("Cursor");
  });
});

describe("VSCodeAdapter (R9-S2)", () => {
  const adapter = new VSCodeAdapter();

  it("buildDeeplink returns null (no deeplink scheme)", () => {
    expect(adapter.buildDeeplink("some prompt")).toBeNull();
  });

  it("getMcpConfigPath returns null (native API)", () => {
    expect(adapter.getMcpConfigPath()).toBeNull();
  });

  it("logo is a non-empty SVG string", () => {
    expect(adapter.logo).toContain("<svg");
  });

  it("name is VS Code", () => {
    expect(adapter.name).toBe("VS Code");
  });
});

describe("WindsurfAdapter (R9-S3)", () => {
  const adapter = new WindsurfAdapter();

  it("buildDeeplink returns a windsurf:// URL", () => {
    const url = adapter.buildDeeplink("some prompt");
    expect(url).not.toBeNull();
    expect(url!.startsWith("windsurf://")).toBe(true);
  });

  it("getMcpConfigPath returns the Windsurf config path", () => {
    expect(adapter.getMcpConfigPath()).toBe(
      path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json")
    );
  });

  it("logo is a non-empty SVG string", () => {
    expect(adapter.logo).toContain("<svg");
  });
});

describe("FallbackAdapter (R9-S4)", () => {
  const adapter = new FallbackAdapter();

  it("buildDeeplink returns null", () => {
    expect(adapter.buildDeeplink("some prompt")).toBeNull();
  });

  it("getMcpConfigPath returns null", () => {
    expect(adapter.getMcpConfigPath()).toBeNull();
  });

  it("does not throw on instantiation and exposes a logo", () => {
    expect(adapter.logo).toContain("<svg");
  });
});

describe("resolveAdapter (R9-S4 factory)", () => {
  it("returns CursorAdapter for a Cursor appName", () => {
    expect(resolveAdapter("Cursor")).toBeInstanceOf(CursorAdapter);
  });

  it("is case-insensitive (cursor)", () => {
    expect(resolveAdapter("cursor")).toBeInstanceOf(CursorAdapter);
  });

  it("returns WindsurfAdapter for a Windsurf appName", () => {
    expect(resolveAdapter("Windsurf")).toBeInstanceOf(WindsurfAdapter);
  });

  it("returns VSCodeAdapter for a Visual Studio Code appName", () => {
    expect(resolveAdapter("Visual Studio Code")).toBeInstanceOf(VSCodeAdapter);
  });

  it("returns a FallbackAdapter for an unrecognized appName without throwing", () => {
    const adapter = resolveAdapter("Some Unknown Editor 9000");
    expect(adapter).toBeInstanceOf(FallbackAdapter);
    expect(adapter.buildDeeplink("x")).toBeNull();
    expect(adapter.getMcpConfigPath()).toBeNull();
  });
});
