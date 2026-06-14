# Sub-agents Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent delegate to other agents via a new optional `agents: [<id>]` field on `agent/<id>.yaml`, generating `agents: { <camelId> }` on the parent's `new Agent({...})`.

**Architecture:** Extend the existing parse → resolve → codegen pipeline. `schemas.ts` validates the new `agents` array; `parser.ts` resolves each reference into a `ResolvedSubAgent` on the parent's `ResolvedAgent`, validates that every reference is a declared agent, and rejects cycles; `emit-agent.ts` adds the import + `agents:` field. `index.ts` (the Mastra registry) is unchanged — sub-agents are already registered there because they must also be listed in `config.yaml`. No new dependency.

**Tech Stack:** TypeScript (NodeNext ESM), Zod v4, `yaml`, `node:test` + `tsx` for tests. Target runtime lib: `@mastra/core@1.42` (`Agent.agents` field; `Agent` already satisfies the `SubAgent` interface).

**Spec:** `.planning/superpowers/specs/2026-06-14-sub-agents-design.md`

**Conventions (read before starting):**
- All intra-`src` imports use `.js` extensions (NodeNext). Tests import source as `../src/<file>.js`.
- Run all commands from the `builder/` directory. Package manager: `pnpm`.
- `tsconfig.json` `include` is `["src/**/*", "scripts/**/*"]` — `test/**` is NOT typechecked by `pnpm build`; tests run via `tsx` which strips types without checking. So a missing required field in a test fixture won't fail the build, but WILL crash at runtime once `emitAgent` iterates it — hence fixtures are updated in the same task that makes `emitAgent` read them (Task 4).
- Decisions: a referenced sub-agent MUST also appear in `config.yaml`'s `agents:`; any cycle (incl. self-reference) is a hard `ParseError`.

---

## File Structure

**Modified:**
- `builder/src/schemas.ts` — add `agents` array to `AgentSchema`.
- `builder/src/types.ts` — add `ResolvedSubAgent`; add `subAgents` to `ResolvedAgent`.
- `builder/src/parser.ts` — capture refs, resolve `subAgents`, validate references + cycles; add a `detectSubAgentCycle` helper.
- `builder/src/index.ts` — export the new `ResolvedSubAgent` type.
- `builder/src/codegen/emit-agent.ts` — emit sub-agent imports + the `agents:` field.
- `builder/test/emit-agent.test.ts` — add `subAgents: []` to `BASE`; add sub-agent emit cases.
- `builder/test/emit-memory.test.ts` — add `subAgents: []` to `BASE_AGENT` (keeps it runnable once `emitAgent` reads `subAgents`).
- `examples/config.yaml` — register `research-agent`.
- `examples/agent/support-agent.yaml` — add `agents: [research-agent]`.
- `website/docs/features.md` — move Sub-agents to "Available now".
- `website/docs/reference/agent.md` — document the `agents:` field.

**Created:**
- `builder/test/sub-agents-parser.test.ts` — parser resolution + validation tests (temp fixtures).
- `examples/agent/research-agent.yaml` — the example sub-agent.
- `examples/prompt/research-prompt.md` — its prompt.

---

## Task 1: AgentSchema `agents` field

**Files:**
- Modify: `builder/src/schemas.ts`
- Test: `builder/test/sub-agents-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

Create `builder/test/sub-agents-schema.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSchema } from '../src/schemas.js';

test('AgentSchema defaults agents to an empty array', () => {
  const parsed = AgentSchema.parse({ name: 'A', instructions: 'p', model: 'm' });
  assert.deepEqual(parsed.agents, []);
});

test('AgentSchema accepts a list of sub-agent ids', () => {
  const parsed = AgentSchema.parse({
    name: 'A',
    instructions: 'p',
    model: 'm',
    agents: ['research-agent', 'writer-agent'],
  });
  assert.deepEqual(parsed.agents, ['research-agent', 'writer-agent']);
});

