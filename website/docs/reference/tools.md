---
title: "tools/<id>.ts"
---

# tools/&lt;id&gt;.ts

A **TypeScript module** (not YAML) exporting one Mastra tool via `createTool`. The id is the filename (`tools/word-count.ts` → id `word-count`); the file **must export** its camelCase form (`wordCount`) — `validate` checks the file exists *and* declares that export (the [id must also be a valid identifier](./config.md#id-naming)). Selected by an agent's [`tools:`](./agent.md) list. The file is copied **verbatim** into the output.

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const wordCount = createTool({
  id: 'word-count',
  description: 'Counts the words in the given text.',
  inputSchema: z.object({
    text: z.string().describe('Text to count words in'),
  }),
  outputSchema: z.object({
    words: z.number(),
  }),
  execute: async (inputData) => {
    return { words: inputData.text.trim().split(/\s+/).filter(Boolean).length };
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

## Generates `src/mastra/tools/<id>.ts`

Copied as-is (once, even if shared by multiple agents). Each referencing agent imports it:

```typescript
import { wordCount } from '../tools/word-count';
// ...
  tools: { wordCount },
```
