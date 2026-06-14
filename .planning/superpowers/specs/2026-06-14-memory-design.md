# Memory — Design

**Date:** 2026-06-14
**Component:** Memory support for the YAML Agent Builder (roadmap feature #8)
**Related:** [`2026-06-13-parser-design.md`](./2026-06-13-parser-design.md), `builder/src/`, `examples/`

## Purpose

Let a YAML project enable agent **memory** — conversation history, working memory, and semantic
recall — by declaring a single `memory:` block in `config.yaml` (next to the `storage` it depends
on). Each agent opts in with `memory: true`. Codegen emits one shared `Memory` module
(`src/mastra/utils/memory.ts`) that every opted-in agent imports.

This activates the libsql storage already declared in `config.yaml` (previously registered at the
Mastra level but unused by agents).

## Scope

In scope (v1):

- New optional `memory:` block in `config.yaml`: `last_messages`, `semantic_recall` (`embedder`,
  `top_k`, `message_range`, `scope`), `working_memory` (`template`, `scope`).
- New optional agent field `memory: true` (boolean opt-in; default `false`).
- Parser: validate the config `memory` block; cross-check `storage` presence and opt-in coherence.
- Codegen: emit a single shared `src/mastra/utils/memory.ts`; import it into opted-in agents; add
  the `@mastra/memory` dependency.
- Example + docs update.

Out of scope (deferred): multiple/named memory configs (per-agent variation) — `memory:` is a
**single project-wide block** in v1; a named map (`memory: { default: {...}, light: {...} }`) is the
backward-compatible upgrade path. Also deferred: non-libsql vector stores, `working_memory` via Zod
`schema` (template-only), `observationalMemory`, `generateTitle`, per-memory storage urls,
`embedderOptions`, `indexConfig`, semantic-recall `filter`.

## Decisions

| Topic | Decision |
|---|---|
| Declaration | A single `memory:` block in `config.yaml` (no `memory/` folder, no new resource type). Co-located with `storage`. |
| Opt-in | Per agent via `memory: true` (boolean). Omitted / `false` = that agent has no memory. |
| Capabilities | Full: `last_messages` + `working_memory` + `semantic_recall` (vector + embedder). |
| Storage source | Reuse `config.yaml`'s `storage.url` for both the Memory store and the semantic-recall vector. |
| Storage requirement | If `config.memory` is present (or any agent sets `memory: true`), `config.yaml` must declare `storage`; else aggregated `ParseError`. |
| Storage emission | Emit `storage:` **explicitly** in `new Memory({...})` (reuse `config.storage.url`) rather than relying on Mastra-instance inheritance — keeps generated output self-contained and verifiable by typecheck. |
| Embedder | A bare `"provider/model"` router string (the installed type accepts `string`); maps like `model`. Required whenever `semantic_recall` is present. |
| Vector / embedder emission | `vector:` + `embedder:` emitted **only** when `semantic_recall` is present. |
| `semantic_recall` defaults | `top_k` defaults to `4`, `message_range` defaults to `{ before: 1, after: 1 }` — Mastra's own runtime defaults (`DEFAULT_TOP_K`, `DEFAULT_MESSAGE_RANGE`). Codegen always emits the full `semanticRecall` object so it satisfies the type (where `topK`/`messageRange` are required). |
| `message_range` | Accept both shorthand (`message_range: 2`) and object (`{ before, after }`) — Zod union, mirrors Mastra. |
| `working_memory` | Presence sets `enabled: true`; `template` (markdown) and `scope` optional. |
| `scope` | Optional enum (`thread` / `resource`); emitted only when set (Mastra defaults to `resource`). |
| Shared module | One `src/mastra/utils/memory.ts` exporting `const memory`; emitted only when ≥1 agent opts in. Every opted-in agent imports the same instance. |
| Unused config | `memory:` defined but no agent opts in → no module emitted, no dependency added (block ignored). |
| Tests | Add a golden-file codegen test for the memory example (closes the "zero tests" gap for this feature). |

## Verified API facts

Verified against `@mastra/core@1.42.0` / `@mastra/memory@1.20.3` installed in `sample-mastra/`
(a full Memory config was added to `sample-mastra/src/mastra/agents/weather-agent.ts` and
typechecks clean with `tsc --noEmit`):

- `import { Memory } from '@mastra/memory'`
- `import { LibSQLStore, LibSQLVector } from '@mastra/libsql'`
- Constructor: `new Memory({ storage?, vector?, embedder?, options? })`.
- `embedder?: EmbeddingModelId | MastraEmbeddingModel<string> | string` — a plain
  `"openai/text-embedding-3-small"` string is accepted.
- `LibSQLVector` constructor takes `{ id, url }` (not `connectionUrl`).
- `options.semanticRecall?: boolean | { topK: number; messageRange: number | {before,after};
  scope?; ... }` — in the **object** form `topK` and `messageRange` are type-required, but at
  runtime are read as `?? DEFAULT_TOP_K (=4)` / `?? DEFAULT_MESSAGE_RANGE (={before:1,after:1})`.
- `options.workingMemory?: { enabled: boolean; template?; schema?; scope? }`.

## Input schema

### `config.yaml` — new optional `memory:` block

```yaml
name: my-mastra-app
agents:
  - support-agent
logger:
  level: info
storage:                                     # required when memory is used; its url is reused
  type: libsql
  url: file:./mastra.db
memory:                                      # optional; single project-wide memory config
  last_messages: 20                          # optional → options.lastMessages
  semantic_recall:                           # optional block; presence enables semantic recall
    embedder: openai/text-embedding-3-small  # required when this block is present
    top_k: 3                                 # optional → topK         (default 4)
    message_range: { before: 2, after: 1 }   # optional → messageRange (default {before:1,after:1}); also accepts a number
    scope: resource                          # optional → 'thread' | 'resource'
  working_memory:                            # optional block; presence sets enabled:true
    scope: resource                          # optional
    template: |                              # optional markdown template
      # User Profile
      - Name:
      - Plan tier:
```

All `memory` sub-fields optional. A minimal block (e.g. only `last_messages`) emits no
`vector`/`embedder`.

### `agent/<id>.yaml` — new optional boolean field

```yaml
name: Support Agent
instructions: support-prompt
model: gpt-5-mini
memory: true                                 # opt in; omit / false = no memory
tools:
  - echo-tool
```

## Generated output

### `src/mastra/utils/memory.ts` — emitted once when ≥1 agent opts in

```ts
import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';

export const memory = new Memory({
  storage: new LibSQLStore({ id: 'memory-storage', url: 'file:./mastra.db' }),
  vector: new LibSQLVector({ id: 'memory-vector', url: 'file:./mastra.db' }),   // only if semantic_recall
  embedder: 'openai/text-embedding-3-small',                                    // only if semantic_recall
  options: {
    lastMessages: 20,
    semanticRecall: { topK: 3, messageRange: { before: 2, after: 1 }, scope: 'resource' },
    workingMemory: { enabled: true, scope: 'resource', template: `# User Profile\n- Name:\n- Plan tier:` },
  },
});
```

### `src/mastra/agents/support-agent.ts` — opted-in agent imports the shared instance

```ts
import { Agent } from '@mastra/core/agent';
import { echoTool } from '../tools/echo-tool';
import { memory } from '../utils/memory';      // only when this agent has memory: true

