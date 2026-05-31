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

  it("buildDeeplink returns null (no public prompt deeplink scheme)", () => {
    // Windsurf has no documented prompt deeplink — fall back to clipboard (R8-S4).
    expect(adapter.buildDeeplink("some prompt")).toBeNull();
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

describe("Slice-4 path methods — CursorAdapter (R17-S1)", () => {
  const adapter = new CursorAdapter();

  it("getHooksConfigPath -> ~/.cursor/hooks.json", () => {
    expect(adapter.getHooksConfigPath()).toBe(
      path.join(os.homedir(), ".cursor", "hooks.json")
    );
  });

  it("getCursorRulesPath(ws) -> <ws>/.cursor/rules/vibelens.mdc", () => {
    expect(adapter.getCursorRulesPath("/work/proj")).toBe(
      path.join("/work/proj", ".cursor", "rules", "vibelens.mdc")
    );
  });

  it("getClaudeSettingsPath -> null", () => {
    expect(adapter.getClaudeSettingsPath()).toBeNull();
  });

  it("getSkillInstallPath -> null", () => {
    expect(adapter.getSkillInstallPath()).toBeNull();
  });
});

describe("Slice-4 path methods — VSCodeAdapter (R17-S2)", () => {
  const adapter = new VSCodeAdapter();

  it("getClaudeSettingsPath -> ~/.claude/settings.json", () => {
    expect(adapter.getClaudeSettingsPath()).toBe(
      path.join(os.homedir(), ".claude", "settings.json")
    );
  });

  it("getSkillInstallPath -> ~/.claude/skills/vibelens-explain-changes/SKILL.md", () => {
    expect(adapter.getSkillInstallPath()).toBe(
      path.join(
        os.homedir(),
        ".claude",
        "skills",
        "vibelens-explain-changes",
        "SKILL.md"
      )
    );
  });

  it("getHooksConfigPath -> null", () => {
    expect(adapter.getHooksConfigPath()).toBeNull();
  });

  it("getCursorRulesPath -> null", () => {
    expect(adapter.getCursorRulesPath("/work/proj")).toBeNull();
  });
});

describe("Slice-4 path methods — WindsurfAdapter (R17.4)", () => {
  const adapter = new WindsurfAdapter();

  it("getHooksConfigPath -> null (unverified, avoid bogus config)", () => {
    expect(adapter.getHooksConfigPath()).toBeNull();
  });

  it("getCursorRulesPath(ws) -> <ws>/.cursor/rules/vibelens.mdc (cursor-family)", () => {
    expect(adapter.getCursorRulesPath("/work/proj")).toBe(
      path.join("/work/proj", ".cursor", "rules", "vibelens.mdc")
    );
  });

  it("getClaudeSettingsPath + getSkillInstallPath -> null", () => {
    expect(adapter.getClaudeSettingsPath()).toBeNull();
    expect(adapter.getSkillInstallPath()).toBeNull();
  });
});

describe("Slice-4 path methods — FallbackAdapter (R17-S3)", () => {
  const adapter = new FallbackAdapter();

  it("all four return null and never throw", () => {
    expect(adapter.getHooksConfigPath()).toBeNull();
    expect(adapter.getClaudeSettingsPath()).toBeNull();
    expect(adapter.getSkillInstallPath()).toBeNull();
    expect(adapter.getCursorRulesPath("/work/proj")).toBeNull();
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
