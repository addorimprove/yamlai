---
title: Examples
---

# Example: writing assistant

A complete project — YAML in, runnable Mastra TypeScript out. The writer agent
uses memory, a `word-count` tool, and delegates to an `editor-agent` (which
self-delegates to recurse on sub-sections). It also defines two
[workflows](./reference/workflow.md) — a sequential `draft-flow` and a parallel
`compare-drafts` — with `brief`/`merge-drafts` as the glue tools between steps.

## Input

```text
examples/
├── config.yaml
├── agent/
│   ├── writer-agent.yaml
│   └── editor-agent.yaml
├── model/
│   └── gpt-5-mini.yaml
├── prompt/
│   ├── writer-prompt.md
│   └── editor-prompt.md
├── tools/
│   ├── word-count.ts
│   ├── brief.ts             # glue: { text } -> { prompt }
│   └── merge-drafts.ts      # merge: { 'writer-agent': {text}, 'editor-agent': {text} } -> { comparison }
└── workflow/
    ├── draft-flow.yaml       # sequential
    └── compare-drafts.yaml   # parallel fan-out + merge
```

```yaml title="config.yaml"
name: content-assistant
agents:
  - writer-agent
  - editor-agent
workflows:                 # registered on the Mastra instance (workflow/<id>.yaml)
  - draft-flow             # sequential: writer-agent -> brief(step) -> editor-agent
  - compare-drafts         # parallel:   [writer-agent | editor-agent] -> merge-drafts(tool)
logger:
  level: info
storage:
  type: libsql
  url: file:./mastra.db
memory:
  last_messages: 20
  working_memory:
    scope: resource
    template: |
      # Writing Preferences
      - Tone:
      - Audience:
```

```yaml title="agent/writer-agent.yaml"
name: Writer
description: Drafts content for the user.
instructions: writer-prompt
model: gpt-5-mini
memory: true
tools:
  - word-count
agents:
  - editor-agent
workflows:
  - compare-drafts          # compare-drafts runs writer-agent → agent⇄workflow cycle
```

```yaml title="agent/editor-agent.yaml"
name: Editor
description: Reviews and improves drafts for the writer.
instructions: editor-prompt
model: gpt-5-mini
# Self-delegation: recursively edit sub-sections with itself.
agents:
  - editor-agent
```

```yaml title="model/gpt-5-mini.yaml"
provider: openai
model: gpt-5-mini
temperature: 0.7
max_tokens: 2048
```

```md title="prompt/writer-prompt.md"
You are a writing assistant. Given a topic or brief, produce a clear, well-structured
draft. Use the word-count tool to check the draft against the target length.
```

```md title="prompt/editor-prompt.md"
You are an editor. Given a draft, improve it for clarity, flow, and concision.
Return only the revised text.
```

```typescript title="tools/word-count.ts"
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const wordCount = createTool({
  id: 'word-count',
  description: 'Counts the words in the given text.',
  inputSchema: z.object({
    text: z.string().describe('Text to count words in'),
  }),
  outputSchema: z.object({
    words: z.number(),
  }),
  execute: async (inputData) => {
    return { words: inputData.text.trim().split(/\s+/).filter(Boolean).length };
  },
});
```

## Generate

```bash
npx @addorimprove/yamlai ./examples ./content-assistant
```

## Output

```text
content-assistant/
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── src/mastra/
    ├── index.ts
    ├── agents/
    │   ├── writer-agent.ts
    │   └── editor-agent.ts
    ├── workflows/
    │   ├── draft-flow.ts
    │   └── compare-drafts.ts
    ├── tools/
    │   ├── word-count.ts
    │   ├── brief.ts             # copied verbatim (glue tool)
    │   └── merge-drafts.ts      # copied verbatim (merge tool)
    └── utils/
        └── memory.ts
```

```typescript title="src/mastra/index.ts"
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { writerAgent } from './agents/writer-agent';
import { editorAgent } from './agents/editor-agent';
import { draftFlow } from './workflows/draft-flow';
import { compareDrafts } from './workflows/compare-drafts';

export const mastra = new Mastra({
  agents: { writerAgent, editorAgent },
  workflows: { draftFlow, compareDrafts },
  storage: new LibSQLStore({ id: 'mastra-storage', url: "file:./mastra.db" }),
  logger: new PinoLogger({ name: 'Mastra', level: "info" }),
});
```