export const supportAgent = new Agent({
  id: 'support-agent',
  /* …existing fields… */
  tools: { echoTool },
  memory,
});
```

Emission rules:

- `src/mastra/utils/memory.ts` exports `const memory`; emitted only when ≥1 agent opts in.
- `storage` always emitted (url from `config.storage.url`).
- `vector` + `embedder` emitted only when `semantic_recall` is present; `LibSQLVector` import added
  only then.
- `workingMemory.template` rendered via the existing `backtickString` helper (multiline-safe).
- An agent with `memory: true` adds `import { memory } from '../utils/memory'` and a `memory,`
  field; agents without it are unchanged.

### Resulting tree

```
src/mastra/
├── index.ts
├── agents/
│   └── support-agent.ts        # imports ../utils/memory  (when memory: true)
├── tools/
│   └── echo-tool.ts
└── utils/
    └── memory.ts               # export const memory = new Memory({...})
```

## Components (code touchpoints)

- **`builder/src/schemas.ts`** — add a `MemorySchema` (`last_messages`, `semantic_recall` with
  `message_range` union + `top_k`/`message_range` defaults applied when `semantic_recall` present,
  `working_memory`); add `memory: MemorySchema.optional()` to `ConfigSchema`; add
  `memory: z.boolean().default(false)` to `AgentSchema`.
- **`builder/src/types.ts`** — add `ResolvedMemory`; add `memory?: ResolvedMemory` to
  `ParsedProject`; add `memory: boolean` to `ResolvedAgent`.
- **`builder/src/parser.ts`** — validate `config.memory`; resolve it into `ResolvedMemory`; record
  issues for: any agent with `memory: true` when `config.memory` is absent; memory used but
  `storage` absent; `semantic_recall` without `embedder`. Carry resolved memory + `storage.url` on
  `ParsedProject`.
- **`builder/src/codegen/emit-memory.ts`** (new) — `emitMemory(memory, storageUrl): string` →
  source for `src/mastra/utils/memory.ts`.
- **`builder/src/codegen/emit-agent.ts`** — when `agent.memory`, add the `import { memory }` line
  and the `memory,` field.
- **`builder/src/codegen/generate.ts` / `write.ts`** — write `utils/memory.ts` when emitted.
- **`builder/src/codegen/versions.ts`** — add `@mastra/memory` (`^1.20.3`).
- **`builder/src/codegen/emit-project-files.ts`** — add `@mastra/memory` to generated
  `package.json` dependencies when the memory module is emitted (`@mastra/libsql` already added by
  storage).
- **`examples/`** — add a `memory:` block to `examples/config.yaml`; add `memory: true` to
  `examples/agent/support-agent.yaml`.
- **Docs** — move "Memory" from "Coming" to "Available now" in `website/docs/features.md`; add a
  `website/docs/reference/memory.md` page.
- **Test** — golden-file codegen test asserting `utils/memory.ts` and the opted-in agent file.

## Resolved output types

```ts
interface ResolvedMemory {
  lastMessages?: number;
  semanticRecall?: {
    embedder: string;                                            // "provider/model" router string
    topK: number;                                                // defaulted to 4
    messageRange: number | { before: number; after: number };   // defaulted to {before:1,after:1}
    scope?: 'thread' | 'resource';
  };
  workingMemory?: {
    template?: string;
    scope?: 'thread' | 'resource';
  };
}

