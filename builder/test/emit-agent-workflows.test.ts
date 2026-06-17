// builder/test/emit-agent-workflows.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitAgent } from '../src/codegen/emit-agent.js';
import type { ResolvedAgent } from '../src/types.js';

const BASE: ResolvedAgent = {
  id: 'worker', exportName: 'worker', name: 'W', description: '', instructions: 'hi',
  model: { id: 'm', provider: 'openai', model: 'gpt-5-mini', routerString: 'openai/gpt-5-mini' },
  tools: [], subAgents: [], lazyAgents: false, workflows: [], lazyWorkflows: false, memory: false,
};

test('omits the workflows field when none attached', () => {
  assert.doesNotMatch(emitAgent(BASE), /workflows/);
});

test('acyclic attachment: static import + object field', () => {
  const out = emitAgent({ ...BASE, workflows: [{ id: 'research-flow', exportName: 'researchFlow' }] });
  assert.match(out, /import \{ researchFlow \} from '\.\.\/workflows\/research-flow';/);
  assert.match(out, /^\s*workflows: \{ researchFlow \},$/m);
});

test('cyclic attachment: no import, mastra.getWorkflow thunk keyed by export name', () => {
  const out = emitAgent({
    ...BASE,
    workflows: [{ id: 'loop-flow', exportName: 'loopFlow' }],
    lazyWorkflows: true,
  });
  assert.doesNotMatch(out, /import \{ loopFlow \} from/);
  assert.match(out, /workflows: \(\{ mastra \}\) => \(\{ loopFlow: mastra!\.getWorkflow\("loopFlow"\) \}\),/);
});
