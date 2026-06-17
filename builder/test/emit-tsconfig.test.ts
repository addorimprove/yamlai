// builder/test/emit-tsconfig.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitTsconfig } from '../src/codegen/emit-project-files.js';

test('generated tsconfig is fully strict (strictFunctionTypes not disabled)', () => {
  const cfg = JSON.parse(emitTsconfig());
  // Full strict, including strictFunctionTypes. @mastra/core >=1.43 types
  // `createStep(agent)`/`.then()` so agent-step chains compile under it, and
  // step-to-step IO mismatches are caught at build time (not just at runtime).
  assert.equal(cfg.compilerOptions.strict, true);
  assert.notEqual(cfg.compilerOptions.strictFunctionTypes, false);
});
