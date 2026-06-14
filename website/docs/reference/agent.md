---
title: "agent/<id>.yaml"
---

# agent/&lt;id&gt;.yaml

One file per agent. The id is the filename (`agent/support-agent.yaml` → id `support-agent`). Also list the id in [config.yaml](./config.md) `agents:`.

```yaml
name: Support Agent
description: Handles customer support questions.
instructions: support-prompt   # → prompt/support-prompt.md
model: gpt-5-mini             # → model/gpt-5-mini.yaml
tools:
  - echo-tool                # → tools/echo-tool.ts
agents:
  - research-agent           # → agent/research-agent.yaml (must be in config.yaml)
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

`instructions`, `model`, and `tools` hold **ids**, not inline values — each must resolve to an existing file or codegen fails.

## Generates `src/mastra/agents/support-agent.ts`

```typescript
import { Agent } from '@mastra/core/agent';
import { echoTool } from '../tools/echo-tool';
import { researchAgent } from './research-agent';

export const supportAgent = new Agent({
  id: 'support-agent',
  name: 'Support Agent',
  description: 'Handles customer support questions.',
  instructions: `You are a helpful support assistant. Be concise and accurate.
Use the echo-tool when you need to repeat the user's input back to them.`,
  model: 'openai/gpt-5-mini',
  modelSettings: { temperature: 0.7, maxTokens: 2048 },
  tools: { echoTool },
  agents: { researchAgent },
});
```

The prompt is inlined into `instructions`, the model becomes the router string + `modelSettings`, and tools are imported by camelCase name.

## Sub-agents (`agents`)

Each id in `agents` must reference an `agent/<id>.yaml` that is **also listed in
`config.yaml`'s `agents:`**. Mastra exposes each sub-agent to this agent as a callable
tool, so its model can delegate work to specialised agents. Cycles — including an agent
referencing itself — are rejected at build time.
