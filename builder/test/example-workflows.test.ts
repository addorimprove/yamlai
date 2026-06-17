// builder/test/example-workflows.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseProject } from '../src/parser.js';
import { generateProject } from '../src/codegen/generate.js';

const examples = resolve(dirname(fileURLToPath(import.meta.url)), '../../examples');

test('the bundled examples generate workflow files + register them', () => {
  const project = parseProject(examples);
  const files = generateProject(project, examples);
  assert.ok(files['src/mastra/workflows/research-flow.ts']);
  assert.ok(files['src/mastra/workflows/compare-answers.ts']);
  assert.ok(files['src/mastra/tools/rephrase.ts']);
  assert.ok(files['src/mastra/tools/merge-answers.ts']);
  assert.match(files['src/mastra/index.ts'], /workflows: \{ researchFlow, compareAnswers \},/);
  // support-agent attaches compare-answers, which runs support-agent itself — an
  // agent⇄workflow cycle, so it is emitted lazily via mastra.getWorkflow keyed by
  // the registration (export) name, with the `mastra!` assertion the thunk requires.
  assert.match(
    files['src/mastra/agents/support-agent.ts'],
    /workflows: \(\{ mastra \}\) => \(\{ compareAnswers: mastra!\.getWorkflow\("compareAnswers"\) \}\)/,
  );
});
