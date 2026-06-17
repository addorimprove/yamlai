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
  assert.ok(files['src/mastra/workflows/draft-flow.ts']);
  assert.ok(files['src/mastra/workflows/compare-drafts.ts']);
  // brief is a custom step now (typed execute) — copied to workflows/steps/ and
  // used directly (no createStep wrapper) in the draft-flow chain.
  assert.ok(files['src/mastra/workflows/steps/brief.ts']);
  assert.match(files['src/mastra/workflows/draft-flow.ts'], /import \{ brief \} from '\.\/steps\/brief';/);
  assert.match(files['src/mastra/workflows/draft-flow.ts'], /\.then\(brief\)/);
  assert.ok(files['src/mastra/tools/merge-drafts.ts']);
  assert.match(
    files['src/mastra/index.ts'],
    /workflows: \{ draftFlow, compareDrafts, polishLoop, reviseLoop \},/,
  );
  // writer-agent attaches compare-drafts, which runs writer-agent itself — an
  // agent⇄workflow cycle, so it is emitted lazily via mastra.getWorkflow keyed by
  // the registration (export) name, with the `mastra!` assertion the thunk requires.
  assert.match(
    files['src/mastra/agents/writer-agent.ts'],
    /workflows: \(\{ mastra \}\) => \(\{ compareDrafts: mastra!\.getWorkflow\("compareDrafts"\) \}\)/,
  );
});

test('the bundled loop examples emit dountil + a copied condition + a nested body', () => {
  const project = parseProject(examples);
  const files = generateProject(project, examples);
  // single-leaf loop
  assert.ok(files['src/mastra/workflows/polish-loop.ts']);
  assert.ok(files['src/mastra/workflows/steps/refine.ts'], 'body step copied');
  assert.ok(files['src/mastra/workflows/condition/good-enough.ts'], 'condition copied');
  assert.match(files['src/mastra/workflows/polish-loop.ts'], /import \{ goodEnough \} from '\.\/condition\/good-enough';/);
  assert.match(files['src/mastra/workflows/polish-loop.ts'], /\.dountil\(refine, async \(args\) => \(await goodEnough\(args\)\) \|\| args\.iterationCount >= 5\)/);
  // multi-step loop -> inline nested workflow
  assert.ok(files['src/mastra/workflows/revise-loop.ts']);
  assert.ok(files['src/mastra/workflows/steps/score.ts'], 'second body step copied');
  assert.match(files['src/mastra/workflows/revise-loop.ts'], /createWorkflow\(\{ id: "revise-loop-loop-1"/);
  assert.match(files['src/mastra/workflows/revise-loop.ts'], /\.then\(refine\)/);
  assert.match(files['src/mastra/workflows/revise-loop.ts'], /\.then\(score\)/);
});