// ParsedProject gains:
//   memory?: ResolvedMemory;          // the single project memory, if defined and used
// ResolvedAgent gains:
//   memory: boolean;                  // whether this agent imports the shared memory
```

`ParsedProject` already carries `storage?: { type: 'libsql'; url: string }`; `emitMemory` reads
`project.storage.url`. The storage-required validation guarantees it is present whenever
`project.memory` is emitted.

## Validation (aggregated into `ParseError`)

- Agent sets `memory: true` but `config.yaml` has no `memory:` block → issue on the agent file.
- `config.memory` is present (or any agent opts in) but `config.yaml` has no `storage` block →
  issue on `config.yaml`.
- `config.memory` fails `MemorySchema` (e.g. `semantic_recall` without `embedder`, bad `scope`
  enum, negative `last_messages`).

Consistent with the parser's existing strategy: collect every issue, throw one `ParseError`; an
agent is only emitted when fully resolved.

## Notes / accepted trade-offs

1. **Single project-wide memory in v1.** All opted-in agents share one config and one instance. The
   named-map upgrade (`memory: { default, light }` + `memory: <name>`) is deferred and
   backward-compatible.
2. **Two `LibSQLStore` instances** point at the same db file (one at Mastra level in `index.ts`, one
   in `utils/memory.ts`). Typechecks fine and libsql tolerates it; chosen over inheritance for
   self-contained, typecheck-verifiable output. (Per-agent duplication is eliminated by the shared
   module.)

## Testing

Golden-file codegen test for the memory example (with and without `semantic_recall`). Parser error
cases (`memory: true` without a config block, memory without storage, `semantic_recall` without
`embedder`) covered by small fixtures. This is the first test in `builder/`; it doubles as the
harness for future features.
