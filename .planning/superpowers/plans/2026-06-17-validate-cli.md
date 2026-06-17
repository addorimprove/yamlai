# `validate` CLI Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a parse-only `yamlai validate <dir> [--json]` CLI command and make all Zod schemas strict so typo'd/unknown keys are caught instead of silently stripped.

**Architecture:** Strict schemas turn unknown keys into `unrecognized_keys` Zod issues, which the existing `formatZodError` helper already folds into the aggregated `ParseError` — no parser changes. A new `scripts/cli.ts` dispatcher routes `validate`/`generate` subcommands (bare `yamlai <dir>` still means generate). `runValidate` is a pure, unit-testable function returning `{ code, stdout?, stderr? }`; `cli.ts` prints and sets the exit code.

**Tech Stack:** TypeScript (ESM, NodeNext), Zod v4.4.3, `node:test` + `node:assert/strict`, tsx. All commands run from `builder/`.

**Working directory for every command below:** `/Users/rajan/Documents/GitHub/mastra-units/builder`

---

## File Structure

- **Modify** `src/schemas.ts` — append `.strict()` to every fixed-shape object schema.
- **Create** `test/schemas-strict.test.ts` — unknown-key rejection per schema.
- **Modify** `test/workflows-parser.test.ts`, `test/agent-workflows-parser.test.ts`, `test/workflows-integration.test.ts` — drop the `name:` line from workflow yaml fixtures (now an invalid key).
- **Modify** `test/workflows-schema.test.ts` — flip the "name ignored" comment; assert `name` is now rejected.
- **Modify** `scripts/generate.ts` — convert top-level script body into exported `runGenerate(argv)`.
- **Create** `scripts/validate.ts` — `runValidate(root, opts): ValidateResult`.
- **Create** `scripts/cli.ts` — shebang dispatcher (the new published `bin`).
- **Create** `test/validate.test.ts` — `runValidate` unit tests + a CLI subprocess smoke test.
- **Modify** `package.json` — `bin.yamlai` → `dist/scripts/cli.js`; add `validate` script; repoint `gen` script.
- **Modify** `../website/docs/cli.md` — document `validate`, `--json`, exit codes.

---

## Task 1: Make all schemas strict (+ fix affected fixtures)

**Files:**
- Create: `test/schemas-strict.test.ts`
- Modify: `src/schemas.ts`
- Modify: `test/workflows-parser.test.ts`, `test/agent-workflows-parser.test.ts`, `test/workflows-integration.test.ts`, `test/workflows-schema.test.ts`

- [ ] **Step 1: Write the failing strict tests**

Create `test/schemas-strict.test.ts`:

```ts
// builder/test/schemas-strict.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfigSchema,
  AgentSchema,
  ModelSchema,
  WorkflowSchema,
  MemorySchema,
} from '../src/schemas.js';

function unknownKeyIssue(result: { success: boolean; error?: any }): boolean {
  return (
    result.success === false &&
    result.error.issues.some((i: any) => i.code === 'unrecognized_keys')
  );
}

test('ConfigSchema rejects an unknown top-level key', () => {
  const r = ConfigSchema.safeParse({ name: 'x', agents: ['a'], agnets: ['typo'] });
  assert.ok(unknownKeyIssue(r), 'expected unrecognized_keys issue');
});

test('AgentSchema rejects an unknown key', () => {
  const r = AgentSchema.safeParse({
    name: 'A',
    instructions: 'p',
    model: 'm',
    instuctions: 'typo',
  });
  assert.ok(unknownKeyIssue(r));
});

test('ModelSchema rejects an unknown key', () => {
  const r = ModelSchema.safeParse({ provider: 'openai', model: 'gpt', temprature: 1 });
  assert.ok(unknownKeyIssue(r));
});

test('WorkflowSchema rejects a stray `name` key', () => {
  const r = WorkflowSchema.safeParse({ name: 'W', steps: [{ agent: 'a' }] });
  assert.ok(unknownKeyIssue(r));
});

test('WorkflowSchema rejects an unknown key inside a step', () => {
  const r = WorkflowSchema.safeParse({ steps: [{ agent: 'a', tul: 'typo' }] });
  assert.ok(unknownKeyIssue(r));
});

test('MemorySchema rejects an unknown key (strict through preprocess)', () => {
  const r = MemorySchema.safeParse({ last_messages: 5, last_mesages: 9 });
  assert.ok(unknownKeyIssue(r));
});
```

