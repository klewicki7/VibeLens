// EditorAdapter — Strategy pattern at the extension boundary (design Decision,
// spec R9). Pure except for reading `os.homedir()` for config paths; the factory
// takes `appName` as a parameter so it is unit-testable without the `vscode`
// global. NO `vscode` import here.
import * as os from "node:os";
import * as path from "node:path";

const CURSOR_LOGO =
  '<svg fill="none" height="16" width="16" viewBox="0 0 22 22"><g clip-path="url(#a)" fill="currentColor"><path d="M19.162 5.452 10.698.565a.88.88 0 0 0-.879 0L1.356 5.452a.74.74 0 0 0-.37.64v9.853a.74.74 0 0 0 .37.64l8.464 4.887a.879.879 0 0 0 .879 0l8.464-4.886a.74.74 0 0 0 .37-.64V6.091a.74.74 0 0 0-.37-.64Zm-.531 1.035L10.46 20.639c-.055.095-.201.056-.201-.055v-9.266a.52.52 0 0 0-.26-.45L1.975 6.237c-.096-.056-.057-.202.054-.202h16.34c.233 0 .378.252.262.453Z"/></g></svg>';

const VSCODE_LOGO =
  '<svg fill="none" height="16" width="16" viewBox="0 0 24 24"><path fill="currentColor" d="M17.583 3.104l-5.477 4.984-5.45-4.239-2.656 1.27v13.762l2.656 1.27 5.45-4.239 5.477 4.984L21 18.986V5.014l-3.417-1.91zM5.5 16.5v-9l3.5 4.5-3.5 4.5zm7.5-4.5l-5 4.5V7.5l5 4.5zm5.5 4.5l-3.5-4.5 3.5-4.5v9z"/></svg>';

/**
 * Contract every editor strategy implements.
 *
 * - `getMcpConfigPath` → `null` means the editor has no file-based MCP config
 *   (VS Code 1.101+ uses a native API).
 * - `buildDeeplink` → `null` means the editor exposes no deeplink scheme, so the
 *   caller MUST fall back to clipboard (spec R8-S4).
 */
export interface IEditorAdapter {
  readonly name: string;
  readonly editorKey: "cursor" | "vscode";
  getMcpConfigPath(): string | null;
  buildDeeplink(prompt: string): string | null;
  readonly logo: string;

  // --- Enforcement paths. Each returns `null` when the location does not apply
  // to this editor, so the activate() composition root simply skips null paths.
  // Claude Code rides the VS Code family (appName).
  /**
   * Cursor hooks config (`~/.cursor/hooks.json`); null for non-Cursor. VibeLens
   * no longer installs hooks — this locates the file for legacy-hook cleanup.
   */
  getHooksConfigPath(): string | null;
  /**
   * Claude Code settings (`~/.claude/settings.json`); null off the CC family.
   * Used to locate the file for legacy-hook cleanup, not to install hooks.
   */
  getClaudeSettingsPath(): string | null;
  /** Claude Code skill file (`~/.claude/skills/.../SKILL.md`); null otherwise. */
  getSkillInstallPath(): string | null;
  /** Cursor project rule (`<ws>/.cursor/rules/vibelens.mdc`); null otherwise. */
  getCursorRulesPath(workspaceRoot: string): string | null;
}

export class CursorAdapter implements IEditorAdapter {
  readonly name = "Cursor";
  readonly editorKey = "cursor" as const;
  readonly logo = CURSOR_LOGO;

  getMcpConfigPath(): string | null {
    return path.join(os.homedir(), ".cursor", "mcp.json");
  }

  buildDeeplink(prompt: string): string | null {
    return `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(prompt)}`;
  }

  getHooksConfigPath(): string | null {
    return path.join(os.homedir(), ".cursor", "hooks.json");
  }

  getClaudeSettingsPath(): string | null {
    return null;
  }

  getSkillInstallPath(): string | null {
    return null;
  }

  getCursorRulesPath(workspaceRoot: string): string | null {
    return path.join(workspaceRoot, ".cursor", "rules", "vibelens.mdc");
  }
}

export class WindsurfAdapter implements IEditorAdapter {
  readonly name = "Windsurf";
  // Windsurf is Cursor-family for rendering; reuse the cursor logo + key.
  readonly editorKey = "cursor" as const;
  readonly logo = CURSOR_LOGO;

  getMcpConfigPath(): string | null {
    return path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json");
  }

  // Windsurf has no public prompt deeplink scheme — fall back to clipboard (R8-S4).
  buildDeeplink(_prompt: string): string | null {
    return null;
  }

  // Windsurf hooks.json location is unverified (design Risk 7) — return null
  // until confirmed so we never write a bogus config.
  getHooksConfigPath(): string | null {
    return null;
  }

  getClaudeSettingsPath(): string | null {
    return null;
  }

  getSkillInstallPath(): string | null {
    return null;
  }

  // Cursor-family: project rules live under `.cursor/rules` (R17.4).
  getCursorRulesPath(workspaceRoot: string): string | null {
    return path.join(workspaceRoot, ".cursor", "rules", "vibelens.mdc");
  }
}

export class VSCodeAdapter implements IEditorAdapter {
  readonly name = "VS Code";
  readonly editorKey = "vscode" as const;
  readonly logo = VSCODE_LOGO;

  // VS Code 1.101+ configures MCP through a native API, not a JSON file.
  getMcpConfigPath(): string | null {
    return null;
  }

  // VS Code has no deeplink scheme → clipboard fallback (spec R8-S4, R9-S2).
  buildDeeplink(_prompt: string): string | null {
    return null;
  }

  getHooksConfigPath(): string | null {
    return null;
  }

  // Claude Code rides the VS Code appName, so CC artifacts live on this adapter.
  getClaudeSettingsPath(): string | null {
    return path.join(os.homedir(), ".claude", "settings.json");
  }

  getSkillInstallPath(): string | null {
    return path.join(
      os.homedir(),
      ".claude",
      "skills",
      "vibelens-explain-changes",
      "SKILL.md"
    );
  }

  getCursorRulesPath(_workspaceRoot: string): string | null {
    return null;
  }
}

/**
 * Graceful fallback for an unrecognized `appName` (spec R9-S4). Never throws;
 * exposes no config path and no deeplink, so the caller copies to clipboard.
 */
export class FallbackAdapter implements IEditorAdapter {
  readonly name = "Unknown";
  readonly editorKey = "vscode" as const;
  readonly logo = VSCODE_LOGO;

  getMcpConfigPath(): string | null {
    return null;
  }

  buildDeeplink(_prompt: string): string | null {
    return null;
  }

  getHooksConfigPath(): string | null {
    return null;
  }

  getClaudeSettingsPath(): string | null {
    return null;
  }

  getSkillInstallPath(): string | null {
    return null;
  }

  getCursorRulesPath(_workspaceRoot: string): string | null {
    return null;
  }
}

/**
 * Resolve the right strategy from `vscode.env.appName`. Branches on a
 * lowercased substring match; anything unrecognized yields a {@link FallbackAdapter}.
 */
export function resolveAdapter(appName: string): IEditorAdapter {
  const name = appName.toLowerCase();

  if (name.includes("cursor")) {
    return new CursorAdapter();
  }
  if (name.includes("windsurf")) {
    return new WindsurfAdapter();
  }
  if (name.includes("visual studio code") || name.includes("vscode") || name.includes("code")) {
    return new VSCodeAdapter();
  }
  return new FallbackAdapter();
}
