---
name: shaping-docs
description: Use when writing or editing any page under website/docs/ — reference pages (agent.md, model.md, config.md, …) or guides (getting-started, how-tos) — or when a doc reads wordy, repeats another page, or is hard to scan.
---

# Shaping Docs

Readers are developers. They read code first and prose second. So **show, then say** — code carries the meaning, prose only connects it.

## Three rules

1. **Lead with code.** Every page's first block after the intro line is an example, not a paragraph.
2. **One fact, one page.** A concern's resolved output is documented on *its own* page. Elsewhere: reference the id and link. Never reproduce another page's mapping. See `[[docs-single-source-of-truth]]`.
3. **Cut prose the code already says.** If a sentence restates a field name or a code line, delete it.

## Pick a shape

Documenting a *thing* (a YAML concern, a config surface) → **Reference**.
Walking through a *task* (set up, add X, run) → **Guide**.

## Reference template

The shape every `website/docs/reference/*.md` page follows. Copy it literally.

````markdown
---
title: "vector/<id>.yaml"
---

# vector/&lt;id&gt;.yaml

One file per vector store. The id is the filename (`vector/pg.yaml` → id `pg`). Listed in [config.yaml](./config.md) `vectors:`.

```yaml
provider: pgvector
connection: DATABASE_URL   # env var name, not the URL
dimensions: 1536
```

## Fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `provider` | string | Yes | — | e.g. `pgvector`, `pinecone`, `libsql`. |
| `connection` | string | Yes | — | Name of the env var holding the URL. |
| `dimensions` | integer | No | `1536` | Embedding size; match your embedder. |
| `index_name` | string | No | `"embeddings"` | Index/table name. |

`connection` holds an **env var name**, not a URL — secrets stay out of YAML and resolve at runtime. `provider` selects the Mastra vector class.

## Generates `src/mastra/vectors/pg.ts`

```typescript
import { PgVector } from '@mastra/pg';

export const pg = new PgVector({
  connectionString: process.env.DATABASE_URL!,
});
```
````

**Anatomy — keep this order, nothing extra:**

| Part | Rule |
|---|---|
| Frontmatter | `title:` = the literal filename pattern, quoted. |
| `#` heading | HTML-escape the brackets: `&lt;id&gt;`, never `` `<id>` ``. |
| Intro | **One** paragraph: what it is · id = filename · how it's referenced · **one** link. No second paragraph, no intro code block. |
| YAML block | Minimal **real** example. Inline `# → path` / `# note` comments do the explaining. |
| `## Fields` | Table only: `Field \| Type \| Required \| Default \| Description`. No per-field `###` subsections. |
| Semantics | **One** paragraph for what's non-obvious (ids-not-values, what maps to what). Skip if the table says it all. |
| `## Generates <path>` | Filename in the heading. Show the **actual** emitted TS — no "illustrative", no hedging blockquote. |
| Deep-dive `##` | Add **only** when a rule genuinely surprises (e.g. cycles, thunks). Default: none. |

## Guide template

The shape for `getting-started.md` and how-tos. Numbered, verb-first steps; each step is ≤1 sentence then code.

````markdown
---
title: Getting Started
---

# Getting Started

Requires **Node.js >= 22.13**.

## 1. Create the input project

```text
my-project/
├── config.yaml
└── agent/
    └── support-agent.yaml
```

`agent/support-agent.yaml`:

```yaml
name: Support Agent
model: gpt-5-mini   # → model/gpt-5-mini.yaml
```

## 2. Generate

```bash
npx @addorimprove/yamlai ./my-project ./out
```

:::note
`--force` deletes and rewrites the whole output dir.
:::

## Optional: add memory

Add a `memory:` block and opt agents in with `memory: true`. See [Memory reference](./reference/memory.md).

→ [YAML Reference](./reference/config.md) · [CLI](./cli.md) · [Examples](./examples.md)
````

**Rules:** show each file as `` `path`: `` then a fenced block (`text` for trees, `yaml`/`typescript`/`bash` otherwise) · `:::note` for gotchas · `## Optional:` for add-ons · footer nav with ` · ` separators.

## Smells → fix

| Smell | Fix |
|---|---|
| A paragraph explaining a field already in the table | Delete it; if it adds nothing, the field name + table row is enough. |
| `### fieldName` subsections under `## Fields` | Collapse into the table; one shared semantics paragraph if needed. |
| The same mapping shown on two pages | Keep it on the owning page; elsewhere link to it. |
| Reference page with no `## Generates` | Add it — a reference page must show its output. |
| "illustrative", "for example, the general pattern" hedging | Show the real deterministic output plainly. |
| Wall of prose before any code | Move a code block up; cut prose to the connective minimum. |
| `` # `name/<id>` `` in a heading | `# name/&lt;id&gt;.yaml`. |
