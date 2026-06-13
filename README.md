# Mastra YAML Agent Builder

Codegen that turns a small YAML project into a runnable [Mastra](https://mastra.ai) v1 TypeScript
app. Not a runtime loader — the output is plain Mastra source you own and can edit.

```
YAML project → parseProject() → generateProject() → writeProject() → Mastra TS project
   (input)      parse+validate     emit (FileMap)     guarded write     (mastra build)
```

## Quick start

```bash
# Run without installing (published as `yamlai`):
npx yamlai <input> [output] [--force]
npx yamlai ./examples ./out
```

Or from a clone of this repo:

```bash
cd builder
pnpm install

pnpm gen ../examples ../out   # generic CLI: gen <input> [output] [--force]
pnpm gen:example              # bundled example (examples/) → ./my-mastra-app
```

Run the generated project:

```bash
cd ../out
pnpm install
pnpm build      # mastra build → .mastra/output/
pnpm dev        # mastra dev (local playground)
```

Model API keys come from the environment (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, …). Put them in a
`.env` **inside the generated project** — it's git-ignored there.

> ⚠️ The writer always refuses to write over the **input dir**, and refuses any **non-empty output
> dir** unless you pass `--force` — which deletes and rewrites the whole directory. Add `.env` and
> other hand-edits *after* generating, or keep them outside the output dir.

## Input format

`id` = filename for every entity. A kebab-case id (`support-agent`) becomes a camelCase variable
(`supportAgent`). Agents reference models and tools by id.

```
config.yaml
agent/  support-agent.yaml
model/  gpt-5-mini.yaml
tools/  echo-tool.ts
```

**`config.yaml`**

```yaml
name: my-mastra-app       # package.json name + default output dir
agents:                   # explicit list; each id → agent/<id>.yaml
  - support-agent
logger:                   # optional (default: { level: info })
  level: info             # debug | info | warn | error
storage:                  # optional — omit for no storage block
  type: libsql            # v1: libsql only
  url: file:./mastra.db   # or ":memory:"
```

**`agent/<id>.yaml`**

```yaml
name: Support Agent
description: Handles customer support questions.
instructions: |
  You are a helpful support assistant. Be concise and accurate.
model: gpt-5-mini         # → model/<id>.yaml
tools:                    # → tools/<id>.ts (optional)
  - echo-tool
```

**`model/<id>.yaml`** — `provider` + `model` form Mastra's Model Router string
(`openai/gpt-5-mini`, `openrouter/anthropic/claude-3.5-haiku`, …). Models are **inlined** into the
agents that reference them; no model file is emitted.

```yaml
provider: openai          # joined with model → "provider/model"
model: gpt-5-mini         # may contain "/" for gateway routing
temperature: 0.7          # optional → modelSettings.temperature
max_tokens: 2048          # optional → modelSettings.maxTokens
```

**`tools/<id>.ts`** — a plain Mastra `createTool` module, copied **verbatim** into the output.

```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const echoTool = createTool({
  id: 'echo-tool',
  description: 'Echoes the input text back.',
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ text: z.string() }),
  execute: async (inputData) => ({ text: inputData.text }),
});
```

## Generated output

```
<name>/
├── package.json          # @mastra/core, zod, @mastra/loggers (+@mastra/libsql if storage)
├── tsconfig.json         # mirrors a fresh mastra scaffold (moduleResolution: bundler, noEmit)
├── pnpm-workspace.yaml   # allowBuilds: esbuild (mastra build needs esbuild's binary)
├── .gitignore
└── src/mastra/
    ├── index.ts          # new Mastra({ agents, storage?, logger })
    ├── agents/<id>.ts    # new Agent({ id, name, instructions, model, modelSettings, tools })
    └── tools/<id>.ts     # copied from input tools/
```

## Library API

```ts
import { parseProject, generateProject, writeProject } from 'yamlai';

const project = parseProject('./examples');           // ParsedProject (throws ParseError)
const files   = generateProject(project, './examples'); // FileMap: { 'src/mastra/index.ts': '…' }
writeProject(files, './out', './examples', { force }); // guarded write to disk
```

| Export | Purpose |
|---|---|
| `parseProject(rootDir)` | Parse + validate a YAML project → `ParsedProject`. All problems collected into one `ParseError`. |
| `generateProject(project, rootDir)` | Build the in-memory `FileMap`. Pure except for reading tool sources. |
| `writeProject(files, outDir, rootDir, opts?)` | Write the map. Always refuses to write over the input dir; refuses a non-empty output dir unless `opts.force`. |
| Types | `ParsedProject`, `ResolvedAgent`, `ResolvedModel`, `ResolvedTool`, `FileMap`, `ParseError`. |

## Repository layout

```
builder/        # parser (parser.ts, schemas.ts) + codegen (src/codegen/) + CLIs (scripts/)
examples/       # sample input project (used by pnpm gen:example)
sample-mastra/  # reference Mastra v1 project (output shapes codegen targets, @mastra/core@1.42)
docs/           # SPEC.md, schema.md, design/plan docs
```

- [`docs/SPEC.md`](docs/SPEC.md) — full design and YAML→Mastra mappings
- [`docs/schema.md`](docs/schema.md) — annotated YAML schema reference

## Development

```bash
cd builder
pnpm install
pnpm build           # tsc type-check / emit to dist/
pnpm parse:example   # parse examples/ → dump resolved ParsedProject
pnpm gen:example     # generate examples/ → ./my-mastra-app
```

Requires Node ≥ 22.13 and pnpm. Tests are deferred for v1; the pipeline is verified by the example
project building successfully under `mastra build`.

---

> **v1 scope:** agents + models + tools. Schema and pipeline are designed to extend to workflows,
> memory, RAG, and evals later.
