// builder/test/init.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../scripts/init.js';
import { parseProject } from '../src/index.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'yamlai-init-'));
}

test('runInit scaffolds a project that parseProject accepts (round-trip)', () => {
  const target = join(tempDir(), 'mastra-app');
  runInit([target]);
  const project = parseProject(target);
  assert.equal(project.agents.length, 2);
  assert.equal(project.workflows.length, 4);
});

test('runInit rewrites config name to the target basename', () => {
  const target = join(tempDir(), 'my-cool-app');
  runInit([target]);
  const config = readFileSync(join(target, 'config.yaml'), 'utf8');
  assert.match(config, /^name: my-cool-app$/m);
  assert.doesNotMatch(config, /my-mastra-app/);
});

test('runInit writes README.md and .env.example', () => {
  const target = join(tempDir(), 'app');
  runInit([target]);
  assert.ok(existsSync(join(target, 'README.md')));
  assert.ok(existsSync(join(target, '.env.example')));
  assert.match(readFileSync(join(target, '.env.example'), 'utf8'), /OPENAI_API_KEY=/);
});

test('runInit defaults the target dir to mastra-app', () => {
  const cwd = tempDir();
  const prev = process.cwd();
  process.chdir(cwd);
  try {
    runInit([]);
    assert.ok(existsSync(join(cwd, 'mastra-app', 'config.yaml')));
  } finally {
    process.chdir(prev);
  }
});

test('runInit refuses a non-empty target without --force, replaces with it', () => {
  const target = join(tempDir(), 'app');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'stale.txt'), 'old');

  assert.throws(() => runInit([target]), /non-empty/);

  runInit([target, '--force']);
  assert.ok(!existsSync(join(target, 'stale.txt')));
  assert.ok(existsSync(join(target, 'config.yaml')));
});
