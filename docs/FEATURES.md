# Feature Matrix — YAML Agent Builder

Mapping of Mastra v1 (v1.42) capabilities to this codegen tool.

- **Status:** ✅ done · ⏳ pending
- **Pattern:** `declarative` = emitted into `new Agent({...})`/`new Mastra({...})` from YAML · `author-as-code` = user writes a `.ts` unit, copied verbatim and referenced by id (like `tools/`)
- **Tier:** A = declarative/low-effort/high-use · B = author-as-code/medium · C = infra/heavy

| # | Feature | Syntax | Pattern | Tier | Status |
|---|---------|--------|---------|------|--------|
| 1 | Project config | `config.yaml`: `name`, `agents: [...]` | declarative | — | ✅ |
| 2 | Agents | `agent/<id>.yaml`: `name`, `description`, `model`, `tools` | declarative | — | ✅ |
| 3 | Models | `model/<id>.yaml`: `provider`, `model`, `temperature`, `max_tokens` | declarative | — | ✅ |
| 4 | Tools | `tools/<id>.ts` (`createTool`) + agent `tools: [echo-tool]` | author-as-code | — | ✅ |
| 5 | Prompts | `prompt/<id>.md` + agent `instructions: support-prompt` | author-as-code | — | ✅ |
| 6 | Logger | `config.yaml`: `logger: { level: info }` | declarative | — | ✅ |
| 7 | Storage | `config.yaml`: `storage: { type: libsql, url: file:./mastra.db }` | declarative | — | ✅ |
| 8 | Memory | `memory/<id>.yaml`: `vector`, `embedder`, `last_messages`, `semantic_recall`, `working_memory` + agent `memory: <id>` | declarative | A | ⏳ |
| 9 | Sub-agents | agent `agents: [research-agent]` → `agents: { researchAgent }` | declarative | A | ⏳ |
| 10 | Guardrails / processors | agent `input_processors: [pii-detector, moderation]`, `output_processors: [...]` | declarative | A | ⏳ |
| 11 | Scorers / evals | agent `scorers: [answer-relevancy, toxicity]` | declarative | A | ⏳ |
| 12 | Run limits | agent `max_steps`, `stop_when` → `defaultOptions` | declarative | A | ⏳ |
| 13 | Metadata | agent `metadata: { team: support }` | declarative | A | ⏳ |
| 14 | Observability / tracing | `config.yaml`: `observability: { ... }` | declarative | A | ⏳ |
| 15 | Workflows | `workflow/<id>.ts` (`createWorkflow`) + agent `workflows: [<id>]` | author-as-code | B | ⏳ |
| 16 | Structured output | `schema/<id>.ts` (Zod) + agent `output: <id>` | author-as-code | B | ⏳ |
| 17 | MCP tool servers | `mcp/<id>.yaml`: `command`/`url` → `new MCPClient({...})` | declarative | B | ⏳ |
| 18 | Custom processors / scorers | `processor/<id>.ts`, `scorer/<id>.ts` imported verbatim | author-as-code | B | ⏳ |
| 19 | Voice | `voice/<id>.yaml`: provider + config → `voice: new CompositeVoice(...)` | declarative | B | ⏳ |
| 20 | RAG | vector-query tool + ingestion pipeline | author-as-code | C | ⏳ |
| 21 | Vector stores | `config.yaml`: `vectors: { ... }` (pg, pinecone, qdrant, …) | declarative | C | ⏳ |
| 22 | Server / auth adapters | express/hono/nestjs + auth providers | hand-wired | C | ⏳ |
| 23 | Deployment | cloudflare / vercel / netlify deployers | hand-wired | C | ⏳ |
| 24 | Workspaces / sandboxes / browser | filesystem, sandbox, agent-browser | hand-wired | C | ⏳ |

## Recommended next phases

| Order | Feature | Why |
|-------|---------|-----|
| 1 | Memory (#8) | Highest value-to-effort; Mastra ships a serializable memory config mapping ~1:1 to YAML; storage already wired |
| 2 | Sub-agents (#9) | Near-free; copies the tools resolver; unlocks supervisor / multi-agent |
| 3 | Workflows (#15) | Tools pipeline applied to a `workflow/` folder |
| 4 | Guardrails / processors (#10) | Small declarative catalog, big production value (PII, moderation, injection) |
| 5 | Structured output (#16) | Valuable once the YAML→Zod schema approach is decided |