- [ ] **Step 2: Run the strict tests — verify they FAIL**

Run: `node --import tsx --test test/schemas-strict.test.ts`
Expected: FAIL — unknown keys are currently stripped, so `success` is `true` and no `unrecognized_keys` issue appears.

- [ ] **Step 3: Add `.strict()` to every fixed-shape object schema**

Edit `src/schemas.ts`. Apply `.strict()` to: `SemanticRecallSchema`, the inner objects of `WorkingMemorySchema` and `MemorySchema` (inside `z.preprocess`), `ConfigSchema` and its inline `logger`/`storage` objects, `AgentSchema`, `ModelSchema`, `WorkflowLeafSchema`, `LoopSchema`, `WorkflowStepSchema`, `WorkflowSchema`. Do **NOT** touch the `input`/`output` `z.record(...)` maps — they stay open.

The resulting file:

```ts
import { z } from 'zod';

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

export const ScopeSchema = z.enum(['thread', 'resource']);

const MessageRangeSchema = z.union([
  z.number().int().positive(),
  z.object({
    before: z.number().int().min(0),
    after: z.number().int().min(0),
  }).strict(),
]);

const SemanticRecallSchema = z.object({
  embedder: z.string().min(1),
  top_k: z.number().int().positive().default(4),
  message_range: MessageRangeSchema.default({ before: 1, after: 1 }),
  scope: ScopeSchema.optional(),
}).strict();

const WorkingMemorySchema = z.preprocess(
  (v) => (v === null ? {} : v),
  z.object({
    template: z.string().min(1).optional(),
    scope: ScopeSchema.optional(),
  }).strict(),
);

export const MemorySchema = z.preprocess(
  (v) => (v === null ? {} : v),
  z.object({
    last_messages: z.number().int().positive().optional(),
    semantic_recall: SemanticRecallSchema.optional(),
    working_memory: WorkingMemorySchema.optional(),
  }).strict(),
);

export const ConfigSchema = z.object({
  name: z.string().min(1),
  agents: z.array(z.string().min(1)).min(1),
  workflows: z.array(z.string().min(1)).default([]),
  logger: z
    .object({ level: LogLevelSchema.default('info') })
    .strict()
    .default({ level: 'info' }),
  storage: z
    .object({
      type: z.literal('libsql'),
      url: z.string().min(1),
    })
    .strict()
    .optional(),
  memory: MemorySchema.optional(),
}).strict();

export const AgentSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  instructions: z.string().min(1),
  model: z.string().min(1),
  tools: z.array(z.string().min(1)).default([]),
  agents: z.array(z.string().min(1)).default([]),
  workflows: z.array(z.string().min(1)).default([]),
  memory: z.boolean().default(false),
}).strict();

export const ModelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
}).strict();

const WorkflowLeafSchema = z.object({
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
}).strict();

const LoopSchema = z.object({
  until: z.string().min(1).optional(),
  while: z.string().min(1).optional(),
  foreach: z.boolean().optional(),
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
  steps: z.array(WorkflowLeafSchema).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  max_iterations: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().optional(),
}).strict();

const WorkflowStepSchema = z.object({
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
  parallel: z.array(WorkflowLeafSchema).optional(),
  loop: LoopSchema.optional(),
}).strict();

export const WorkflowSchema = z.object({
  description: z.string().default(''),
  input: z.record(z.string(), z.unknown()).default({}),
  output: z.record(z.string(), z.unknown()).default({}),
  steps: z.array(WorkflowStepSchema).min(1),
}).strict();

export type ConfigInput = z.infer<typeof ConfigSchema>;
export type AgentInput = z.infer<typeof AgentSchema>;
export type ModelInput = z.infer<typeof ModelSchema>;
export type MemoryInput = z.infer<typeof MemorySchema>;
export type WorkflowInput = z.infer<typeof WorkflowSchema>;
```

> Note: the comment block above `WorkflowSchema` (`// No \`name\`...`) can stay or be trimmed; it is no longer load-bearing because `name` is now rejected outright.

- [ ] **Step 4: Run the strict tests — verify they PASS**

