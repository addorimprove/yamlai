# Schema Reference

The YAML shapes for the YAML Agent Builder (v1), annotated inline. For design rationale and
codegen output, see [`SPEC.md`](SPEC.md).

Annotation format: `# <type> · required|optional (default: …) → <reference>`.
Enums list every allowed value: `enum · one of: a | b | c (default: b)`.
Conventions: **`id` = filename** for every entity; a kebab-case id (`support-agent`) becomes the
camelCase generated variable (`supportAgent`).

---

## config.yaml

```yaml
name: my-mastra-app       # string   · required          → package.json name + output dir
agents:                   # string[] · required (min 1)  → each id must match agent/<id>.yaml
  - support-agent
  - research-agent

logger:                   # object   · optional (default: { level: info })
  level: info             # enum     · optional · one of: debug | info | warn | error (default: info)

storage:                  # object   · optional (default: omitted → no storage block)
  type: libsql            # enum     · required if storage present · one of: libsql (only value in v1)
  url: file:./mastra.db   # string   · required if storage present → file:… | :memory:
```

---

## agent/&lt;id&gt;.yaml

```yaml
# id is the filename (support-agent.yaml → id: support-agent); do not set it in the body.
name: Support Agent       # string   · required
description: ...          # string   · optional (default: "")
instructions: |           # string   · required   (use block scalar `|` for multiline)
  You are a helpful support assistant. Be concise and accurate.
model: gpt-5-mini         # string   · required          → model/<id>.yaml
tools:                    # string[] · optional (default: [])  → each id must match tools/<id>.ts
  - echo-tool
```

---

## model/&lt;id&gt;.yaml

```yaml
# id is the filename (gpt-5-mini.yaml → id: gpt-5-mini); do not set it in the body.
provider: openai          # string   · required   → e.g. openai | anthropic | openrouter
model: gpt-5-mini         # string   · required   → may contain "/" for gateway routing
temperature: 0.7          # number   · optional (default: provider default) → range 0–2
max_tokens: 2048          # integer  · optional (default: provider default) → must be > 0
```

`provider` + `model` join into the Model Router string `"${provider}/${model}"`
(e.g. `openai/gpt-5-mini`). `temperature`/`max_tokens` map to the agent's
`modelSettings: { temperature, maxTokens }`. API keys come from env (e.g. `OPENAI_API_KEY`), never
from YAML.

---

## tools/&lt;id&gt;.ts

Not YAML — a TypeScript module. The exported variable name is the camelCase form of `<id>`.

```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const echoTool = createTool({
  id: 'echo-tool',        // string      · required (should equal the filename)
  description: '...',     // string      · required (shown to the model)
  inputSchema: z.object({ // Zod schema  · required
    text: z.string(),
  }),
  outputSchema: z.object({// Zod schema  · optional
    text: z.string(),
  }),
  execute: async (inputData) => {  // function · required: (inputData) => output, async allowed
    return { text: inputData.text };
  },
});
```

---

## Cross-reference rules

Every reference below must resolve to an existing file, or codegen fails with a hard error:

```text
config.yaml › agents[]  →  agent/<id>.yaml
agent › model           →  model/<id>.yaml
agent › tools[]         →  tools/<id>.ts
```
