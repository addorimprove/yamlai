// builder/test/emit-workflow.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitWorkflow } from '../src/codegen/emit-workflow.js';
import type { ResolvedWorkflow } from '../src/types.js';

const SEQ: ResolvedWorkflow = {
  id: 'research-flow',
  description: '',
  exportName: 'researchFlow',
  inputZod: 'z.object({ prompt: z.string() })',
  outputZod: 'z.object({ text: z.string() })',
  steps: [
    { kind: 'agent', ref: { kind: 'agent', id: 'research-agent', exportName: 'researchAgent' } },
    { kind: 'tool', ref: { kind: 'tool', id: 'rephrase', exportName: 'rephrase' } },
    { kind: 'agent', ref: { kind: 'agent', id: 'support-agent', exportName: 'supportAgent' } },
  ],
  agents: [
    { id: 'research-agent', exportName: 'researchAgent' },
    { id: 'support-agent', exportName: 'supportAgent' },
  ],
  tools: [{ id: 'rephrase', filePath: 'tools/rephrase.ts', exportName: 'rephrase' }],
  stepFiles: [],
  conditionFiles: [],
};

test('emits imports, createWorkflow, sequential .then chain, and .commit', () => {
  const out = emitWorkflow(SEQ);
  assert.match(out, /import \{ createWorkflow, createStep \} from '@mastra\/core\/workflows';/);
  assert.match(out, /import \{ z \} from 'zod';/);
  assert.match(out, /import \{ researchAgent \} from '\.\.\/agents\/research-agent';/);
  assert.match(out, /import \{ rephrase \} from '\.\.\/tools\/rephrase';/);
  assert.match(out, /export const researchFlow = createWorkflow\(\{/);
  assert.match(out, /id: "research-flow",/);
  assert.match(out, /inputSchema: z\.object\(\{ prompt: z\.string\(\) \}\),/);
  assert.match(out, /\.then\(createStep\(researchAgent\)\)/);
  assert.match(out, /\.then\(createStep\(rephrase\)\)/);
  assert.match(out, /\.commit\(\);/);
});

test('emits a .parallel block for a parallel step', () => {
  const out = emitWorkflow({
    ...SEQ,
    id: 'compare-answers',
    exportName: 'compareAnswers',
    steps: [
      {
        kind: 'parallel',
        children: [
          { kind: 'agent', id: 'research-agent', exportName: 'researchAgent' },
          { kind: 'agent', id: 'support-agent', exportName: 'supportAgent' },
        ],
      },
      { kind: 'tool', ref: { kind: 'tool', id: 'merge-answers', exportName: 'mergeAnswers' } },
    ],
    tools: [{ id: 'merge-answers', filePath: 'tools/merge-answers.ts', exportName: 'mergeAnswers' }],
  });
  assert.match(out, /\.parallel\(\[createStep\(researchAgent\), createStep\(supportAgent\)\]\)/);
  assert.match(out, /\.then\(createStep\(mergeAnswers\)\)/);
});

test('emits description when present', () => {
  const out = emitWorkflow({ ...SEQ, description: 'Research a question, then answer.' });
  assert.match(out, /description: "Research a question, then answer\.",/);
});

test('omits description when empty', () => {
  const out = emitWorkflow({ ...SEQ, description: '' });
  assert.doesNotMatch(out, /description:/);
});

test('imports steps from ./steps and uses them without createStep', () => {
  const out = emitWorkflow({
    ...SEQ,
    steps: [
      { kind: 'agent', ref: { kind: 'agent', id: 'research-agent', exportName: 'researchAgent' } },
      { kind: 'step', ref: { kind: 'step', id: 'rephrase', exportName: 'rephrase' } },
    ],
    stepFiles: [{ id: 'rephrase', filePath: 'workflow/steps/rephrase.ts', exportName: 'rephrase' }],
    tools: [],
  });
  assert.match(out, /import \{ rephrase \} from '\.\/steps\/rephrase';/);
  assert.match(out, /\.then\(createStep\(researchAgent\)\)/); // agent still wrapped
  assert.match(out, /\.then\(rephrase\)/); // step used directly
  assert.doesNotMatch(out, /createStep\(rephrase\)/); // step NOT wrapped
});

test('emits .dountil with a single-leaf body, imported condition, and max_iterations wrapper', () => {
  const out = emitWorkflow({
    ...SEQ,
    steps: [{ kind: 'loop', loop: {
      loopKind: 'dountil',
      body: { kind: 'leaf', ref: { kind: 'agent', id: 'support-agent', exportName: 'supportAgent' } },
      condition: { id: 'good-enough', filePath: 'workflow/condition/good-enough.ts', exportName: 'goodEnough' },
      maxIterations: 5,
    } }],
    agents: [{ id: 'support-agent', exportName: 'supportAgent' }], tools: [], stepFiles: [],
    conditionFiles: [{ id: 'good-enough', filePath: 'workflow/condition/good-enough.ts', exportName: 'goodEnough' }],
  });
  assert.match(out, /import \{ goodEnough \} from '\.\/condition\/good-enough';/);
  assert.match(out, /\.dountil\(createStep\(supportAgent\), async \(args\) => \(await goodEnough\(args\)\) \|\| args\.iterationCount >= 5\)/);
});

test('emits .dowhile with a bare condition (no max_iterations)', () => {
  const out = emitWorkflow({
    ...SEQ,
    steps: [{ kind: 'loop', loop: {
      loopKind: 'dowhile',
      body: { kind: 'leaf', ref: { kind: 'step', id: 'refiner', exportName: 'refiner' } },
      condition: { id: 'keep', filePath: 'workflow/condition/keep.ts', exportName: 'keep' },
    } }],
    agents: [], tools: [],
    stepFiles: [{ id: 'refiner', filePath: 'workflow/steps/refiner.ts', exportName: 'refiner' }],
    conditionFiles: [{ id: 'keep', filePath: 'workflow/condition/keep.ts', exportName: 'keep' }],
  });
  assert.match(out, /\.dowhile\(refiner, keep\)/);
});

test('emits .foreach with concurrency and no condition import', () => {
  const out = emitWorkflow({
    ...SEQ,
    steps: [{ kind: 'loop', loop: {
      loopKind: 'foreach',
      body: { kind: 'leaf', ref: { kind: 'step', id: 'process', exportName: 'process' } },
      concurrency: 3,
    } }],
    agents: [], tools: [],
    stepFiles: [{ id: 'process', filePath: 'workflow/steps/process.ts', exportName: 'process' }],
    conditionFiles: [],
  });
  assert.match(out, /\.foreach\(process, \{ concurrency: 3 \}\)/);
  assert.doesNotMatch(out, /\.\/condition\//);
});

test('emits a multi-step loop body as an inline nested workflow', () => {
  const out = emitWorkflow({
    ...SEQ,
    steps: [{ kind: 'loop', loop: {
      loopKind: 'dountil',
      body: { kind: 'sequence', id: 'flow-loop-1',
        inputZod: 'z.object({ prompt: z.string() })', outputZod: 'z.object({ text: z.string() })',
        steps: [
          { kind: 'agent', id: 'research-agent', exportName: 'researchAgent' },
          { kind: 'step', id: 'refine', exportName: 'refine' },
        ] },
      maxIterations: 3,
    } }],
    agents: [{ id: 'research-agent', exportName: 'researchAgent' }], tools: [],
    stepFiles: [{ id: 'refine', filePath: 'workflow/steps/refine.ts', exportName: 'refine' }],
    conditionFiles: [],
  });
  assert.match(out, /createWorkflow\(\{ id: "flow-loop-1", inputSchema: z\.object\(\{ prompt: z\.string\(\) \}\), outputSchema: z\.object\(\{ text: z\.string\(\) \}\) \}\)/);
  assert.match(out, /\.then\(createStep\(researchAgent\)\)/);
  assert.match(out, /\.then\(refine\)/);
  assert.match(out, /\.commit\(\),\s*async \(args\) => args\.iterationCount >= 3\)/);
});
