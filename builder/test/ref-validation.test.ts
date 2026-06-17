// builder/test/ref-validation.test.ts
// Guards that close the gap between `validate` (parse-time) and `tsc`:
//   1. an id must yield a legal, non-reserved JS identifier (export name)
//   2. a referenced tool/step/condition file must actually export that name
// Without these, both classes of input passed parsing but emitted uncompilable TS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseProject } from '../src/parser.js';
import { invalidExportIdReason } from '../src/naming.js';
import { sourceExportsName } from '../src/read.js';

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'yamlai-'));
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  return dir;
}

const MODEL = 'provider: openai\nmodel: gpt-5-mini\n';
const PROMPT = 'You are a test agent.\n';
const tool = (n: string) => `export const ${n} = {};\n`;

// --- unit: invalidExportIdReason ------------------------------------------------

test('invalidExportIdReason accepts ids that yield clean identifiers', () => {
  for (const id of ['echo-tool', 'support-agent', 'research_agent', 'a', 'flow2', '_x']) {
    assert.equal(invalidExportIdReason(id), null, id);
  }
});

test('invalidExportIdReason rejects a leading-digit identifier', () => {
  assert.match(invalidExportIdReason('2nd-flow')!, /not a valid JavaScript identifier/);
});

test('invalidExportIdReason rejects a separators-only id (empty export name)', () => {
  assert.match(invalidExportIdReason('--')!, /empty export name/);
});

test('invalidExportIdReason rejects a reserved word', () => {
  assert.match(invalidExportIdReason('delete')!, /reserved word/);
  assert.match(invalidExportIdReason('return')!, /reserved word/);
});

test('invalidExportIdReason rejects an id with a space', () => {
  assert.match(invalidExportIdReason('my flow')!, /not a valid JavaScript identifier/);
});

// --- unit: sourceExportsName ----------------------------------------------------

test('sourceExportsName recognises the common export forms', () => {
  assert.ok(sourceExportsName('export const refine = 1;', 'refine'));
  assert.ok(sourceExportsName('export function refine() {}', 'refine'));
  assert.ok(sourceExportsName('export async function refine() {}', 'refine'));
  assert.ok(sourceExportsName('export class Refine {}', 'Refine'));
  assert.ok(sourceExportsName('export { refine };', 'refine'));
  assert.ok(sourceExportsName('export { foo as refine };', 'refine'));
  assert.ok(sourceExportsName("export { refine } from './other';", 'refine'));
  assert.ok(sourceExportsName('const refine = 1;\nexport { refine, score };', 'score'));
});

test('sourceExportsName rejects an absent or merely-substring name', () => {
  assert.equal(sourceExportsName('export const refineStep = 1;', 'refine'), false);
  assert.equal(sourceExportsName('export const other = 1;', 'refine'), false);
  assert.equal(sourceExportsName('const refine = 1; // not exported', 'refine'), false);
});

// --- integration: export-name verified for referenced files ---------------------

function base(extra: Record<string, string>): string {
  return makeProject({
    'config.yaml': 'name: x\nagents: [a]\nworkflows: [w]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
    ...extra,
  });
}

test('rejects a step file that exists but does not export the expected name', () => {
  const dir = base({
    'workflow/steps/refine.ts': 'export const somethingElse = {};\n',
    'workflow/w.yaml': 'input: { t: string }\noutput: { t: string }\nsteps:\n  - step: refine\n',
  });
  assert.throws(() => parseProject(dir), /steps\/refine\.ts must export `refine`/);
});

test('rejects a workflow tool file with a mismatched export', () => {
  const dir = base({
    'tools/mytool.ts': 'export const wrongName = {};\n',
    'workflow/w.yaml': 'steps:\n  - agent: a\n  - tool: mytool\n',
  });
  assert.throws(() => parseProject(dir), /tools\/mytool\.ts must export `mytool`/);
});

test('rejects a condition file with a mismatched export', () => {
  const dir = base({
    'workflow/condition/good.ts': 'export const notGood = async () => true;\n',
    'workflow/w.yaml': 'steps:\n  - loop:\n      until: good\n      agent: a\n',
  });
  assert.throws(() => parseProject(dir), /condition\/good\.ts must export `good`/);
});

test('rejects an agent tool file with a mismatched export', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\ntools: [mytool]\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
    'tools/mytool.ts': 'export const nope = {};\n',
  });
  assert.throws(() => parseProject(dir), /tools\/mytool\.ts must export `mytool`/);
});

test('accepts referenced files whose export matches the camelCased id', () => {
  const dir = base({
    'tools/merge-answers.ts': tool('mergeAnswers'),
    'workflow/steps/refine.ts': tool('refine'),
    'workflow/w.yaml':
      'input: { t: string }\noutput: { t: string }\nsteps:\n  - step: refine\n  - tool: merge-answers\n',
  });
  const wf = parseProject(dir).workflows[0];
  assert.deepEqual(wf.stepFiles.map((s) => s.id), ['refine']);
  assert.deepEqual(wf.tools.map((t) => t.id), ['merge-answers']);
});

// --- integration: identifier-unsafe ids rejected --------------------------------

test('rejects a workflow id that yields an illegal identifier', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a]\nworkflows: ["2nd-flow"]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
    'workflow/2nd-flow.yaml': 'steps:\n  - agent: a\n',
  });
  assert.throws(() => parseProject(dir), /workflow id `2nd-flow` yields `2ndFlow`/);
});

test('rejects an agent id that yields a reserved word', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [delete]\n',
    'agent/delete.yaml': 'name: A\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  assert.throws(() => parseProject(dir), /agent id `delete` yields `delete`, which is a reserved word/);
});

test('rejects a separators-only workflow id (empty export name)', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a]\nworkflows: ["--"]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
    'workflow/--.yaml': 'steps:\n  - agent: a\n',
  });
  assert.throws(() => parseProject(dir), /workflow id `--` has no identifier characters/);
});

test('rejects a workflow tool id that yields an illegal identifier', () => {
  const dir = base({
    'tools/2nd.ts': 'export const x = {};\n',
    'workflow/w.yaml': 'steps:\n  - agent: a\n  - tool: 2nd\n',
  });
  assert.throws(() => parseProject(dir), /tool id `2nd` yields `2nd`, which is not a valid/);
});
