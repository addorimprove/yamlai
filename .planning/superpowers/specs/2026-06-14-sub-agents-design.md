# Sub-agents — Design

**Date:** 2026-06-14
**Component:** Sub-agent (multi-agent delegation) support for the YAML Agent Builder (roadmap feature #9)
**Related:** [`2026-06-13-parser-design.md`](./2026-06-13-parser-design.md), [`2026-06-13-codegen-design.md`](./2026-06-13-codegen-design.md), [`2026-06-14-memory-design.md`](./2026-06-14-memory-design.md), `builder/src/`, `examples/`

## Purpose

Let an agent delegate to other agents. A parent agent declares `agents: [research-agent]` in its
`agent/<id>.yaml` (mirroring the existing `tools:` key), and codegen wires those agents into the
parent's `new Agent({ ..., agents: { researchAgent } })` constructor. Mastra exposes each sub-agent
to the parent as a callable tool, so the parent's LLM can route work to specialised agents (each
with its own model, prompt, and tools).

This is the foundation for supervisor / multi-agent-network patterns and reuses the existing
tools-resolver shape end to end.

## Scope

In scope (v1):

- New optional agent field `agents: [<id>, ...]` (list of sub-agent ids; default `[]`).
- Each referenced id must be an agent **also listed in `config.yaml`'s `agents:`** (validated).
- Parser: validate references exist; detect cycles (incl. self-reference); resolve to export names.
- Codegen: in the parent agent file, import each sub-agent and add the `agents: { ... }` field.
- Example + docs + tests.

Out of scope (deferred):

- **Transitive auto-discovery** — a sub-agent that is *not* in `config.yaml` is an error in v1, not
  silently pulled in. (Upgrade path: a future flag could auto-register referenced-but-unlisted
  agents.)
- **Delegation configuration** — Mastra's `subAgentDelegation` / per-invocation overrides /
  `onDelegationStart` callbacks. v1 emits a bare `agents: { ... }` map only.
- **Dynamic (function-based) agents** — Mastra accepts `agents` as a function returning the map;
  v1 emits a static object literal.
- **`SubAgent` lightweight implementations** — we only ever pass full `Agent` instances.

## Decisions

| Topic | Decision |
|---|---|
| Declaration | New optional `agents:` array on `agent/<id>.yaml`, exactly mirroring `tools:` (list of ids → references `agent/<id>.yaml`). |
| Registration requirement | A referenced sub-agent **must** be listed in `config.yaml`'s `agents:`. The reference only validates the id is a known, registered agent — no new discovery logic, preserves the "agents are an explicit list" invariant. |
| Top-level registration | Because sub-agents are already in `config.yaml`, they remain registered in `new Mastra({ agents })` and are directly callable via the API/playground. Accepted: there is no "private" sub-agent in v1. |
| Cycles | Any cycle (`A→A`, `A→B→A`, …) is a hard error, aggregated into `ParseError`. Guarantees the generated agent-file import graph is a DAG (no circular ESM / TDZ), and prevents runtime delegation loops. v1 reports the **first** cycle found. |
| Missing reference | A referenced id not present in `config.yaml`'s `agents:` → issue `sub-agent not found: <id> (must be listed in config.yaml agents)`. |
| Resolved shape | New `ResolvedSubAgent { id, exportName }`; `ResolvedAgent.subAgents: ResolvedSubAgent[]` (mirrors `ResolvedTool` / `tools`). |
| Codegen — agent file | Import `{ <camelId> } from './<sub-id>'` (same agents dir), add `agents: { <camelId>, ... }` after `tools` and before `memory`. Deduped, in declared order, like tools. |
| Codegen — index.ts | **No change.** Sub-agents are already imported + registered there (they are in `config.agents`). |
| Dependencies | **None added.** `Agent` comes from `@mastra/core/agent`, already a dependency. |
| Tests | Golden-file `emitAgent` test (sub-agent import + `agents:` field) + parser tests (missing ref, self-cycle, two-node cycle, happy path). |

## Verified API facts

Verified against `@mastra/core@1.42` installed in `sample-mastra/` (`node_modules/@mastra/core/dist/agent/`):

- `AgentConfigBase.agents?: DynamicArgument<Record<string, SubAgent<string, …>>>`
  (`agent/types.d.ts:438`). The map key is a label; the value is any `SubAgent`.