Run: `node --import tsx --test test/schemas-strict.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite — observe the fixture regressions**

Run: `npm test`
Expected: FAIL in `test/workflows-parser.test.ts`, `test/agent-workflows-parser.test.ts`, `test/workflows-integration.test.ts` — workflow fixtures contain `name:`, now an unrecognized key. (This is expected; fixed next.)

- [ ] **Step 6: Remove `name:` from workflow yaml fixtures**

In each file below, delete the leading `name: ...\n` from every **workflow** yaml fixture string (leave agent/config/model fixtures untouched). Exact edits:

`test/workflows-parser.test.ts`:
- Line ~41: `'name: Research Flow\ninput: { prompt: string }\noutput: { text: string }\n'` → `'input: { prompt: string }\noutput: { text: string }\n'`
- Line ~58: `'name: Compare\ninput: { prompt: string }\noutput: { comparison: string }\n'` → `'input: { prompt: string }\noutput: { comparison: string }\n'`
- Lines ~75, 83, 91, 99, 118: replace the `'name: B\n` prefix with `'` (e.g. `'name: B\nsteps:\n  - agent: nobody\n'` → `'steps:\n  - agent: nobody\n'`; for the `input: { when: date }` one, `'name: B\ninput: { when: date }\nsteps:...` → `'input: { when: date }\nsteps:...`).
- Line ~129: `'name: W\nsteps:\n  - agent: research-agent\n'` → `'steps:\n  - agent: research-agent\n'`

`test/agent-workflows-parser.test.ts`:
- Lines ~31, 44: `'name: F\nsteps:\n  - agent: support-agent\n'` (and `- agent: worker`) → drop `name: F\n`.
- Line ~67: `'name: F\nsteps:\n  - agent: support-agent\n'` (loop-flow) → drop `name: F\n`.

`test/workflows-integration.test.ts`:
- Line ~32: `'name: Compare\ninput: { prompt: string }\noutput: { comparison: string }\n'` → drop `name: Compare\n`.
- Line ~58: `'name: W\nsteps:\n  - agent: a\n  - tool: shared\n'` → drop `name: W\n`.

Verify none remain:

Run: `grep -rn "workflow/.*\.yaml'" test/ | grep "name:"`
Expected: no output.

- [ ] **Step 7: Update the workflow-schema name test**

In `test/workflows-schema.test.ts`, update the `'WorkflowSchema requires at least one step but not a name'` test. Replace its body comment and add a rejection assertion:

```ts
test('WorkflowSchema requires at least one step and rejects a stray name', () => {
  assert.equal(WorkflowSchema.safeParse({ steps: [] }).success, false);
  // a workflow without a name parses fine...
  assert.equal(WorkflowSchema.safeParse({ steps: [{ agent: 'a' }] }).success, true);
  // ...and a stray `name` is now an error (strict schema), not silently ignored.
  assert.equal(WorkflowSchema.safeParse({ name: 'x', steps: [{ agent: 'a' }] }).success, false);
});
```

- [ ] **Step 8: Run the full suite + examples — verify all green**

Run: `npm test`
Expected: PASS (all tests, 0 fail).

Run: `npm run parse:example && npm run gen:example`
Expected: both succeed (the `examples/` project has no stray keys).

- [ ] **Step 9: Commit**

```bash
git add src/schemas.ts test/schemas-strict.test.ts test/workflows-parser.test.ts test/agent-workflows-parser.test.ts test/workflows-integration.test.ts test/workflows-schema.test.ts
git commit -m "feat(validate): make all config schemas strict (reject unknown keys)"
```

---

## Task 2: Extract `runGenerate` and add the CLI dispatcher

**Files:**
- Modify: `scripts/generate.ts`
- Create: `scripts/cli.ts`

- [ ] **Step 1: Convert `generate.ts` into an exported function**

Replace the entire contents of `scripts/generate.ts` with:

```ts
import { resolve } from 'node:path';
import { generateProject, parseProject, writeProject } from '../src/index.js';

// Generate a Mastra project from a YAML Agent Builder project.
//   yamlai [generate] <input-dir> [output-dir] [--force]
// Paths resolve relative to the current working directory. output-dir defaults
// to ./<config.name>. The writer refuses to overwrite a non-empty directory it
// didn't generate unless --force is passed.
export function runGenerate(argv: string[]): void {
  const force = argv.includes('--force');
  const [inputArg, outputArg] = argv.filter((a) => a !== '--force');

  if (!inputArg) {
    console.error('Usage: yamlai <input-dir> [output-dir] [--force]');
    process.exit(1);
  }

  const root = resolve(process.cwd(), inputArg);
  const project = parseProject(root);
  const outDir = outputArg
    ? resolve(process.cwd(), outputArg)
    : resolve(process.cwd(), project.name);

  const files = generateProject(project, root);
  writeProject(files, outDir, root, { force });
  console.log(`Generated ${Object.keys(files).length} files → ${outDir}`);
}
```

- [ ] **Step 2: Create the dispatcher `scripts/cli.ts`**

```ts
#!/usr/bin/env node
import { resolve } from 'node:path';
import { runGenerate } from './generate.js';
import { runValidate } from './validate.js';

