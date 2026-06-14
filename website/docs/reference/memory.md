---
title: Memory
---

# Memory

Declare one `memory:` block in `config.yaml`; opt agents in with `memory: true`. The generated
project gets a shared `src/mastra/utils/memory.ts` imported by each opted-in agent.

## Separation of concerns

Memory is **configured in exactly one place — `config.yaml`.** Agent files never carry memory
configuration; an agent's only memory-related field is the boolean `memory: true` opt-in. This keeps
a single source of truth for memory and keeps agent definitions focused on the agent's own identity
(name, instructions, model, tools).

- **`config.yaml` → `memory`** owns *how* memory works (history window, semantic recall, working
  memory). One block, project-wide.
- **`agent/<id>.yaml` → `memory: true`** is a pure opt-in switch — *whether* this agent uses it.
  There is intentionally no per-agent memory configuration.

All opted-in agents therefore share the same generated `Memory` instance. Per-agent variation (named
memory configs) is a planned, backward-compatible extension; until then, the boundary stays strict:
config configures, agents only opt in.

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