test('AgentSchema rejects a non-string sub-agent id', () => {
  assert.throws(() => AgentSchema.parse({ name: 'A', instructions: 'p', model: 'm', agents: [3] }));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `parsed.agents` is `undefined` (field not in schema).

- [ ] **Step 3: Add the field to `AgentSchema`**

In `builder/src/schemas.ts`, in `AgentSchema`, add after the `tools` line (before `memory`):

```ts
  agents: z.array(z.string().min(1)).default([]),
```

The block becomes:

```ts
export const AgentSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  // Prompt id: references prompt/<instructions>.md (like `model` -> model/<id>.yaml).
  instructions: z.string().min(1),
  model: z.string().min(1),
  tools: z.array(z.string().min(1)).default([]),
  agents: z.array(z.string().min(1)).default([]),
  memory: z.boolean().default(false),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test`
Expected: PASS — 3 tests in `sub-agents-schema.test.ts` pass; all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add builder/src/schemas.ts builder/test/sub-agents-schema.test.ts
git commit -m "feat(sub-agents): add agents field to AgentSchema"
```

---

## Task 2: Resolved types

**Files:**
- Modify: `builder/src/types.ts`
- Modify: `builder/src/index.ts`

(No standalone test — these types are exercised by Tasks 3–4. This task only adds declarations. The build is expected to FAIL at the end of this task and is fixed in Task 3; do not commit until Task 3.)

- [ ] **Step 1: Add the `ResolvedSubAgent` type**

In `builder/src/types.ts`, add directly before `interface ResolvedAgent`:

```ts
export interface ResolvedSubAgent {
  id: string;
  /** camelCase export variable name, e.g. "researchAgent". */
  exportName: string;
}
```

- [ ] **Step 2: Add `subAgents` to `ResolvedAgent`**

In the `ResolvedAgent` interface, add after `tools: ResolvedTool[];`:

```ts
  /** Agents this agent can delegate to (referenced from its `agents:` list). */
  subAgents: ResolvedSubAgent[];
```

- [ ] **Step 3: Export the new type**

In `builder/src/index.ts`, add `ResolvedSubAgent` to the `export type { ... } from './types.js';` block (after `ResolvedModel`):

```ts
export type {
  LogLevel,
  ParsedProject,
  ResolvedAgent,
  ResolvedMemory,
  ResolvedSemanticRecall,
  ResolvedWorkingMemory,
  ResolvedModel,
  ResolvedSubAgent,
  ResolvedTool,
} from './types.js';
```

- [ ] **Step 4: Verify the build fails as expected**

Run: `pnpm build`
Expected: FAIL — `parser.ts` does not yet set `subAgents` on the pushed `ResolvedAgent` (TS2741 "Property 'subAgents' is missing"). This is expected; Task 3 fixes it. Do not commit yet.

---

## Task 3: Parser — resolve sub-agents + validate references and cycles

**Files:**
- Modify: `builder/src/parser.ts`
- Test: `builder/test/sub-agents-parser.test.ts`

- [ ] **Step 1: Write the failing parser tests**

Create `builder/test/sub-agents-parser.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseProject } from '../src/parser.js';

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'yamlai-'));
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  return dir;
}

const MODEL = 'provider: openai\nmodel: gpt-5-mini\n';
const PROMPT = 'You are a test agent.\n';

