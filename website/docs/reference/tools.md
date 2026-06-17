---
title: "tools/<id>.ts"
---

# tools/&lt;id&gt;.ts

A **TypeScript module** (not YAML) exporting one Mastra tool via `createTool`. The id is the filename (`tools/echo-tool.ts` → id `echo-tool`); the file **must export** its camelCase form (`echoTool`) — `validate` checks the file exists *and* declares that export (the [id must also be a valid identifier](./config.md#id-naming)). Selected by an agent's [`tools:`](./agent.md) list. The file is copied **verbatim** into the output.

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const echoTool = createTool({
  id: 'echo-tool',
  description: 'Echoes the input text back.',
  inputSchema: z.object({
    text: z.string().describe('Text to echo back'),
  }),
  outputSchema: z.object({
    text: z.string(),
  }),
  execute: async (inputData) => {
    return { text: inputData.text };
  },
});
```

## Module shape

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Should equal the filename (tool id). |
| `description` | string | Yes | Tells the model when to use the tool. |
| `inputSchema` | Zod | Yes | Validates input. |
| `outputSchema` | Zod | No | Validates output. |
| `execute` | function | Yes | `(inputData) => output`; may be `async`. |

## Generated output

Copied as-is to `src/mastra/tools/<id>.ts` (once, even if shared by multiple agents). Each referencing agent imports it:

```typescript
import { echoTool } from '../tools/echo-tool';
// ...
  tools: { echoTool },
```
