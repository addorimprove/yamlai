---
title: Getting Started
---

# Getting Started

Requires **Node.js >= 22.13**.

## 1. Create the input project

```text
my-project/
├── config.yaml
├── agent/
│   └── support-agent.yaml
├── model/
│   └── gpt-5-mini.yaml
├── prompt/
│   └── support-prompt.md
└── tools/
    └── echo-tool.ts
```

`config.yaml`:

```yaml
name: my-mastra-app
agents:
  - support-agent
logger:
  level: info
storage:
  type: libsql
  url: file:./mastra.db
```

`agent/support-agent.yaml`:

```yaml
name: Support Agent
description: Handles customer support questions.
instructions: support-prompt   # → prompt/support-prompt.md
model: gpt-5-mini              # → model/gpt-5-mini.yaml
tools:
  - echo-tool                 # → tools/echo-tool.ts
```

`model/gpt-5-mini.yaml`:

```yaml
provider: openai
model: gpt-5-mini
temperature: 0.7
max_tokens: 2048
```

`prompt/support-prompt.md`:

```md
You are a helpful support assistant. Be concise and accurate.
Use the echo-tool when you need to repeat the user's input back to them.
```

`tools/echo-tool.ts`:

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const echoTool = createTool({
  id: 'echo-tool',
  description: 'Echoes the input text back.',
  inputSchema: z.object({ text: z.string().describe('Text to echo back') }),
  outputSchema: z.object({ text: z.string() }),
  execute: async (inputData) => ({ text: inputData.text }),
});
```

## 2. Generate

```bash
npx @addorimprove/yamlai ./my-project ./out
```

Omit the output dir to default to `name` from `config.yaml`:

```bash
npx @addorimprove/yamlai ./my-project   # → ./my-mastra-app
```

## 3. Run it

```bash
cd out
npm install
export OPENAI_API_KEY=sk-...   # provider key for the model at runtime
npm run dev                    # local Mastra playground
```

:::note
`--force` deletes and rewrites the whole output dir. Keep `.env` and hand-edits, or re-add them after regenerating.
:::

→ [YAML Reference](./reference/config.md) · [CLI Reference](./cli.md) · [Examples](./examples.md)
