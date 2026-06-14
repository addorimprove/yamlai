# Memory — Design

**Date:** 2026-06-14
**Component:** Memory support for the YAML Agent Builder (roadmap feature #8)
**Related:** [`2026-06-13-parser-design.md`](./2026-06-13-parser-design.md), `builder/src/`, `examples/`

## Purpose

Let a YAML project declare agent **memory** — conversation history, working memory, and semantic
recall — in a `memory/<id>.yaml` file, referenced from an agent via `memory: <id>` (the same
id-reference pattern already used for `model`, `instructions`, and `tools`). Codegen emits a
`new Memory({...})` (from `@mastra/memory`) wired into the agent.

This activates the libsql storage already declared in `config.yaml` (previously registered at the
Mastra level but unused by agents).

## Scope

In scope (v1):

- New `memory/<id>.yaml` schema: `last_messages`, `semantic_recall` (`embedder`, `top_k`,
  `message_range`, `scope`), `working_memory` (`template`, `scope`).
- New optional agent field `memory: <id>`.
- Parser: resolve + validate the memory file; cross-check that `config.yaml` declares `storage`.
- Codegen: emit a per-agent `Memory` instance and add the `@mastra/memory` dependency.
- Example + docs update.

Out of scope (deferred): non-libsql vector stores (pg/pinecone/qdrant), `working_memory` via Zod
`schema` (template-only for now), `observationalMemory`, `generateTitle`, per-memory storage urls
distinct from `config.storage`, sharing one `Memory` instance across agents, `embedderOptions`,
`indexConfig`, semantic-recall `filter`.

## Decisions

| Topic | Decision |
|---|---|
| Declaration | Separate `memory/<id>.yaml`, referenced by agent `memory: <id>` (matches `model`/`prompt`/`tools`). |
| Capabilities | Full: `last_messages` + `working_memory` + `semantic_recall` (vector + embedder). |
| Storage source | Reuse `config.yaml`'s `storage.url` for both the Memory store and the semantic-recall vector. |
| Storage requirement | Any agent that uses `memory` requires a `storage` block in `config.yaml`; else aggregated `ParseError`. |
| Storage emission | Emit `storage:` **explicitly** in `new Memory({...})` (reuse `config.storage.url`) rather than relying on Mastra-instance inheritance — keeps generated output self-contained and verifiable by typecheck. |
| Embedder | A bare `"provider/model"` router string (the installed type accepts `string`); maps exactly like `model`. Required whenever `semantic_recall` is present. |
| Vector / embedder emission | `vector:` + `embedder:` emitted **only** when `semantic_recall` is present. |
| `semantic_recall` defaults | `top_k` defaults to `4`, `message_range` defaults to `{ before: 1, after: 1 }` — Mastra's own runtime defaults (`DEFAULT_TOP_K`, `DEFAULT_MESSAGE_RANGE`). Codegen always emits the full `semanticRecall` object so it satisfies the type (where `topK`/`messageRange` are required). |
| `message_range` | Accept both shorthand (`message_range: 2`) and object (`{ before, after }`) — Zod union, mirrors Mastra. |
| `working_memory` | Presence sets `enabled: true`; `template` (markdown) and `scope` optional. |
| `scope` | Optional enum (`thread` / `resource`); emitted only when set (Mastra defaults to `resource`). |
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

## Input schema — `memory/<id>.yaml`

```yaml
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

All top-level fields optional. A memory file may legally be empty/minimal (e.g. only
`last_messages`), in which case no `vector`/`embedder` is emitted.

Agent gains one optional field:

```yaml
# agent/support-agent.yaml
memory: support-memory                     # → memory/support-memory.yaml
```

## Generated output

For an agent `support-agent` referencing `support-memory` with semantic recall, codegen writes
`src/mastra/agents/support-agent.ts`:

```ts
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { echoTool } from '../tools/echo-tool';

const supportAgentMemory = new Memory({
  storage: new LibSQLStore({ id: 'support-agent-memory-storage', url: 'file:./mastra.db' }),
  vector: new LibSQLVector({ id: 'support-agent-memory-vector', url: 'file:./mastra.db' }),
  embedder: 'openai/text-embedding-3-small',
  options: {
    lastMessages: 20,
    semanticRecall: { topK: 3, messageRange: { before: 2, after: 1 }, scope: 'resource' },
    workingMemory: { enabled: true, scope: 'resource', template: `# User Profile\n- Name:\n- Plan tier:` },
  },
});

export const supportAgent = new Agent({
  /* …existing fields… */
  memory: supportAgentMemory,
});
```

Emission rules:

- `Memory` const named `${agentExportName}Memory`, declared above the `new Agent(...)` export.
- `storage` always emitted (url from `config.storage.url`).
- `vector` + `embedder` emitted only when `semantic_recall` is present.
- `LibSQLVector` import added only when `vector` is emitted.
- `workingMemory.template` rendered via the existing `backtickString` helper (multiline-safe).
- No `memory` field, no `Memory`/libsql imports, when the agent has no `memory`.

## Components (code touchpoints)

- **`builder/src/schemas.ts`** — add `MemorySchema` (with `semantic_recall`/`working_memory`
  sub-schemas, `message_range` union, `top_k`/`message_range` defaults applied when
  `semantic_recall` present); add `memory: z.string().optional()` to `AgentSchema`.
- **`builder/src/types.ts`** — add `ResolvedMemory`; add `memory?: ResolvedMemory` to
  `ResolvedAgent`.
- **`builder/src/parser.ts`** — when an agent declares `memory`, read+validate
  `memory/<id>.yaml`, resolve into `ResolvedMemory`; record an issue if the file is missing/invalid
  or if `config.storage` is absent. Thread `storage.url` through for the codegen step.
- **`builder/src/codegen/emit-agent.ts`** — emit the `Memory` const + imports + `memory:` field.
- **`builder/src/codegen/versions.ts`** — add `@mastra/memory` (`^1.20.3`).
- **`builder/src/codegen/emit-project-files.ts`** — add `@mastra/memory` to generated
  `package.json` dependencies when any agent has memory (`@mastra/libsql` already added by storage).
- **`examples/`** — add `examples/memory/support-memory.yaml`; add `memory: support-memory` to
  `examples/agent/support-agent.yaml`.
- **Docs** — move "Memory" from "Coming" to "Available now" in `website/docs/features.md`; add a
  `website/docs/reference/memory.md` page.
- **Test** — golden-file codegen test asserting the generated `support-agent.ts` for the memory
  example.

## Resolved output type

```ts
interface ResolvedMemory {
  id: string;
  lastMessages?: number;
  semanticRecall?: {
    embedder: string;                                    // "provider/model" router string
    topK: number;                                        // defaulted to 4
    messageRange: number | { before: number; after: number };  // defaulted to {before:1,after:1}
    scope?: 'thread' | 'resource';
  };
  workingMemory?: {
    template?: string;
    scope?: 'thread' | 'resource';
  };
}

// ResolvedAgent gains:
//   memory?: ResolvedMemory;
```

`ParsedProject` already carries `storage?: { type: 'libsql'; url: string }`; codegen reads
`project.storage.url` when emitting each Memory. (The storage-required validation guarantees it is
present whenever any `ResolvedMemory` exists.)

## Validation (aggregated into `ParseError`)

- Agent declares `memory: <id>` but `memory/<id>.yaml` is missing → "file not found".
- `memory/<id>.yaml` fails `MemorySchema` (e.g. `semantic_recall` present without `embedder`,
  bad `scope` enum, negative `last_messages`).
- Any agent uses `memory` but `config.yaml` has no `storage` block → issue on `config.yaml`.

Consistent with the parser's existing strategy: collect every issue, throw one `ParseError`; an
agent is only emitted when fully resolved.

## Notes / accepted trade-offs

1. Two `LibSQLStore` instances point at the same db file (one at Mastra level in `index.ts`, one
   per Memory). Typechecks fine and libsql tolerates it; chosen over inheritance for self-contained,
   typecheck-verifiable output.
2. Two agents referencing the same `memory/<id>.yaml` each emit their own `new Memory(...)`
   (separate instances from identical config, not a shared instance). Acceptable for v1;
   `scope: resource` still shares the underlying stored data.

## Testing

Golden-file codegen test for the memory example (happy path, with and without semantic recall).
Parser error cases (missing memory file, semantic_recall without embedder, memory without storage)
covered by small fixtures. This is the first test in `builder/`; it doubles as the harness for
future features.
