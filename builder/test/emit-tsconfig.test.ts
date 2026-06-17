// builder/test/emit-tsconfig.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitTsconfig } from '../src/codegen/emit-project-files.js';

test('generated tsconfig keeps strict but disables strictFunctionTypes', () => {
  const cfg = JSON.parse(emitTsconfig());
  // strict stays on for everything except function-param contravariance, which
  // would otherwise reject Mastra's `createStep(agent)` in every `.then()` chain.
  assert.equal(cfg.compilerOptions.strict, true);
  assert.equal(cfg.compilerOptions.strictFunctionTypes, false);
});