- `Agent` satisfies the `SubAgent` interface (`agent/subagent.d.ts`: "`Agent` already satisfies this
  interface"). So passing another generated `Agent` instance is valid with no adapter.
- Mastra turns each entry into a delegation tool (`agent-<key>`) the parent can call
  (`agent.d.ts`: "sub-agent (a child agent invoked as a tool)").

So the emitted form is simply:

```ts
export const parentAgent = new Agent({
  /* …existing fields… */
  agents: { researchAgent },
});
```

## Input schema

### `agent/<id>.yaml` — new optional `agents:` field

```yaml
name: Support Agent
description: Handles customer support questions.
instructions: support-prompt
model: gpt-5-mini
memory: true
tools:
  - echo-tool
agents:                 # NEW — optional; default []
  - research-agent      # must also appear in config.yaml `agents:`
```

### `config.yaml` — unchanged, but every referenced agent must be listed

```yaml
name: my-mastra-app
agents:
  - support-agent       # the parent
  - research-agent      # the sub-agent — must be present
```

## Generated output

### `src/mastra/agents/support-agent.ts` — parent imports + wires the sub-agent

```ts
import { Agent } from '@mastra/core/agent';
import { echoTool } from '../tools/echo-tool';
import { researchAgent } from './research-agent';   // NEW — sub-agent import (same dir)
import { memory } from '../utils/memory';

export const supportAgent = new Agent({
  id: 'support-agent',
  name: 'Support Agent',
  description: 'Handles customer support questions.',
  instructions: `...`,
  model: 'openai/gpt-5-mini',
  tools: { echoTool },
  agents: { researchAgent },                          // NEW — after tools, before memory
  memory,
});
```

### `src/mastra/agents/research-agent.ts` — an ordinary agent, no special markup

The sub-agent file is emitted exactly as any other agent (it has its own model/prompt/tools). Being
a sub-agent is purely a property of the *parent's* file.

### `src/mastra/index.ts` — unchanged

Both `support-agent` and `research-agent` are already imported and registered (both are in
`config.agents`):

```ts
import { supportAgent } from './agents/support-agent';
import { researchAgent } from './agents/research-agent';

export const mastra = new Mastra({
  agents: { supportAgent, researchAgent },
  /* … */
});
```

## Components (code touchpoints)

- **`builder/src/schemas.ts`** — add `agents: z.array(z.string().min(1)).default([])` to
  `AgentSchema`.
- **`builder/src/types.ts`** — add `ResolvedSubAgent { id: string; exportName: string }`; add
  `subAgents: ResolvedSubAgent[]` to `ResolvedAgent`.
- **`builder/src/parser.ts`** —
  1. In the main loop, after `AgentSchema` parse succeeds, record the raw `agent.agents` list in a
     `Map<agentId, string[]>` keyed by agent id; initialise the pushed `ResolvedAgent.subAgents = []`.
  2. After the loop, before the existing `throw`: validate each reference is in
     `new Set(config.agents)` (else issue); run cycle detection over the declared graph (else issue).
  3. After the clean check, fill each `ResolvedAgent.subAgents` from its refs via `toExportName`.
  - Add a small `detectCycle(graph: Map<string,string[]>): string[] | null` helper (DFS with
    white/grey/black colouring; returns the cycle path or `null`).
- **`builder/src/codegen/emit-agent.ts`** — for each `agent.subAgents` entry, add
  `import { <exportName> } from './<id>';` (deduped, in the import block) and add the
  `agents: { <exportName>, ... }` field after `tools` and before `memory`.
- **`builder/src/codegen/generate.ts`** — sub-agent files are already emitted (every agent in
  `config.agents` is iterated). **No change required**, but confirm a parent's sub-agent does not
  need its tools re-copied beyond the existing per-agent loop (it already does its own pass).
- **`examples/`** — add `examples/agent/research-agent.yaml` + `examples/prompt/research-prompt.md`;
  add `research-agent` to `examples/config.yaml`'s `agents:`; add `agents: [research-agent]` to
  `examples/agent/support-agent.yaml`. Reuse the existing `gpt-5-mini` model.
- **Docs** —
  - `website/docs/features.md`: move "Sub-agents" (#9) from "Coming ⏳" to "Available now ✅" (table
    row + the `agents:` line in the `agent/<id>.yaml` snippet).
  - `website/docs/reference/agent.md`: document the new `agents:` field (sub-agents is an agent
    *field*, not a new resource folder — no new reference page; reference pages are per-concept:
    `agent/config/memory/model/prompt/tools`).
- **Tests** — see Testing.

## Resolved output types

```ts
interface ResolvedSubAgent {
  id: string;          // referenced agent id (= agent/<id>.yaml, listed in config.agents)
  exportName: string;  // camelCase, e.g. "researchAgent"
}

// ResolvedAgent gains:
//   subAgents: ResolvedSubAgent[];   // declared order, deduped at emit time like tools
```

## Validation (aggregated into `ParseError`)

- Referenced sub-agent id not present in `config.yaml`'s `agents:` →
  `sub-agent not found: <id> (must be listed in config.yaml agents)` on the parent agent file.
- A cycle in the sub-agent graph (including self-reference) →
  `circular sub-agent reference: a -> b -> a` attributed to the first node's file.

Consistent with the parser's existing strategy: collect every issue, throw one `ParseError`; an
agent is only emitted when fully resolved and the whole graph is acyclic.

## Notes / accepted trade-offs

1. **No private sub-agents in v1.** A sub-agent is also a top-level registered agent (directly
   callable). Acceptable; transitive/private registration is the deferred upgrade.
2. **First-cycle reporting.** When multiple independent cycles exist, only the first discovered is
   reported; re-run after fixing to surface the next. Keeps the detector small.
3. **Static map only.** No dynamic/function `agents`, no delegation config — those are future
   declarative additions on top of this resolver.

## Testing

- **`builder/test/emit-agent.test.ts`** — extend `BASE` with `subAgents: []`; add cases:
  - sub-agents present → emits `import { researchAgent } from './research-agent';` and
    `agents: { researchAgent },`;
  - no sub-agents → no `agents:` field, no extra import;
  - duplicate refs deduped.
- **`builder/test/sub-agents-parser.test.ts`** (new) — fixtures for: happy path (resolves
  `subAgents`); missing reference (not in config) → `ParseError`; self-reference → cycle error;
  two-node cycle → cycle error.
- **Integration** — `pnpm parse:example` and `pnpm gen:example` on the extended `examples/`, then
  typecheck the generated project (matches the memory feature's integration approach).
