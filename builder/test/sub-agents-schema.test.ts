import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSchema } from '../src/schemas.js';

test('AgentSchema defaults agents to an empty array', () => {
  const parsed = AgentSchema.parse({ name: 'A', instructions: 'p', model: 'm' });
  assert.deepEqual(parsed.agents, []);
});

test('AgentSchema accepts a list of sub-agent ids', () => {
  const parsed = AgentSchema.parse({
    name: 'A',
    instructions: 'p',
    model: 'm',
    agents: ['research-agent', 'writer-agent'],
  });
  assert.deepEqual(parsed.agents, ['research-agent', 'writer-agent']);
});

test('AgentSchema rejects a non-string sub-agent id', () => {
  assert.throws(() => AgentSchema.parse({ name: 'A', instructions: 'p', model: 'm', agents: [3] }));
});
