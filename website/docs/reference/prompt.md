---
title: "prompt/<id>.md"
---

# prompt/&lt;id&gt;.md

A plain Markdown file — the entire content is an agent's system instructions. The id is the filename (`prompt/writer-prompt.md` → id `writer-prompt`). Selected by an agent's [`instructions:`](./agent.md) field.

```md
You are a writing assistant. Given a topic or brief, produce a clear, well-structured
draft. Use the word-count tool to check the draft against the target length.
```

No fields, no frontmatter — write the instructions exactly as the model should receive them.

## Inlined into the referencing agent

No `.md` file is emitted. The content is inlined verbatim as an escaped template literal:

```typescript
  instructions: `You are a writing assistant. Given a topic or brief, produce a clear, well-structured
draft. Use the word-count tool to check the draft against the target length.`,
```
