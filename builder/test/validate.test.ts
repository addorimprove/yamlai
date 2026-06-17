// builder/test/validate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runValidate } from '../scripts/validate.js';

// examples/ lives at the repo root (builder/../examples).
const EXAMPLES = fileURLToPath(new URL('../../examples', import.meta.url));
// Builder package root (parent of test/), so execFileSync resolves scripts/ regardless of cwd.
const BUILDER_ROOT = fileURLToPath(new URL('..', import.meta.url));

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'yamlai-validate-'));
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  return dir;
}

test('runValidate returns code 0 + summary for the example project', () => {
  const r = runValidate(EXAMPLES);
  assert.equal(r.code, 0);
  assert.match(r.stdout ?? '', /^✓ valid: \d+ agents, \d+ workflows$/);
  assert.equal(r.stderr, undefined);
});

test('runValidate --json returns ok:true with empty issues on success', () => {
  const r = runValidate(EXAMPLES, { json: true });
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout ?? ''), { ok: true, issues: [] });
});

test('runValidate returns code 1 + stderr for an invalid project', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a]\nagnets: [typo]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\n',
    'prompt/p.md': 'hi\n',
    'model/m.yaml': 'provider: openai\nmodel: gpt-5-mini\n',
  });
  const r = runValidate(dir);
  assert.equal(r.code, 1);
  assert.match(r.stderr ?? '', /problem/i);
  assert.equal(r.stdout, undefined);
});

test('runValidate --json returns ok:false with issues for an invalid project', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a]\nagnets: [typo]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\n',
    'prompt/p.md': 'hi\n',
    'model/m.yaml': 'provider: openai\nmodel: gpt-5-mini\n',
  });
  const r = runValidate(dir, { json: true });
  assert.equal(r.code, 1);
  const parsed = JSON.parse(r.stdout ?? '');
  assert.equal(parsed.ok, false);
  assert.ok(Array.isArray(parsed.issues) && parsed.issues.length >= 1);
  assert.ok(parsed.issues[0].file && parsed.issues[0].message);
});

// NOTE: a missing directory triggers a ParseError (code 1) because parseProject
// treats a missing config.yaml as a parse failure. To get code 2 (unexpected error)
// we pass null which causes a Node.js TypeError before any parsing occurs.
test('runValidate returns code 2 for an unexpected (non-ParseError) failure', () => {
  const r = runValidate(null as any);
  assert.equal(r.code, 2);
  assert.ok((r.stderr ?? '').length > 0);
  assert.equal(r.stdout, undefined);
});

test('CLI: `validate <examples>` exits 0 and prints a summary', () => {
  const out = execFileSync(
    'node',
    ['--import', 'tsx', 'scripts/cli.ts', 'validate', EXAMPLES],
    { encoding: 'utf8', cwd: BUILDER_ROOT },
  );
  assert.match(out, /✓ valid:/);
});

test('CLI: `validate --json` on a broken project exits 1 with ok:false', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a]\nbogus: 1\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\n',
    'prompt/p.md': 'hi\n',
    'model/m.yaml': 'provider: openai\nmodel: gpt-5-mini\n',
  });
  let code = 0;
  let stdout = '';
  try {
    stdout = execFileSync(
      'node',
      ['--import', 'tsx', 'scripts/cli.ts', 'validate', dir, '--json'],
      { encoding: 'utf8', cwd: BUILDER_ROOT },
    );
  } catch (e: any) {
    code = e.status;
    stdout = e.stdout;
  }
  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout).ok, false);
});
