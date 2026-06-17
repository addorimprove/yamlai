---
name: shaping-docs
description: Use when writing or editing any page under website/docs/ — reference pages (agent.md, model.md, config.md, …) or guides (getting-started, how-tos) — or when a doc reads wordy, repeats another page, or is hard to scan.
---

# Shaping Docs

Readers are developers: they read code first, prose second. **Show, then say** — code carries the meaning, prose only connects it.

## Rules

1. **Lead with code.** The first block after the one-line intro is an example, not a paragraph.
2. **One fact, one page.** A concern's resolved output lives on its own page; elsewhere, link to it — never reproduce another page's mapping. See `[[docs-single-source-of-truth]]`.
3. **Cut prose the code says.** A sentence that restates a field, a code line, or the obvious → delete.
4. **List → table or bullets.** Anything you'd compare or enumerate leaves prose.
5. **No hedging.** Show the real emitted output plainly — never "illustrative" or "the general pattern".

## Shape: thing vs task

Documenting a *thing* (a YAML concern) → **Reference**. Walking through a *task* → **Guide**.

## Reference template

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

`connection` is an **env var name**, not a URL — secrets stay out of YAML. `provider` selects the Mastra class.

## Generates `src/mastra/vectors/pg.ts`

```typescript
import { PgVector } from '@mastra/pg';

export const pg = new PgVector({ connectionString: process.env.DATABASE_URL! });
```
````

| Part | Rule |
|---|---|
| Frontmatter | `title:` = the filename pattern, quoted. |
| `#` heading | Escape brackets: `&lt;id&gt;`, never `` `<id>` ``. |
| Intro | **One** paragraph: what it is · id = filename · how it's referenced · **one** link. No second paragraph, no intro code block. |
| YAML | Minimal **real** example; inline `# → path` comments explain. |
| `## Fields` | Table only — no per-field `###` subsections. |
| Semantics | **One** paragraph for what's non-obvious; skip if the table covers it. |
| `## Generates <path>` | Filename in the heading; show the **actual** emitted TS. |
| Deep-dive `##` | Only when a rule genuinely surprises (cycles, thunks). Default: none. |

## Guide template

````markdown
---
title: Getting Started
---

# Getting Started

Requires **Node.js >= 22.13**.

## 1. Create the input project

```yaml
# agent/support-agent.yaml
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

→ [YAML Reference](./reference/config.md) · [CLI](./cli.md) · [Examples](./examples.md)
````

Numbered, verb-first steps; each is ≤1 sentence then code. Files as `` `path`: `` + a fenced block (`text` for trees). `:::note` for gotchas; `## Optional:` for add-ons; footer nav with ` · `.