```typescript title="src/mastra/agents/writer-agent.ts"
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
  model: [{ model: "openai/gpt-5-mini", modelSettings: { temperature: 0.7, maxOutputTokens: 2048 } }],
  tools: { wordCount },
  agents: { editorAgent },
  // compare-drafts runs writer-agent (a parallel step), so this attachment is a
  // cycle — emitted lazily off the Mastra instance to avoid a static import cycle.
  workflows: ({ mastra }) => ({ compareDrafts: mastra!.getWorkflow("compareDrafts") }),
  memory,
});
```

The model id inlines to the Model Router string plus `modelSettings`; the prompt
inlines into `instructions`; `word-count` and the `editor-agent` sub-agent are
imported by camelCase name; `memory: true` wires in the shared `memory` util. The
attached `compare-drafts` workflow forms an agent⇄workflow cycle, so its
`workflows` field is emitted as a lazy thunk off `mastra` — see
[workflow reference → Attaching workflows to an agent](./reference/workflow.md#attaching-workflows-to-an-agent-agentworkflows).

```typescript title="src/mastra/agents/editor-agent.ts"
import { Agent } from '@mastra/core/agent';

export const editorAgent: Agent = new Agent({
  id: "editor-agent",
  name: "Editor",
  description: "Reviews and improves drafts for the writer.",
  instructions: `You are an editor. Given a draft, improve it for clarity, flow, and concision.
Return only the revised text.`,
  model: [{ model: "openai/gpt-5-mini", modelSettings: { temperature: 0.7, maxOutputTokens: 2048 } }],
  agents: () => ({ editorAgent }),
});
```

Because `editor-agent` sits on a delegation cycle (it references itself), its
`agents` field is emitted as a thunk (`() => ({ ... })`) and the export gets an
explicit `: Agent` annotation — this resolves the circular binding lazily at
runtime and avoids the self-referential type-inference error. See
[agent reference → Sub-agents](./reference/agent.md).

```typescript title="src/mastra/utils/memory.ts"
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

export const memory = new Memory({
  storage: new LibSQLStore({ id: 'memory-storage', url: "file:./mastra.db" }),
  options: {
    lastMessages: 20,
    workingMemory: { enabled: true, scope: "resource", template: `# Writing Preferences
- Tone:
- Audience:` },
  },
});
```

## Run

```bash
cd content-assistant
npm install
export OPENAI_API_KEY=sk-...
npm run dev
```

## Workflows

The two `workflow/` files compile to `createWorkflow(...).then()/.parallel().commit()`
chains and register on the Mastra instance (see [index.ts](#output) above). The glue
tools `brief`/`merge-drafts` are ordinary [tools](./reference/tools.md) — tools
double as the shaping/merge units between steps. For the full mapping (step kinds,
`input`/`output` → Zod, attachment, gotchas) see the
[workflow reference](./reference/workflow.md).

```yaml title="workflow/draft-flow.yaml"
# id = filename (draft-flow). Steps run in order via .then().
description: Draft the content, then have the editor refine it.

input:  { prompt: string }     # matches an agent step's input shape directly
output: { text: string }       # matches an agent step's output shape directly

steps:
  - agent: writer-agent        # { prompt } -> { text }
  - step:  brief               # { text }  -> { prompt }   (glue step, workflow/steps/brief.ts — typed execute)
  - agent: editor-agent        # { prompt } -> { text }
```

```typescript title="src/mastra/workflows/draft-flow.ts"
export const draftFlow = createWorkflow({
  id: 'draft-flow',
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ text: z.string() }),
})
  .then(createStep(writerAgent))
  .then(brief)
  .then(createStep(editorAgent))
  .commit();
```

```yaml title="workflow/compare-drafts.yaml"
name: Compare Drafts
description: Have the writer and editor each draft from the same brief, then merge.

input:  { prompt: string }     # → z.object({ prompt: z.string() })
output: { comparison: string }

steps:
  - parallel:                  # both agents run at once on the same { prompt }
      - agent: writer-agent
      - agent: editor-agent
  - tool: merge-drafts         # { 'writer-agent': {text}, 'editor-agent': {text} } -> { comparison }
```

```typescript title="src/mastra/workflows/compare-drafts.ts"
export const compareDrafts = createWorkflow({
  id: 'compare-drafts',
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ comparison: z.string() }),
})
  .parallel([createStep(writerAgent), createStep(editorAgent)])
  .then(createStep(mergeDrafts))
  .commit();
```