// A reusable two-agent project where `parent` may reference sub-agents.
function twoAgents(parentAgents: string): Record<string, string> {
  return {
    'config.yaml': 'name: x\nagents: [parent, research-agent]\n',
    'agent/parent.yaml': `name: Parent\ninstructions: p\nmodel: m\n${parentAgents}`,
    'agent/research-agent.yaml': 'name: Research\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  };
}

test('resolves sub-agent references into subAgents with camelCase export names', () => {
  const dir = makeProject(twoAgents('agents: [research-agent]\n'));
  const project = parseProject(dir);
  const parent = project.agents.find((a) => a.id === 'parent');
  assert.ok(parent);
  assert.deepEqual(parent.subAgents, [{ id: 'research-agent', exportName: 'researchAgent' }]);
  // A non-referencing agent gets an empty list.
  const research = project.agents.find((a) => a.id === 'research-agent');
  assert.deepEqual(research?.subAgents, []);
});

test('errors when a sub-agent is not listed in config.yaml', () => {
  const dir = makeProject(twoAgents('agents: [ghost-agent]\n'));
  assert.throws(() => parseProject(dir), /sub-agent not found: ghost-agent/);
});

test('errors on a self-reference', () => {
  const dir = makeProject(twoAgents('agents: [parent]\n'));
  assert.throws(() => parseProject(dir), /circular sub-agent reference: parent -> parent/);
});

test('errors on a two-node cycle', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a, b]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\nagents: [b]\n',
    'agent/b.yaml': 'name: B\ninstructions: p\nmodel: m\nagents: [a]\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  assert.throws(() => parseProject(dir), /circular sub-agent reference: a -> b -> a/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `parser.ts` does not resolve `subAgents` or run the new validations.

- [ ] **Step 3: Add the cycle-detection helper**

In `builder/src/parser.ts`, add this function directly after `formatZodError`:

```ts
/** Returns a cycle path (e.g. ['a','b','a']) if the sub-agent graph contains one,
 *  else null. Only edges to nodes present in the graph are followed; references to
 *  agents missing a ref-list are validated separately. Detects self-references. */
function detectSubAgentCycle(graph: Map<string, string[]>): string[] | null {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  function visit(node: string): string[] | null {
    color.set(node, GREY);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue; // invalid/unresolved ref — reported elsewhere
      const c = color.get(next) ?? WHITE;
      if (c === GREY) {
        return [...stack.slice(stack.indexOf(next)), next];
      }
      if (c === WHITE) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  }

  for (const node of graph.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}
```

- [ ] **Step 4: Capture references in the agent loop**

In `parseProject`, before the `for (const agentId of config.agents)` loop, add the ref map and the declared-agent set:

```ts
  // Sub-agent references, captured for every schema-valid agent (even ones that
  // later fail prompt/model resolution), keyed by agent id.
  const subAgentRefs = new Map<string, string[]>();
  const configAgentSet = new Set(config.agents);
```

Inside the loop, right after `const agent = agentResult.data;`, capture the refs:

```ts
    subAgentRefs.set(agentId, agent.agents);
```

- [ ] **Step 5: Set `subAgents` on the pushed agent**

In the same loop, change the final `agents.push({...})` to include `subAgents`. Replace:

```ts
    agents.push({
      id: agentId,
      name: agent.name,
      description: agent.description,
      instructions,
      model: resolvedModel,
      tools,
      memory: agent.memory,
    });
```

with:

```ts
    agents.push({
      id: agentId,
      name: agent.name,
      description: agent.description,
      instructions,
      model: resolvedModel,
      tools,
      subAgents: agent.agents.map((id) => ({ id, exportName: toExportName(id) })),
      memory: agent.memory,
    });
```

- [ ] **Step 6: Validate references + cycles before the throw**

In `parseProject`, find the existing memory/storage validation that runs just before `if (issues.length > 0) throw new ParseError(issues);`:

```ts
  const memoryUsed = config.memory !== undefined || agents.some((a) => a.memory);
  if (memoryUsed && !config.storage) {
    addIssue('config.yaml', 'memory requires a `storage` block in config.yaml');
  }

  if (issues.length > 0) throw new ParseError(issues);
```

Insert the sub-agent validation between the memory check and the `throw`:

```ts
  const memoryUsed = config.memory !== undefined || agents.some((a) => a.memory);
  if (memoryUsed && !config.storage) {
    addIssue('config.yaml', 'memory requires a `storage` block in config.yaml');
  }

  // Every referenced sub-agent must also be a declared agent in config.yaml.
  for (const [parentId, refs] of subAgentRefs) {
    for (const ref of refs) {
      if (!configAgentSet.has(ref)) {
        addIssue(
          `agent/${parentId}.yaml`,
          `sub-agent not found: ${ref} (must be listed in config.yaml agents)`,
        );
      }
    }
  }
  const cycle = detectSubAgentCycle(subAgentRefs);
  if (cycle) {
    addIssue(
      `agent/${cycle[0]}.yaml`,
      `circular sub-agent reference: ${cycle.join(' -> ')}`,
    );
  }

  if (issues.length > 0) throw new ParseError(issues);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all 4 `sub-agents-parser.test.ts` tests pass; all existing tests still pass.

- [ ] **Step 8: Verify the build compiles**

Run: `pnpm build`
Expected: PASS — Task 2's missing-property error is resolved.

- [ ] **Step 9: Commit**

```bash
git add builder/src/types.ts builder/src/index.ts builder/src/parser.ts builder/test/sub-agents-parser.test.ts
git commit -m "feat(sub-agents): resolve refs + validate references/cycles in parser"
```

---

## Task 4: Codegen — emit sub-agent imports + `agents:` field

**Files:**
- Modify: `builder/src/codegen/emit-agent.ts`
- Modify: `builder/test/emit-agent.test.ts` (update `BASE`, add cases)
- Modify: `builder/test/emit-memory.test.ts` (update `BASE_AGENT`)

- [ ] **Step 1: Update existing fixtures so they keep running**

`emitAgent` will iterate `agent.subAgents` after this task; fixtures must provide it or they crash at runtime.

In `builder/test/emit-agent.test.ts`, add `subAgents: []` to `BASE` (after `tools: [],`):

```ts
const BASE: ResolvedAgent = {
  id: 'a',
  name: 'A',
  description: '',
  instructions: 'hi',
  model: { id: 'm', provider: 'openai', model: 'gpt-5-mini', routerString: 'openai/gpt-5-mini' },
  tools: [],
  subAgents: [],
  memory: false,
};
```

In `builder/test/emit-memory.test.ts`, add `subAgents: []` to `BASE_AGENT` (after `tools: [],`):

```ts
const BASE_AGENT: ResolvedAgent = {
  id: 'support-agent',
  name: 'Support Agent',
  description: '',
  instructions: 'hi',
  model: { id: 'm', provider: 'openai', model: 'gpt-5-mini', routerString: 'openai/gpt-5-mini' },
  tools: [],
  subAgents: [],
  memory: false,
};
```

- [ ] **Step 2: Write the failing emit tests**

Append to `builder/test/emit-agent.test.ts`:

```ts
test('emits a sub-agent import and agents field', () => {
  const out = emitAgent({
    ...BASE,
    subAgents: [{ id: 'research-agent', exportName: 'researchAgent' }],
  });
  assert.match(out, /import \{ researchAgent \} from '\.\/research-agent';/);
  assert.match(out, /^\s*agents: \{ researchAgent \},$/m);
});

test('omits the agents field when there are no sub-agents', () => {
  const out = emitAgent(BASE);
  assert.doesNotMatch(out, /^\s*agents: \{/m);
});

test('dedupes repeated sub-agent references', () => {
  const out = emitAgent({
    ...BASE,
    subAgents: [
      { id: 'research-agent', exportName: 'researchAgent' },
      { id: 'research-agent', exportName: 'researchAgent' },
    ],
  });
  const imports = out.match(/from '\.\/research-agent'/g) ?? [];
  assert.equal(imports.length, 1);
  assert.match(out, /agents: \{ researchAgent \},/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — generated source has no `./research-agent` import or `agents:` field.

- [ ] **Step 4: Implement the sub-agent imports**

In `builder/src/codegen/emit-agent.ts`, find the tool-import loop and the following memory import:

```ts
  // Tool imports — deduped, in listed order.
  const seenImport = new Set<string>();
  for (const tool of agent.tools) {
    if (seenImport.has(tool.exportName)) continue;
    seenImport.add(tool.exportName);
    lines.push(`import { ${tool.exportName} } from '../tools/${tool.id}';`);
  }
  if (agent.memory) {
    lines.push(`import { memory } from '../utils/memory';`);
  }
  lines.push('');
```

Insert a sub-agent import loop between the tool loop and the memory import:

```ts
  // Tool imports — deduped, in listed order.
  const seenImport = new Set<string>();
  for (const tool of agent.tools) {
    if (seenImport.has(tool.exportName)) continue;
    seenImport.add(tool.exportName);
    lines.push(`import { ${tool.exportName} } from '../tools/${tool.id}';`);
  }
  // Sub-agent imports — deduped, in listed order. Sibling files in agents/.
  const seenSubImport = new Set<string>();
  for (const sub of agent.subAgents) {
    if (seenSubImport.has(sub.exportName)) continue;
    seenSubImport.add(sub.exportName);
    lines.push(`import { ${sub.exportName} } from './${sub.id}';`);
  }
  if (agent.memory) {
    lines.push(`import { memory } from '../utils/memory';`);
  }
  lines.push('');
```

- [ ] **Step 5: Implement the `agents:` field**

In the same file, find the tools field block and the memory field block:

```ts
  if (agent.tools.length > 0) {
    const toolVars = [...new Set(agent.tools.map((t) => t.exportName))].join(', ');
    fields.push(`  tools: { ${toolVars} },`);
  }

  if (agent.memory) {
    fields.push(`  memory,`);
  }
```

Insert the `agents:` field between the tools field and the memory field:

```ts
  if (agent.tools.length > 0) {
    const toolVars = [...new Set(agent.tools.map((t) => t.exportName))].join(', ');
    fields.push(`  tools: { ${toolVars} },`);
  }

  if (agent.subAgents.length > 0) {
    const agentVars = [...new Set(agent.subAgents.map((s) => s.exportName))].join(', ');
    fields.push(`  agents: { ${agentVars} },`);
  }

  if (agent.memory) {
    fields.push(`  memory,`);
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS — the 3 new emit-agent cases pass; all existing tests (including emit-memory) still pass.

- [ ] **Step 7: Commit**

```bash
git add builder/src/codegen/emit-agent.ts builder/test/emit-agent.test.ts builder/test/emit-memory.test.ts
git commit -m "feat(sub-agents): emit sub-agent imports + agents field in emit-agent"
```

---

## Task 5: Example project + verify generated output typechecks

**Files:**
- Create: `examples/agent/research-agent.yaml`
- Create: `examples/prompt/research-prompt.md`
- Modify: `examples/config.yaml`
- Modify: `examples/agent/support-agent.yaml`

- [ ] **Step 1: Create the example sub-agent**

Create `examples/agent/research-agent.yaml`:

```yaml
name: Research Agent
description: Looks up background information for the support agent.
instructions: research-prompt
model: gpt-5-mini
```

Create `examples/prompt/research-prompt.md`:

```markdown
You are a research assistant. Given a question, find and summarise the relevant
background information concisely. Return only the facts the caller needs.
```

- [ ] **Step 2: Register the sub-agent in config**

In `examples/config.yaml`, add `research-agent` to the `agents:` list. Change:

```yaml
agents:
  - support-agent
```

to:

```yaml
agents:
  - support-agent
  - research-agent
```

- [ ] **Step 3: Reference the sub-agent from the parent**

In `examples/agent/support-agent.yaml`, add an `agents:` list after the `tools:` block:

```yaml
agents:
  - research-agent
```

The file becomes:

```yaml
name: Support Agent
description: Handles customer support questions.
instructions: support-prompt
model: gpt-5-mini
memory: true
tools:
  - echo-tool
agents:
  - research-agent
```

- [ ] **Step 4: Parse the example and inspect the resolved sub-agent**

Run: `pnpm parse:example`
Expected: prints the `ParsedProject`; the `support-agent` entry has `subAgents: [ { id: 'research-agent', exportName: 'researchAgent' } ]`, and a `research-agent` entry exists with `subAgents: []`.

- [ ] **Step 5: Generate the example project**

Run: `pnpm gen:example /tmp/yamlai-subagents-out`
Expected: prints `Generated N files → /tmp/yamlai-subagents-out`; the tree includes both `src/mastra/agents/support-agent.ts` and `src/mastra/agents/research-agent.ts`.

- [ ] **Step 6: Confirm the wiring in the generated parent**

Run: `grep -nE "research-agent|researchAgent" /tmp/yamlai-subagents-out/src/mastra/agents/support-agent.ts`
Expected: shows `import { researchAgent } from './research-agent';` and `agents: { researchAgent },`.

- [ ] **Step 7: Verify the generated project typechecks against real Mastra packages**

Run:

```bash
cd /tmp/yamlai-subagents-out && pnpm install && npx tsc --noEmit && cd -
```

Expected: `pnpm install` succeeds and `tsc --noEmit` exits 0 — the parent agent compiles with `agents: { researchAgent }` against `@mastra/core@1.42` (`Agent` satisfies `SubAgent`). (If `tsc` is absent in the generated project, run `npx -y typescript@6 tsc --noEmit`.)

- [ ] **Step 8: Commit**

```bash
git add examples/agent/research-agent.yaml examples/prompt/research-prompt.md examples/config.yaml examples/agent/support-agent.yaml
git commit -m "docs(sub-agents): add a sub-agent to the example project"
```

---

## Task 6: Documentation

**Files:**
- Modify: `website/docs/features.md`
- Modify: `website/docs/reference/agent.md`

- [ ] **Step 1: Add the `agents:` line to the "Available now" agent snippet**

In `website/docs/features.md`, in the "Available now ✅" `agent/<id>.yaml` code block, the `tools` line currently reads:

```yaml
tools: [echo-tool]            # tools/<id>.ts
```

Add a sub-agents line directly after it:

```yaml
tools: [echo-tool]            # tools/<id>.ts
agents: [research-agent]      # delegate to other agents
```

- [ ] **Step 2: Add a row to the "Available now" feature table**

In the same file, in the "Available now" table, add a row after the `Memory` row:

```
| Sub-agents | agent `agents: [<id>]` | declarative |
```

- [ ] **Step 3: Remove Sub-agents from "Coming" and "Next up"**

In the "Coming ⏳" table, delete the row:

```
| 9 | Sub-agents | agent `agents: [research-agent]` | declarative | A |
```

In the "### Next up" list, delete the line:

```
1. **Sub-agents** (#9) — reuses the tools resolver; unlocks supervisor / multi-agent.
```

and renumber the remaining items (Workflows → 1, Guardrails → 2, Structured output → 3).

- [ ] **Step 4: Add `agents` to the top example in the agent reference**

In `website/docs/reference/agent.md`, the opening example currently ends with:

```yaml
tools:
  - echo-tool                # → tools/echo-tool.ts
```

Add an `agents` block after it (inside the same code fence):

```yaml
agents:
  - research-agent           # → agent/research-agent.ts (must be in config.yaml)
```

- [ ] **Step 5: Add a `agents` row to the Fields table**

In the same file, in the `## Fields` table, add a row after the `tools` row:

```
| `agents` | string[] | No | `[]` | **Sub-agent ids** → [agent/&lt;id&gt;.yaml](./agent.md), and must be in [config.yaml](./config.md) `agents:`. |
```

- [ ] **Step 6: Add an explanatory section + update the "Generates" example**

In the same file, in the `## Generates src/mastra/agents/support-agent.ts` code block, add the import after `import { echoTool } ...` and the field after `tools: { echoTool },`:

```typescript
import { researchAgent } from './research-agent';
```

```typescript
  agents: { researchAgent },
```

Then, at the end of the file, add a section explaining the semantics:

```markdown
## Sub-agents (`agents`)

Each id in `agents` must reference an `agent/<id>.yaml` that is **also listed in
`config.yaml`'s `agents:`**. Mastra exposes each sub-agent to this agent as a callable
tool, so its model can delegate work to specialised agents. Cycles — including an agent
referencing itself — are rejected at build time.
```

- [ ] **Step 7: Commit**

```bash
git add website/docs/features.md website/docs/reference/agent.md
git commit -m "docs(sub-agents): document sub-agents in features + agent reference"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** schema field (Task 1), `ResolvedSubAgent` + `ResolvedAgent.subAgents` (Task 2), parser resolution + reference/cycle validation + `detectSubAgentCycle` (Task 3), `emitAgent` import + `agents:` field (Task 4), example + generated-project typecheck (Task 5), docs in features + agent reference (Task 6). The spec's golden emit test = Task 4; parser fixtures (missing ref, self-cycle, two-node cycle, happy path) = Task 3; example = Task 5. `index.ts` (Mastra registry) intentionally unchanged — verified because Task 5's generated project typechecks with both agents registered. No dependency/`versions.ts`/`emit-project-files.ts` change (sub-agents use `@mastra/core`, already present) and no `generate.ts` change (every `config.agents` entry, including the sub-agent, is already emitted).
- **Type consistency:** `ResolvedSubAgent { id, exportName }` (types.ts) ↔ parser's `{ id, exportName: toExportName(id) }` ↔ `emitAgent`'s `sub.exportName` / `sub.id` ↔ test fixtures `{ id: 'research-agent', exportName: 'researchAgent' }`. `ResolvedAgent.subAgents` is required (not optional); the parser always sets it, so `emitAgent` reads `agent.subAgents` safely — and the two pre-existing fixtures (`BASE`, `BASE_AGENT`) are given `subAgents: []` in Task 4, the same task that makes `emitAgent` read the field.
- **Cycle detector:** self-reference yields `['x','x']` → "circular sub-agent reference: x -> x"; `a→b→a` yields `['a','b','a']`. Graph keys iterate in `config.agents` order, so the two-node test deterministically reports `a -> b -> a` attributed to `agent/a.yaml`. Edges to ids absent from the ref map are skipped (those are caught by the "must be listed in config.yaml" check or by an earlier file-not-found issue), so the detector never throws on partial graphs.
- **Reporting:** v1 reports the first cycle found (per spec). Missing-reference issues are reported for every bad ref across all agents and aggregated with any cycle into one `ParseError`.
```
