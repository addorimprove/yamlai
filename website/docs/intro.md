---
title: Introduction
slug: /intro
---

# YAMLAI

Write YAML, get a runnable [Mastra](https://mastra.ai) TypeScript agent project.

**1. Write YAML:**

```yaml
# agent/writer-agent.yaml
name: Writer
instructions: writer-prompt
model: gpt-5-mini
tools:
  - word-count
```

**2. Generate:**

```bash
npx @addorimprove/yamlai ./my-project
```

**3. Get plain Mastra code you own:**

```typescript
// src/mastra/agents/writer-agent.ts
export const writerAgent = new Agent({
  id: 'writer-agent',
  name: 'Writer',
  instructions: `You are a writing assistant...`,
  model: 'openai/gpt-5-mini',
  tools: { wordCount },
});
```

The YAML is input only. The generated project has no dependency on YAMLAI — run it with `mastra dev` like any hand-written Mastra app.

→ [Getting Started](./getting-started.md) · [YAML Reference](./reference/config.md) · [Examples](./examples.md)
