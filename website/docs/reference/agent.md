---
title: "agent/<id>.yaml"
---

# agent/&lt;id&gt;.yaml

One file per agent. The id is the filename (`agent/writer-agent.yaml` → id `writer-agent`). Also list the id in [config.yaml](./config.md) `agents:`.

```yaml
name: Writer
description: Drafts content for the user.
instructions: writer-prompt   # → prompt/writer-prompt.md
model: gpt-5-mini             # → model/gpt-5-mini.yaml
tools:
  - word-count                # → tools/word-count.ts
agents:
  - editor-agent              # → agent/editor-agent.yaml (must be in config.yaml)
```

## Fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | Yes | — | Human-readable name. |
| `description` | string | No | `''` | Short description. |
| `instructions` | string | Yes | — | A **prompt id** → [prompt/&lt;id&gt;.md](./prompt.md). |
| `model` | string | Yes | — | A **model id** → [model/&lt;id&gt;.yaml](./model.md). |
| `tools` | string[] | No | `[]` | **Tool ids** → [tools/&lt;id&gt;.ts](./tools.md). |
| `agents` | string[] | No | `[]` | **Sub-agent ids** → [agent/&lt;id&gt;.yaml](./agent.md), and must be in [config.yaml](./config.md) `agents:`. |
| `workflows` | string[] | No | `[]` | **Workflow ids** the agent can invoke → [workflow/&lt;id&gt;.yaml](./workflow.md), and must be in [config.yaml](./config.md) `workflows:`. |

`instructions`, `model`, and `tools` hold **ids**, not inline values — each must resolve to an existing file (and a tool file must export the camelCased id); `validate` catches a missing or mismatched reference.

## Generates `src/mastra/agents/writer-agent.ts`

```typescript
import { Agent } from '@mastra/core/agent';
import { wordCount } from '../tools/word-count';
import { editorAgent } from './editor-agent';
import { memory } from '../utils/memory';

export const writerAgent = new Agent({
  id: "writer-agent",
  name: "Writer",
  description: "Drafts content for the user.",
  instructions: `You are a writing assistant. Given a topic or brief, produce a clear, well-structured
draft. Use the word-count tool to check the draft against the target length.`,
  // resolved from model/gpt-5-mini.yaml (which sets temperature/max_tokens) — see model.md
  model: [{ model: "openai/gpt-5-mini", modelSettings: { temperature: 0.7, maxOutputTokens: 2048 } }],
  tools: { wordCount },
  agents: { editorAgent },
  memory,
});
```

The prompt is inlined into `instructions`; tools and sub-agents are imported by camelCase name. The `model` id resolves to the Model Router string (plus `modelSettings` when the model file sets `temperature`/`max_tokens`) — that mapping lives in **[model/&lt;id&gt;.yaml](./model.md)**, not here.

## Sub-agents (`agents`)

Each id must reference an `agent/<id>.yaml` **also listed in [config.yaml](./config.md) `agents:`**. Mastra exposes each sub-agent as a callable delegation tool named `agent-<exportName>`, keyed by **camelCase export name**, not YAML id (`editor-agent` → `agents: { editorAgent }` → tool `agent-editorAgent`). Steer delegation in prompts by that tool name.

Cycles (including self-reference) are allowed — Mastra delegates via a runtime tool call, so recursion is bounded by the agent's step limit. On a cycle, `agents` is emitted as a thunk (`() => ({ ... })`) for lazy binding, and the export gets an explicit `: Agent` annotation to break self-referential type inference:

```typescript
// agent/a.yaml: agents: [a]  →  src/mastra/agents/a.ts
export const a: Agent = new Agent({
  // ...
  agents: () => ({ a }),
});
```

## Workflows (`workflows`)

Attach workflows so the agent's model can invoke them as tools:

```yaml
workflows:
  - compare-drafts           # → workflow/compare-drafts.yaml (must be in config.yaml)
```

Each id must reference a [workflow/&lt;id&gt;.yaml](./workflow.md) that is **also listed
in [config.yaml](./config.md) `workflows:`** — `validate` catches a missing or
unregistered reference. Agent⇄workflow cycles are allowed: when an attached workflow runs
the attaching agent, the `workflows` field is emitted **lazily off the Mastra instance**
rather than as a static import. For that generated shape (static object vs. lazy thunk),
see [workflow reference → Attaching workflows to an agent](./workflow.md#attaching-workflows-to-an-agent-agentworkflows).
