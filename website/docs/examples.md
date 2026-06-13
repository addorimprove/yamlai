---
title: Examples
---

# Example: support agent

A complete project — YAML in, runnable Mastra TypeScript out.

## Input

```text
examples/
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

```yaml title="config.yaml"
name: my-mastra-app
agents:
  - support-agent
logger:
  level: info
storage:
  type: libsql
  url: file:./mastra.db
```

```yaml title="agent/support-agent.yaml"
name: Support Agent
description: Handles customer support questions.
instructions: support-prompt
model: gpt-5-mini
tools:
  - echo-tool
```

```yaml title="model/gpt-5-mini.yaml"
provider: openai
model: gpt-5-mini
temperature: 0.7
max_tokens: 2048
```

```md title="prompt/support-prompt.md"
You are a helpful support assistant. Be concise and accurate.
Use the echo-tool when you need to repeat the user's input back to them.
```

```typescript title="tools/echo-tool.ts"
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

## Generate

```bash
npx @addorimprove/yamlai ./examples ./my-mastra-app
```

## Output

```text
my-mastra-app/
├── package.json
├── tsconfig.json
└── src/mastra/
    ├── index.ts
    ├── agents/
    │   └── support-agent.ts
    └── tools/
        └── echo-tool.ts
```

```typescript title="src/mastra/index.ts"
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { supportAgent } from './agents/support-agent';

export const mastra = new Mastra({
  agents: { supportAgent },
  storage: new LibSQLStore({ id: 'mastra-storage', url: 'file:./mastra.db' }),
  logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
});
```

```typescript title="src/mastra/agents/support-agent.ts"
import { Agent } from '@mastra/core/agent';
import { echoTool } from '../tools/echo-tool';

export const supportAgent = new Agent({
  id: 'support-agent',
  name: 'Support Agent',
  description: 'Handles customer support questions.',
  instructions: `You are a helpful support assistant. Be concise and accurate.
Use the echo-tool when you need to repeat the user's input back to them.`,
  model: 'openai/gpt-5-mini',
  modelSettings: { temperature: 0.7, maxTokens: 2048 },
  tools: { echoTool },
});
```

Model inlined as the router string `openai/gpt-5-mini`; prompt inlined into `instructions`; `tools/echo-tool.ts` copied verbatim.

## Run

```bash
cd my-mastra-app
npm install
export OPENAI_API_KEY=sk-...
npm run dev
```