// Subcommand dispatcher. `validate`/`generate` are explicit; a bare first arg
// (no recognised subcommand) is treated as the generate input dir (back-compat
// with the original `yamlai <input-dir> ...` interface).
const argv = process.argv.slice(2);
const [first, ...rest] = argv;

if (first === 'validate') {
  const json = rest.includes('--json');
  const inputArg = rest.find((a) => !a.startsWith('--'));
  if (!inputArg) {
    process.stderr.write('Usage: yamlai validate <input-dir> [--json]\n');
    process.exit(1);
  }
  const result = runValidate(resolve(process.cwd(), inputArg), { json });
  if (result.stdout) process.stdout.write(result.stdout + '\n');
  if (result.stderr) process.stderr.write(result.stderr + '\n');
  process.exit(result.code);
}

// Explicit `generate` subcommand strips the keyword; otherwise pass argv through.
runGenerate(first === 'generate' ? rest : argv);
```

> `runValidate` is created in Task 3. This task will not typecheck/run until Task 3 lands; that is fine for subagent-driven execution (commit happens at the end of Task 3's verification). If executing strictly task-by-task, do Step 2 of this task together with Task 3 before committing.

- [ ] **Step 3: Commit (after Task 3 provides `runValidate`)**

```bash
git add scripts/generate.ts scripts/cli.ts
git commit -m "refactor(cli): extract runGenerate and add subcommand dispatcher"
```

---

## Task 3: Implement `runValidate`

**Files:**
- Create: `scripts/validate.ts`
- Create: `test/validate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/validate.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests — verify they FAIL**

Run: `node --import tsx --test test/validate.test.ts`
Expected: FAIL — `../scripts/validate.js` does not exist (import error).

- [ ] **Step 3: Implement `scripts/validate.ts`**

```ts
import { parseProject, ParseError } from '../src/index.js';

export interface ValidateResult {
  code: 0 | 1 | 2;
  stdout?: string;
  stderr?: string;
}

// Parse-only check: run parseProject and report problems without generating
// code. `root` must already be an absolute/resolved path.
export function runValidate(root: string, opts: { json?: boolean } = {}): ValidateResult {
  try {
    const project = parseProject(root);
    if (opts.json) {
      return { code: 0, stdout: JSON.stringify({ ok: true, issues: [] }) };
    }
    return {
      code: 0,
      stdout: `✓ valid: ${project.agents.length} agents, ${project.workflows.length} workflows`,
    };
  } catch (err) {
    if (err instanceof ParseError) {
      if (opts.json) {
        return { code: 1, stdout: JSON.stringify({ ok: false, issues: err.issues }) };
      }
      return { code: 1, stderr: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      return { code: 2, stdout: JSON.stringify({ ok: false, error: message }) };
    }
    return { code: 2, stderr: message };
  }
}
```

- [ ] **Step 4: Run the tests — verify they PASS**

Run: `node --import tsx --test test/validate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck the whole package (covers cli.ts from Task 2)**

Run: `npm run build`
Expected: `tsc` exits 0, no errors. Confirms `cli.ts`, `generate.ts`, and `validate.ts` all typecheck together.

- [ ] **Step 6: Commit (this also commits Task 2's cli.ts/generate.ts)**

```bash
git add scripts/validate.ts scripts/generate.ts scripts/cli.ts test/validate.test.ts
git commit -m "feat(validate): add runValidate (text + --json) parse-only check"
```

---

## Task 4: Wire up `package.json` bin/scripts + CLI smoke test

**Files:**
- Modify: `package.json`
- Modify: `test/validate.test.ts` (append a subprocess smoke test)

- [ ] **Step 1: Repoint the bin and add scripts**

Edit `package.json`:
- Change `"bin": { "yamlai": "dist/scripts/generate.js" }` → `"bin": { "yamlai": "dist/scripts/cli.js" }`.
- In `scripts`, change `"gen": "tsx scripts/generate.ts"` → `"gen": "tsx scripts/cli.ts generate"`.
- Add `"validate": "tsx scripts/cli.ts validate"` to `scripts`.

Resulting `bin` + relevant `scripts` block:

```json
  "bin": {
    "yamlai": "dist/scripts/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "tsc",
    "parse:example": "tsx scripts/parse-example.ts",
    "gen:example": "tsx scripts/generate-example.ts",
    "gen": "tsx scripts/cli.ts generate",
    "validate": "tsx scripts/cli.ts validate",
    "test": "node --import tsx --test test/*.test.ts"
  },
