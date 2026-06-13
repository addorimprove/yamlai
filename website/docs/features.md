---
title: Features
---

# Features

What you can generate from YAML today, and what's planned. Maps [Mastra](https://mastra.ai) v1 (v1.42) capabilities to YAMLAI.

## Available now ✅

```yaml title="config.yaml"
name: my-mastra-app
agents: [support-agent]      # register agents
logger: { level: info }      # logger
storage:                     # storage (libsql)
  type: libsql
  url: file:./mastra.db
```

```yaml title="agent/<id>.yaml"
name: Support Agent
description: Handles support questions
instructions: support-prompt  # prompt/<id>.md
model: gpt-5-mini             # model/<id>.yaml
tools: [echo-tool]            # tools/<id>.ts
```

| Feature | Where | Pattern |
|---|---|---|
| Project config | `config.yaml` → `name`, `agents` | declarative |
| Agents | `agent/<id>.yaml` | declarative |
| Models | `model/<id>.yaml` → `provider`, `model`, `temperature`, `max_tokens` | declarative |
| Tools | `tools/<id>.ts` (`createTool`) | author-as-code |
| Prompts | `prompt/<id>.md` | author-as-code |
| Logger | `config.yaml` → `logger.level` | declarative |
| Storage | `config.yaml` → `storage` (libsql) | declarative |

## Coming ⏳

Planned YAML, roughly in priority order. **Tier:** A = declarative/low-effort · B = author-as-code · C = infra/heavy.

| # | Feature | Planned syntax | Pattern | Tier |
|---|---|---|---|---|
| 8 | Memory | `memory/<id>.yaml` (`vector`, `embedder`, `last_messages`, `semantic_recall`, `working_memory`) + agent `memory: <id>` | declarative | A |
| 9 | Sub-agents | agent `agents: [research-agent]` | declarative | A |
| 10 | Guardrails / processors | agent `input_processors`, `output_processors` | declarative | A |
| 11 | Scorers / evals | agent `scorers: [answer-relevancy, toxicity]` | declarative | A |
| 12 | Run limits | agent `max_steps`, `stop_when` | declarative | A |
| 13 | Metadata | agent `metadata: { team: support }` | declarative | A |
| 14 | Observability / tracing | `config.yaml` → `observability` | declarative | A |
| 15 | Workflows | `workflow/<id>.ts` (`createWorkflow`) + agent `workflows: [<id>]` | author-as-code | B |
| 16 | Structured output | `schema/<id>.ts` (Zod) + agent `output: <id>` | author-as-code | B |
| 17 | MCP tool servers | `mcp/<id>.yaml` (`command`/`url`) | declarative | B |
| 18 | Custom processors / scorers | `processor/<id>.ts`, `scorer/<id>.ts` | author-as-code | B |
| 19 | Voice | `voice/<id>.yaml` (provider + config) | declarative | B |
| 20 | RAG | vector-query tool + ingestion pipeline | author-as-code | C |
| 21 | Vector stores | `config.yaml` → `vectors` (pg, pinecone, qdrant, …) | declarative | C |
| 22 | Server / auth adapters | express / hono / nestjs + auth providers | hand-wired | C |
| 23 | Deployment | cloudflare / vercel / netlify deployers | hand-wired | C |
| 24 | Workspaces / sandboxes / browser | filesystem, sandbox, agent-browser | hand-wired | C |

### Next up

1. **Memory** (#8) — highest value-to-effort; Mastra's memory config maps ~1:1 to YAML, storage already wired.
2. **Sub-agents** (#9) — reuses the tools resolver; unlocks supervisor / multi-agent.
3. **Workflows** (#15) — the tools pipeline applied to a `workflow/` folder.
4. **Guardrails / processors** (#10) — small declarative catalog, big production value (PII, moderation, injection).
5. **Structured output** (#16) — once the YAML→Zod schema approach is settled.
