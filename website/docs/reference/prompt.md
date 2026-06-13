---
title: "prompt/<id>.md"
---

# prompt/&lt;id&gt;.md

A plain Markdown file — the entire content is an agent's system instructions. The id is the filename (`prompt/support-prompt.md` → id `support-prompt`). Selected by an agent's [`instructions:`](./agent.md) field.

```md
You are a helpful support assistant. Be concise and accurate.
Use the echo-tool when you need to repeat the user's input back to them.
```

No fields, no frontmatter — write the instructions exactly as the model should receive them.

## Inlined into the referencing agent

No `.md` file is emitted. The content is inlined verbatim as an escaped template literal:

```typescript
  instructions: `You are a helpful support assistant. Be concise and accurate.
Use the echo-tool when you need to repeat the user's input back to them.`,
```