```

- [ ] **Step 2: Write the failing CLI smoke test**

Append to `test/validate.test.ts` (add `execFileSync` to the `node:fs`-adjacent imports at the top: `import { execFileSync } from 'node:child_process';`):

```ts
test('CLI: `validate <examples>` exits 0 and prints a summary', () => {
  const out = execFileSync(
    'node',
    ['--import', 'tsx', 'scripts/cli.ts', 'validate', EXAMPLES],
    { encoding: 'utf8' },
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
      { encoding: 'utf8' },
    );
  } catch (e: any) {
    code = e.status;
    stdout = e.stdout;
  }
  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout).ok, false);
});
```

- [ ] **Step 3: Run the smoke test — verify it FAILS first, then PASSES**

Run: `node --import tsx --test test/validate.test.ts`
Expected: the two new CLI tests should pass once `scripts/cli.ts` exists (from Task 2/3). If `cli.ts` is missing or mis-wired, they fail — fix wiring until PASS. All 6 tests in the file pass.

- [ ] **Step 4: Full regression + build**

Run: `npm test && npm run build`
Expected: all tests pass (0 fail); `tsc` exits 0.

- [ ] **Step 5: Manual sanity check (optional but recommended)**

Run: `npm run validate -- ../examples`
Expected: `✓ valid: 2 agents, 4 workflows` (counts match the example project), exit 0.

Run: `npm run validate -- ../examples --json`
Expected: `{"ok":true,"issues":[]}`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json test/validate.test.ts
git commit -m "feat(validate): wire `yamlai validate` bin + npm script + CLI smoke tests"
```

---

## Task 5: Document the `validate` command

**Files:**
- Modify: `../website/docs/cli.md`

- [ ] **Step 1: Add the `validate` section and update exit codes**

Edit `../website/docs/cli.md`. After the existing generate examples block (before `## Arguments`), add:

````markdown
## `validate`

Check that a project is well-formed without generating any code. Useful in CI.

```bash
# human-readable summary; non-zero exit on problems
npx @addorimprove/yamlai validate ./my-project

# machine-readable result for CI tooling
npx @addorimprove/yamlai validate ./my-project --json
```

`validate` runs the same parser as `generate` (strict — unknown/typo'd keys are
errors), but emits no files.

| Outcome | Text output | `--json` output | Exit |
|---|---|---|---|
| Valid | `✓ valid: N agents, M workflows` (stdout) | `{"ok":true,"issues":[]}` | `0` |
| Validation errors | aggregated `file: message` lines (stderr) | `{"ok":false,"issues":[{"file","message"}]}` | `1` |
| Unexpected error | error message (stderr) | `{"ok":false,"error":"..."}` | `2` |
````

- [ ] **Step 2: Note that generate is now also strict**

Under the existing `## Errors` heading in `cli.md`, add a sentence:

```markdown
Unknown or misspelled keys (in `config.yaml`, agent/model/workflow files) are now
rejected rather than silently ignored — the same check `validate` runs.
```

- [ ] **Step 3: Commit**

```bash
git add ../website/docs/cli.md
git commit -m "docs(cli): document the validate command and strict-key checking"
```

---

## Self-Review Notes (for the executor)

- **Spec coverage:** strict schemas (Task 1) ✓; `validate` subcommand + back-compat dispatch (Task 2) ✓; `runValidate` text+json+exit codes (Task 3) ✓; bin/script wiring (Task 4) ✓; docs (Task 5) ✓.
- **Known cross-task dependency:** `scripts/cli.ts` (Task 2) imports `runValidate` from Task 3 — commit Task 2's files together with Task 3 (noted in both tasks).
- **Type consistency:** `runValidate(root: string, opts?: { json?: boolean }): ValidateResult` and `runGenerate(argv: string[]): void` are referenced identically in `cli.ts` and the tests.
- **Exit-code contract** is identical across `runValidate`, the cli dispatcher, and `cli.md`: 0 valid / 1 ParseError / 2 unexpected.
