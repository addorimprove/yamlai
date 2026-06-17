// builder/test/validate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runValidate } from '../scripts/validate.js';

// examples/ lives at the repo root (builder/../examples).
const EXAMPLES = fileURLToPath(new URL('../../examples', import.meta.url));

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
