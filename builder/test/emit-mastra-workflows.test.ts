// builder/test/emit-mastra-workflows.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitIndex } from '../src/codegen/emit-mastra.js';
import type { ParsedProject } from '../src/types.js';

const BASE: ParsedProject = {
  name: 'x',
  logger: { level: 'info' },
  agents: [
    { id: 'support-agent', name: 'S', description: '', instructions: 'hi',
      model: { id: 'm', provider: 'openai', model: 'gpt-5-mini', routerString: 'openai/gpt-5-mini' },
      tools: [], subAgents: [], lazyAgents: false, workflows: [], lazyWorkflows: false, memory: false },
  ],
  workflows: [],
};

test('omits the workflows field when there are none', () => {
  assert.doesNotMatch(emitIndex(BASE), /workflows:/);
});

test('imports and registers workflows when present', () => {
  const out = emitIndex({
    ...BASE,
    workflows: [
      { id: 'research-flow', name: 'R', description: '', exportName: 'researchFlow',
        inputZod: 'z.object({})', outputZod: 'z.object({})', steps: [], agents: [], tools: [] },
    ],
  });
  assert.match(out, /import \{ researchFlow \} from '\.\/workflows\/research-flow';/);
  assert.match(out, /workflows: \{ researchFlow \},/);
});
