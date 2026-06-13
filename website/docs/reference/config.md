---
title: config.yaml
---

# config.yaml

The project root file — one per project.

```yaml
name: my-mastra-app
agents:
  - support-agent
  - research-agent
logger:
  level: info             # debug | info | warn | error
storage:
  type: libsql            # libsql only
  url: file:./mastra.db   # or ":memory:"
```

## Fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | Yes | — | `package.json` name + default output dir. |
| `agents` | string[] | Yes | — | Agent ids to register (≥1). Each → [agent/&lt;id&gt;.yaml](./agent.md). |
| `logger.level` | enum | No | `info` | `debug` \| `info` \| `warn` \| `error`. |
| `storage.type` | enum | If `storage` set | — | `libsql` only. |
| `storage.url` | string | If `storage` set | — | e.g. `file:./mastra.db`, `:memory:`. |

## Generates `src/mastra/index.ts`

```typescript
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { supportAgent } from './agents/support-agent';
import { researchAgent } from './agents/research-agent';

export const mastra = new Mastra({
  agents: { supportAgent, researchAgent },
  storage: new LibSQLStore({ id: 'mastra-storage', url: 'file:./mastra.db' }),
  logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
});
```

Only agents are registered. `storage` is omitted entirely if absent. Kebab-case ids → camelCase exports (`support-agent` → `supportAgent`).
