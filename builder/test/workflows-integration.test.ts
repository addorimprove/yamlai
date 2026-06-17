// builder/test/workflows-integration.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseProject } from '../src/parser.js';
import { generateProject } from '../src/codegen/generate.js';

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'yamlai-'));
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  return dir;
}

const TOOL = "import { createTool } from '@mastra/core/tools';\nexport const t = {};\n";

function project(): string {
  return makeProject({
    'config.yaml':
      'name: x\nagents: [research-agent, support-agent]\nworkflows: [compare-answers]\n',
    'agent/research-agent.yaml': 'name: R\ninstructions: p\nmodel: m\n',
    'agent/support-agent.yaml': 'name: S\ninstructions: p\nmodel: m\n',
    'prompt/p.md': 'hi\n',
    'model/m.yaml': 'provider: openai\nmodel: gpt-5-mini\n',
    'tools/merge-answers.ts': TOOL,
    'workflow/compare-answers.yaml':
      'name: Compare\ninput: { prompt: string }\noutput: { comparison: string }\n' +
      'steps:\n  - parallel:\n      - agent: research-agent\n      - agent: support-agent\n  - tool: merge-answers\n',
  });
}

test('emits the workflow file and registers it in index.ts', () => {
  const dir = project();
  const files = generateProject(parseProject(dir), dir);
  assert.ok(files['src/mastra/workflows/compare-answers.ts'], 'workflow file emitted');
  assert.match(files['src/mastra/index.ts'], /workflows: \{ compareAnswers \},/);
});

test('copies a workflow-only tool that no agent references', () => {
  const dir = project();
  const files = generateProject(parseProject(dir), dir);
  // merge-answers is referenced only by the workflow, never by an agent — must still be copied.
  assert.ok(files['src/mastra/tools/merge-answers.ts'], 'workflow-only tool copied');
});

test('copies a shared tool exactly once', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a]\nworkflows: [w]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\ntools: [shared]\n',
    'prompt/p.md': 'hi\n',
    'model/m.yaml': 'provider: openai\nmodel: gpt-5-mini\n',
    'tools/shared.ts': TOOL,
    'workflow/w.yaml': 'name: W\nsteps:\n  - agent: a\n  - tool: shared\n',
  });
  const files = generateProject(parseProject(dir), dir);
  assert.ok(files['src/mastra/tools/shared.ts']);
  // (No duplicate-key possibility in a FileMap; this asserts the dedupe path runs without error.)
});
