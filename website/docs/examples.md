---
title: Examples
---

# Example: support agent

A complete project — YAML in, runnable Mastra TypeScript out. The support agent
uses memory, an `echo-tool`, and delegates to a `research-agent` (which
self-delegates to recurse on sub-questions). It also defines two
[workflows](./reference/workflow.md) — a sequential `research-flow` and a parallel
`compare-answers` — with `rephrase`/`merge-answers` as the glue tools between steps.

## Input

```text
examples/
├── config.yaml
├── agent/
│   ├── support-agent.yaml
│   └── research-agent.yaml
├── model/
│   └── gpt-5-mini.yaml
├── prompt/
│   ├── support-prompt.md
│   └── research-prompt.md
├── tools/
│   ├── echo-tool.ts
│   ├── rephrase.ts          # glue: { text } -> { prompt }
│   └── merge-answers.ts     # merge: { 'research-agent': {text}, 'support-agent': {text} } -> { comparison }
└── workflow/
    ├── research-flow.yaml    # sequential
    └── compare-answers.yaml  # parallel fan-out + merge
```

```yaml title="config.yaml"
name: my-mastra-app
agents:
  - support-agent
  - research-agent
workflows:                 # registered on the Mastra instance (workflow/<id>.yaml)
  - research-flow          # sequential: research-agent -> rephrase(tool) -> support-agent
  - compare-answers        # parallel:   [research-agent | support-agent] -> merge-answers(tool)
logger:
  level: info
storage:
  type: libsql
  url: file:./mastra.db
memory:
  last_messages: 20
  semantic_recall:
    embedder: openai/text-embedding-3-small
    top_k: 3
    message_range: { before: 2, after: 1 }
    scope: resource
  working_memory:
    scope: resource
    template: |
      # User Profile
      - Name:
      - Plan tier:
```

```yaml title="agent/support-agent.yaml"
name: Support Agent
description: Handles customer support questions.
instructions: support-prompt
model: gpt-5-mini
memory: true
tools:
  - echo-tool
agents:
  - research-agent
workflows:
  - compare-answers          # compare-answers runs support-agent → agent⇄workflow cycle
```

```yaml title="agent/research-agent.yaml"
name: Research Agent
description: Looks up background information for the support agent.
instructions: research-prompt
model: gpt-5-mini
# Self-delegation: recursively research sub-questions with itself.
agents:
  - research-agent
```

```yaml title="model/gpt-5-mini.yaml"
provider: openai
model: gpt-5-mini
temperature: 0.7
max_tokens: 2048
```

```md title="prompt/support-prompt.md"
You are a helpful support assistant. Be concise and accurate.
Use the echo-tool when you need to repeat the user's input back to them.
```

```md title="prompt/research-prompt.md"
You are a research assistant. Given a question, find and summarise the relevant
background information concisely. Return only the facts the caller needs.
```

```typescript title="tools/echo-tool.ts"
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const echoTool = createTool({
  id: 'echo-tool',
  description: 'Echoes the input text back.',
  inputSchema: z.object({
    text: z.string().describe('Text to echo back'),
  }),
  outputSchema: z.object({
    text: z.string(),
  }),
  execute: async (inputData) => {
    return { text: inputData.text };
  },
});
```

## Generate

```bash
npx @addorimprove/yamlai ./examples ./my-mastra-app
```

## Output

```text
my-mastra-app/
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── src/mastra/
    ├── index.ts
    ├── agents/
    │   ├── support-agent.ts
    │   └── research-agent.ts
    ├── workflows/
    │   ├── research-flow.ts
    │   └── compare-answers.ts
    ├── tools/
    │   ├── echo-tool.ts
    │   ├── rephrase.ts          # copied verbatim (glue tool)
    │   └── merge-answers.ts     # copied verbatim (merge tool)
    └── utils/
        └── memory.ts
```

```typescript title="src/mastra/index.ts"
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { supportAgent } from './agents/support-agent';
import { researchAgent } from './agents/research-agent';
import { researchFlow } from './workflows/research-flow';
import { compareAnswers } from './workflows/compare-answers';

export const mastra = new Mastra({
  agents: { supportAgent, researchAgent },
  workflows: { researchFlow, compareAnswers },
  storage: new LibSQLStore({ id: 'mastra-storage', url: "file:./mastra.db" }),
  logger: new PinoLogger({ name: 'Mastra', level: "info" }),
});
```

```typescript title="src/mastra/agents/support-agent.ts"
import { Agent } from '@mastra/core/agent';
import { echoTool } from '../tools/echo-tool';
import { researchAgent } from './research-agent';
import { memory } from '../utils/memory';

export const supportAgent = new Agent({
  id: "support-agent",
  name: "Support Agent",
  description: "Handles customer support questions.",
  instructions: `You are a helpful support assistant. Be concise and accurate.
