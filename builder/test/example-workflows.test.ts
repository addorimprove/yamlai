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
  // rephrase is a custom step now (typed execute) — copied to workflows/steps/ and
  // used directly (no createStep wrapper) in the research-flow chain.
  assert.ok(files['src/mastra/workflows/steps/rephrase.ts']);
  assert.match(files['src/mastra/workflows/research-flow.ts'], /import \{ rephrase \} from '\.\/steps\/rephrase';/);
  assert.match(files['src/mastra/workflows/research-flow.ts'], /\.then\(rephrase\)/);
  assert.ok(files['src/mastra/tools/merge-answers.ts']);
  assert.match(
    files['src/mastra/index.ts'],
    /workflows: \{ researchFlow, compareAnswers, refineLoop, draftLoop \},/,
  );
  // support-agent attaches compare-answers, which runs support-agent itself — an
  // agent⇄workflow cycle, so it is emitted lazily via mastra.getWorkflow keyed by
  // the registration (export) name, with the `mastra!` assertion the thunk requires.
  assert.match(
    files['src/mastra/agents/support-agent.ts'],
    /workflows: \(\{ mastra \}\) => \(\{ compareAnswers: mastra!\.getWorkflow\("compareAnswers"\) \}\)/,
  );
});

test('the bundled loop examples emit dountil + a copied condition + a nested body', () => {
  const project = parseProject(examples);
  const files = generateProject(project, examples);
  // single-leaf loop
  assert.ok(files['src/mastra/workflows/refine-loop.ts']);
  assert.ok(files['src/mastra/workflows/steps/refine.ts'], 'body step copied');
  assert.ok(files['src/mastra/workflows/condition/good-enough.ts'], 'condition copied');
  assert.match(files['src/mastra/workflows/refine-loop.ts'], /import \{ goodEnough \} from '\.\/condition\/good-enough';/);
  assert.match(files['src/mastra/workflows/refine-loop.ts'], /\.dountil\(refine, async \(args\) => \(await goodEnough\(args\)\) \|\| args\.iterationCount >= 5\)/);
  // multi-step loop -> inline nested workflow
  assert.ok(files['src/mastra/workflows/draft-loop.ts']);
  assert.ok(files['src/mastra/workflows/steps/score.ts'], 'second body step copied');
  assert.match(files['src/mastra/workflows/draft-loop.ts'], /createWorkflow\(\{ id: "draft-loop-loop-1"/);
  assert.match(files['src/mastra/workflows/draft-loop.ts'], /\.then\(refine\)/);
  assert.match(files['src/mastra/workflows/draft-loop.ts'], /\.then\(score\)/);
});
