#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as os from "node:os";
import * as path from "node:path";
import { getDb } from "./db/connection.js";
import { detectProject } from "./project.js";
import { createShowDiffExplanationHandler } from "./handler.js";
import { writeSignal } from "./signal.js";
import { TOOL_INPUT_JSON_SCHEMA, MAX_DIFF_BYTES } from "./schema.js";

const VIBELENS_DIR = path.join(os.homedir(), ".vibelens");

// ---------------------------------------------------------------------------
// Production handler — wired with real DB singleton, real project detection,
// real clock, and the schema-derived byte limit.
// ---------------------------------------------------------------------------

const showDiffHandler = createShowDiffExplanationHandler({
  getDb,
  detectProject,
  now: () => Date.now(),
  maxDiffBytes: MAX_DIFF_BYTES,
  onReviewSaved: (info) => writeSignal(VIBELENS_DIR, info),
});

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: "vibelens-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  }
);

// ---------------------------------------------------------------------------
// Prompt constant
// ---------------------------------------------------------------------------

const VIBELENS_PROMPT = `Explain code changes visually using the VibeLens extension.

## Instructions

1. **Get the diff** - Use what you already have from the conversation context. Only run \`git diff\` if you don't have the changes:
   - Last commit: \`git diff HEAD~1 HEAD\`
   - Staged: \`git diff --cached\`
   - Working dir: \`git diff\`

2. **Analyze and annotate** - Prepare explanations for key parts of the changes

3. **Call \`show_diff_explanation\`** with:
   - \`title\`: Descriptive title
   - \`summary\`: 1-2 sentence overview
   - \`diff\`: The diff content as a string (the actual text, not a shell command)
   - \`annotations\`: Array of { file, line, explanation, actions? } for key changes
   - \`workspacePath\`: The absolute path to the current project folder (use \`pwd\` or equivalent)

4. **Write factual annotations** - Explain WHAT the code does based on the code itself. Don't fabricate intent.

## Reviewer Actions

For each annotation, think about what a code reviewer might want to change or improve. Generate specific, actionable suggestions:

**Good actions (specific, contextual):**
- "Extract to useAuth hook" → prompt includes the code and explains the refactor
- "Use early return pattern" → prompt shows current nested code and suggested structure
- "Add input validation" → prompt specifies what validation is missing
- "Rename to fetchUserData" → prompt explains why the new name is clearer

**Bad actions (generic, unhelpful):**
- "Refactor this" (too vague)
- "Add tests" (no context)
- "Improve code" (meaningless)

Each action's prompt MUST include:
1. The specific change being suggested
2. The relevant code snippet with file path and line numbers
3. Why this change would improve the code

Example action:
\`\`\`json
{
  "label": "Extract validation logic",
  "prompt": "Extract the token validation into a separate validateToken function for reusability.\\n\\nCurrent code in src/middleware/auth.ts:10-16:\\n\\\`\\\`\\\`typescript\\nif (!token) {\\n  return res.status(401).json({ error: 'No token' });\\n}\\nconst decoded = jwt.verify(token, secret);\\n\\\`\\\`\\\`\\n\\nThis would allow reusing validation in WebSocket handlers."
}
\`\`\`

Each annotation can have multiple actions if there are several ways to improve that specific piece of code.`;

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "show_diff_explanation",
        description: `Shows a git diff with annotations in the VibeLens extension panel.

Use this tool after analyzing code changes to present the diff visually with your explanations.

The tool will:
1. Save the diff and annotations to the local SQLite database
2. Return a structured envelope with a reviewId for tracking`,
        inputSchema: TOOL_INPUT_JSON_SCHEMA,
      },
    ],
  };
});

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "vibelens",
        description: "Instructions for explaining code changes with the VibeLens extension",
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name } = request.params;

  if (name === "vibelens") {
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: VIBELENS_PROMPT,
          },
        },
      ],
    };
  }

  throw new Error(`Unknown prompt: ${name}`);
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "show_diff_explanation") {
    return showDiffHandler(request);
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ok: false,
          error: "UNKNOWN",
          message: `Unknown tool: ${request.params.name}`,
        }),
      },
    ],
    isError: true,
  };
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VibeLens MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
