---
title: Memory
---

# Memory

Declare one `memory:` block in `config.yaml`; opt agents in with `memory: true`. The generated
project gets a shared `src/mastra/utils/memory.ts` imported by each opted-in agent.

## config.yaml

```yaml
storage:
  type: libsql
  url: file:./mastra.db
memory:
  last_messages: 20                          # recent messages kept in context
  semantic_recall:                           # optional; enables RAG over past messages
    embedder: openai/text-embedding-3-small  # "provider/model" embedding model (required here)
    top_k: 3                                  # default 4
    message_range: { before: 2, after: 1 }   # default { before: 1, after: 1 }; a number also works
    scope: resource                          # thread | resource (default resource)
  working_memory:                            # optional; persistent per-user profile
    scope: resource
    template: |
      # User Profile
      - Name:
```

## agent/<id>.yaml

```yaml
memory: true        # use the project memory; omit or false = no memory
```

## Notes

- `memory` reuses the `storage.url` from `config.yaml` for both the store and the semantic-recall
  vector — a `storage` block is required when memory is used.
- `semantic_recall` requires `embedder`; it emits a `LibSQLVector` alongside the store.
- All opted-in agents share one `Memory` instance. Per-agent variation (named memory configs) is
  planned.
