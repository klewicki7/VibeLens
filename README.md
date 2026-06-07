<div align="center">

# VibeLens

**AI peer review for your code changes.**

Just like humans review each other's PRs, your AI reviews its own changes with inline annotations that appear directly in a VS Code/Cursor panel.

</div>

---

## Why AI Peer Review?

When humans write code, we do peer review. When AI writes code, we often scroll through chat hoping we understood what changed.

VibeLens gives AI the same workflow humans use: review the diff, annotate the changes, and explain the reasoning next to the code.

---

## How It Works

```text
AI makes changes -> AI reviews its own diff -> VibeLens opens an annotated panel
```

The AI calls the `show_diff_explanation` MCP tool after completing a task. The MCP server stores the review locally, and the VS Code/Cursor extension renders the diff with inline annotations.

Action buttons let you send improvement suggestions directly to Cursor chat.

---

## Features

- **Visual diff**: Side-by-side or unified view powered by diff2html.
- **Inline annotations**: Review comments appear directly after relevant code lines.
- **Action buttons**: Click to send prompts to Cursor chat, such as refactors or test suggestions.
- **Click to open**: File names link directly to the source.
- **Workspace-aware**: Only shows in the window matching your project.
- **Auto-configured MCP**: The extension configures `vibelens-mcp` for supported AI tools.

---

## Installation

### VS Code

Install `kevcode.vibelens-extension` from the Visual Studio Marketplace once published.

### Cursor

Install `kevcode.vibelens-extension` from Cursor's extension marketplace once the Open VSX listing syncs.

### VSIX

Download the `.vsix` from [GitHub Releases](https://github.com/klewicki7/VibeLens/releases) and install it from the Extensions view with "Install from VSIX...".

The extension automatically configures the MCP server on first activation where supported.

---

## Manual MCP Configuration

If auto-configuration does not work, add `vibelens-mcp` manually to your MCP client.

<details>
<summary><b>Cursor</b></summary>

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "vibelens": {
      "command": "npx",
      "args": ["-y", "vibelens-mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Claude Desktop</b></summary>

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vibelens": {
      "command": "npx",
      "args": ["-y", "vibelens-mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Windsurf</b></summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "vibelens": {
      "command": "npx",
      "args": ["-y", "vibelens-mcp"]
    }
  }
}
```

</details>

---

## Packages

| Package | Description |
|---------|-------------|
| [packages/extension](./packages/extension) | VS Code/Cursor extension that displays diff explanations |
| [packages/mcp](./packages/mcp) | MCP server with the `show_diff_explanation` tool |

---

## Architecture

```text
MCP Server                    VS Code/Cursor Extension
     |                              |
     | writes review data           | watches
     | ~/.vibelens/                 | ~/.vibelens/
     |                              |
     +----------------------------->|
                                    |
                                    v
                              Webview Panel
                         (diff + annotations)
```

---

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Build extension only
pnpm run build:extension

# Build MCP only
pnpm run build:mcp

# Package extension as .vsix
pnpm --filter vibelens-extension package
```

---

## Publishing

- **Extension**: Published as `kevcode.vibelens-extension` to VS Code Marketplace and Open VSX.
- **MCP package**: Published to npm as `vibelens-mcp`.
- **MCP Registry**: Registered as `io.github.klewicki7/vibelens-mcp`.

---

## License

MIT
