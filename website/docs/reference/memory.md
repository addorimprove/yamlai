---
title: Memory
---

# Memory

One `memory:` block in `config.yaml`; opt agents in with `memory: true`. There is no per-agent memory config — agents only carry the boolean. All opted-in agents share one generated `src/mastra/utils/memory.ts`.

## config.yaml

```yaml
storage:
  type: libsql
  url: file:./mastra.db
memory:
  last_messages: 20  # recent messages kept in context
  semantic_recall:   # optional; RAG over past messages
    embedder: openai/text-embedding-3-small  # "provider/model"; required
    top_k: 3  # default 4
    message_range: { before: 2, after: 1 }  # default 1/1
    scope: resource  # thread | resource (default resource)
  working_memory:    # optional; persistent per-user profile
    scope: resource
    template: |
      # Writing Preferences
      - Tone:
      - Audience:
```

## agent/&lt;id&gt;.yaml

```yaml
memory: true        # use the project memory; omit or false = no memory
```

## Generates `src/mastra/utils/memory.ts`

```typescript
import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';

export const memory = new Memory({
  storage: new LibSQLStore({ id: 'memory-storage', url: "file:./mastra.db" }),
  vector: new LibSQLVector({ id: 'memory-vector', url: "file:./mastra.db" }),
  embedder: "openai/text-embedding-3-small",
  options: {
    lastMessages: 20,
    semanticRecall: { topK: 3, messageRange: { before: 2, after: 1 }, scope: "resource" },
    workingMemory: { enabled: true, scope: "resource", template: `# Writing Preferences
- Tone:
- Audience:` },
  },
});
```

Keys map snake_case → camelCase (`last_messages` → `lastMessages`, `semantic_recall` → `semanticRecall`, `top_k` → `topK`); a `working_memory` block sets `enabled: true`; `message_range` also accepts a plain number (symmetric before/after). Memory reuses `storage.url` for both the store and the recall vector, so a `storage` block is **required**; `semantic_recall` requires `embedder` and emits the `LibSQLVector`. The embedder is constructed when the `Memory` is created, so enabling `semantic_recall` means `mastra dev` needs the provider's API key (e.g. `OPENAI_API_KEY`) to boot. The default `yamlai init` scaffold omits `semantic_recall` so the dev server starts without any key.

## Notes

- All opted-in agents share one `Memory` instance. Per-agent variation (named memory configs) is planned, backward-compatible.
