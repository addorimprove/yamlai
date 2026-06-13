---
title: "model/<id>.yaml"
---

# model/&lt;id&gt;.yaml

One file per model. The id is the filename (`model/gpt-5-mini.yaml` → id `gpt-5-mini`). Selected by an agent's [`model:`](./agent.md) field. Models have no file of their own — they are **inlined into agents**.

```yaml
provider: openai
model: gpt-5-mini
temperature: 0.7
max_tokens: 2048
```

## Fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `provider` | string | Yes | — | e.g. `openai`, `anthropic`, `openrouter`. |
| `model` | string | Yes | — | Model name; may contain `/` for gateway routing. |
| `temperature` | number | No | provider default | `0`–`2`. |
| `max_tokens` | integer | No | provider default | Positive integer. |

`provider` + `model` are joined into the Model Router string `"<provider>/<model>"`. `temperature` / `max_tokens` map to `modelSettings` (note `max_tokens` → `maxTokens`). API keys come from env vars (e.g. `OPENAI_API_KEY`), never YAML.

```text
provider: openrouter
model: anthropic/claude-3.5-haiku   →  "openrouter/anthropic/claude-3.5-haiku"
```

## Inlined into the referencing agent

```typescript
  model: 'openai/gpt-5-mini',
  modelSettings: { temperature: 0.7, maxTokens: 2048 },
```