Use the echo-tool when you need to repeat the user's input back to them.`,
  model: [{ model: "openai/gpt-5-mini", modelSettings: { temperature: 0.7, maxOutputTokens: 2048 } }],
  tools: { echoTool },
  agents: { researchAgent },
  // compare-answers runs support-agent (a parallel step), so this attachment is a
  // cycle — emitted lazily off the Mastra instance to avoid a static import cycle.
  workflows: ({ mastra }) => ({ compareAnswers: mastra!.getWorkflow("compareAnswers") }),
  memory,
});
```

The model id inlines to the Model Router string plus `modelSettings`; the prompt
inlines into `instructions`; `echo-tool` and the `research-agent` sub-agent are
imported by camelCase name; `memory: true` wires in the shared `memory` util. The
attached `compare-answers` workflow forms an agent⇄workflow cycle, so its
`workflows` field is emitted as a lazy thunk off `mastra` — see
[workflow reference → Attaching workflows to an agent](./reference/workflow.md#attaching-workflows-to-an-agent-agentworkflows).

```typescript title="src/mastra/agents/research-agent.ts"
import { Agent } from '@mastra/core/agent';

export const researchAgent: Agent = new Agent({
  id: "research-agent",
  name: "Research Agent",
  description: "Looks up background information for the support agent.",
  instructions: `You are a research assistant. Given a question, find and summarise the relevant
background information concisely. Return only the facts the caller needs.`,
  model: [{ model: "openai/gpt-5-mini", modelSettings: { temperature: 0.7, maxOutputTokens: 2048 } }],
  agents: () => ({ researchAgent }),
});
```

Because `research-agent` sits on a delegation cycle (it references itself), its
`agents` field is emitted as a thunk (`() => ({ ... })`) and the export gets an
explicit `: Agent` annotation — this resolves the circular binding lazily at
runtime and avoids the self-referential type-inference error. See
[agent reference → Sub-agents](./reference/agent.md).

```typescript title="src/mastra/utils/memory.ts"
import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';

export const memory = new Memory({
  storage: new LibSQLStore({ id: 'memory-storage', url: "file:./mastra.db" }),
  vector: new LibSQLVector({ id: 'memory-vector', url: "file:./mastra.db" }),
  embedder: "openai/text-embedding-3-small",
  options: {
    lastMessages: 20,
    semanticRecall: { topK: 3, messageRange: { before: 2, after: 1 }, scope: "resource" },
    workingMemory: { enabled: true, scope: "resource", template: `# User Profile
- Name:
- Plan tier:` },
  },
});
```

## Run

```bash
cd my-mastra-app
npm install
export OPENAI_API_KEY=sk-...
npm run dev
```

## Workflows

The two `workflow/` files compile to `createWorkflow(...).then()/.parallel().commit()`
chains and register on the Mastra instance (see [index.ts](#output) above). The glue
tools `rephrase`/`merge-answers` are ordinary [tools](./reference/tools.md) — tools
double as the shaping/merge units between steps. For the full mapping (step kinds,
`input`/`output` → Zod, attachment, gotchas) see the
[workflow reference](./reference/workflow.md).

```yaml title="workflow/research-flow.yaml"
# id = filename (research-flow). Steps run in order via .then().
name: Research Flow
description: Research a question, then have the support agent answer from the notes.

input:  { prompt: string }     # matches an agent step's input shape directly
output: { text: string }       # matches an agent step's output shape directly

steps:
  - agent: research-agent      # { prompt } -> { text }
  - tool:  rephrase            # { text }  -> { prompt }   (glue tool, tools/rephrase.ts)
  - agent: support-agent       # { prompt } -> { text }
```

```typescript title="src/mastra/workflows/research-flow.ts"
export const researchFlow = createWorkflow({
  id: 'research-flow',
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ text: z.string() }),
})
  .then(createStep(researchAgent))
  .then(createStep(rephrase))
  .then(createStep(supportAgent))
  .commit();
```

```yaml title="workflow/compare-answers.yaml"
name: Compare Answers
description: Ask the research and support agents the same question in parallel, then merge.

input:  { prompt: string }     # → z.object({ prompt: z.string() })
output: { comparison: string }

steps:
  - parallel:                  # both agents run at once on the same { prompt }
      - agent: research-agent
      - agent: support-agent
  - tool: merge-answers        # { 'research-agent': {text}, 'support-agent': {text} } -> { comparison }
```

```typescript title="src/mastra/workflows/compare-answers.ts"
export const compareAnswers = createWorkflow({
  id: 'compare-answers',
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ comparison: z.string() }),
})
  .parallel([createStep(researchAgent), createStep(supportAgent)])
  .then(createStep(mergeAnswers))
  .commit();
```
