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
│   └── writer-agent.yaml
├── model/
│   └── gpt-5-mini.yaml
├── prompt/
│   └── writer-prompt.md
└── tools/
    └── word-count.ts
```

`config.yaml`:

```yaml
name: content-assistant
agents:
  - writer-agent
logger:
  level: info
storage:
  type: libsql
  url: file:./mastra.db
```

`agent/writer-agent.yaml`:

```yaml
name: Writer
description: Drafts content for the user.
instructions: writer-prompt   # → prompt/writer-prompt.md
model: gpt-5-mini              # → model/gpt-5-mini.yaml
tools:
  - word-count                 # → tools/word-count.ts
```

`model/gpt-5-mini.yaml`:

```yaml
provider: openai
model: gpt-5-mini
temperature: 0.7
max_tokens: 2048
```

`prompt/writer-prompt.md`:

```md
You are a writing assistant. Given a topic or brief, produce a clear, well-structured
draft. Use the word-count tool to check the draft against the target length.
```

`tools/word-count.ts`:

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const wordCount = createTool({
  id: 'word-count',
  description: 'Counts the words in the given text.',
  inputSchema: z.object({ text: z.string().describe('Text to count words in') }),
  outputSchema: z.object({ words: z.number() }),
  execute: async (inputData) => ({
    words: inputData.text.trim().split(/\s+/).filter(Boolean).length,
  }),
});
```

## 2. Generate

```bash
npx @addorimprove/yamlai ./my-project ./out
```

Omit the output dir to default to `name` from `config.yaml`:

```bash
npx @addorimprove/yamlai ./my-project   # → ./content-assistant
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

## Optional: add memory

Add a `memory:` block to `config.yaml` and opt agents in with `memory: true`:

```yaml
storage:
  type: libsql
  url: file:./mastra.db
memory:
  last_messages: 20
  working_memory:
    template: "# Writing Preferences\n- Tone:\n- Audience:"
```

```yaml
# agent/writer-agent.yaml
memory: true   # opt in to the project memory
```

The generator emits `src/mastra/utils/memory.ts` and wires it into each opted-in agent. See [Memory reference](./reference/memory.md) for all options.

→ [YAML Reference](./reference/config.md) · [CLI Reference](./cli.md) · [Examples](./examples.md)
