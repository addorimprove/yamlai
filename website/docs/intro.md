---
title: Introduction
slug: /intro
---

# YAMLAI

Write YAML, get a runnable [Mastra](https://mastra.ai) TypeScript agent project.

**1. Write YAML:**

```yaml
# agent/support-agent.yaml
name: Support Agent
instructions: support-prompt
model: gpt-5-mini
tools:
  - echo-tool
```

**2. Generate:**

```bash
npx @addorimprove/yamlai ./my-project
```

**3. Get plain Mastra code you own:**

```typescript
// src/mastra/agents/support-agent.ts
export const supportAgent = new Agent({
  id: 'support-agent',
  name: 'Support Agent',
  instructions: `You are a helpful support assistant...`,
  model: 'openai/gpt-5-mini',
  tools: { echoTool },
});
```

The YAML is input only. The generated project has no dependency on YAMLAI — run it with `mastra dev` like any hand-written Mastra app.

→ [Getting Started](./getting-started.md) · [YAML Reference](./reference/config.md) · [Examples](./examples.md)
