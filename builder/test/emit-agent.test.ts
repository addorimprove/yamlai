import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitAgent } from '../src/codegen/emit-agent.js';
import type { ResolvedAgent } from '../src/types.js';

const BASE: ResolvedAgent = {
  id: 'a',
  name: 'A',
  description: '',
  instructions: 'hi',
  model: { id: 'm', provider: 'openai', model: 'gpt-5-mini', routerString: 'openai/gpt-5-mini' },
  tools: [],
  subAgents: [],
  memory: false,
};

test('emits a plain model string when no model settings', () => {
  const out = emitAgent(BASE);
  assert.match(out, /^\s*model: "openai\/gpt-5-mini",$/m);
  assert.doesNotMatch(out, /modelSettings/);
});

test('emits model as fallback-array entry with modelSettings when temperature/max set', () => {
  const out = emitAgent({
    ...BASE,
    model: { ...BASE.model, temperature: 0.7, maxTokens: 2048 },
  });
  assert.match(
    out,
    /model: \[\{ model: "openai\/gpt-5-mini", modelSettings: \{ temperature: 0\.7, maxOutputTokens: 2048 \} \}\],/,
  );
  // No top-level modelSettings field and no maxTokens key.
  assert.doesNotMatch(out, /^\s*modelSettings:/m);
  assert.doesNotMatch(out, /maxTokens/);
});

test('emits only temperature when max_tokens absent', () => {
  const out = emitAgent({ ...BASE, model: { ...BASE.model, temperature: 0.2 } });
  assert.match(out, /model: \[\{ model: "openai\/gpt-5-mini", modelSettings: \{ temperature: 0\.2 \} \}\],/);
});

test('emits a sub-agent import and agents field', () => {
  const out = emitAgent({
    ...BASE,
    subAgents: [{ id: 'research-agent', exportName: 'researchAgent' }],
  });
  assert.match(out, /import \{ researchAgent \} from '\.\/research-agent';/);
  assert.match(out, /^\s*agents: \{ researchAgent \},$/m);
});

test('omits the agents field when there are no sub-agents', () => {
  const out = emitAgent(BASE);
  assert.doesNotMatch(out, /^\s*agents: \{/m);
});

test('dedupes repeated sub-agent references', () => {
  const out = emitAgent({
    ...BASE,
    subAgents: [
      { id: 'research-agent', exportName: 'researchAgent' },
      { id: 'research-agent', exportName: 'researchAgent' },
    ],
  });
  const imports = out.match(/from '\.\/research-agent'/g) ?? [];
  assert.equal(imports.length, 1);
  assert.match(out, /agents: \{ researchAgent \},/);
});
