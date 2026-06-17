// builder/test/workflows-schema.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowSchema, ConfigSchema } from '../src/schemas.js';

test('ConfigSchema defaults workflows to an empty array', () => {
  const cfg = ConfigSchema.parse({ name: 'x', agents: ['a'] });
  assert.deepEqual(cfg.workflows, []);
});

test('WorkflowSchema accepts agent/tool/parallel steps and defaults description/io', () => {
  const wf = WorkflowSchema.parse({
    input: { prompt: 'string' },
    output: { text: 'string' },
    steps: [
      { agent: 'research-agent' },
      { tool: 'rephrase' },
      { parallel: [{ agent: 'research-agent' }, { agent: 'support-agent' }] },
    ],
  });
  assert.equal(wf.description, '');
  assert.deepEqual(wf.input, { prompt: 'string' });
  assert.equal(wf.steps.length, 3);
});

test('WorkflowSchema requires at least one step but not a name', () => {
  assert.equal(WorkflowSchema.safeParse({ steps: [] }).success, false);
  // name is no longer part of the schema — a workflow without one parses fine.
  assert.equal(WorkflowSchema.safeParse({ steps: [{ agent: 'a' }] }).success, true);
});

test('WorkflowSchema defaults input/output to empty objects', () => {
  const wf = WorkflowSchema.parse({ steps: [{ agent: 'a' }] });
  assert.deepEqual(wf.input, {});
  assert.deepEqual(wf.output, {});
});

test('WorkflowSchema accepts a step leaf (plain and parallel child)', () => {
  const wf = WorkflowSchema.parse({
    steps: [
      { step: 'rephrase' },
      { parallel: [{ step: 'a' }, { tool: 'b' }] },
    ],
  });
  assert.equal(wf.steps.length, 2);
  // `step` must survive parsing (not be stripped as an unknown key).
  assert.equal(wf.steps[0].step, 'rephrase');
  assert.equal(wf.steps[1].parallel?.[0].step, 'a');
});
