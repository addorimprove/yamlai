# `yamlai init` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `yamlai init [dir] [--force]` subcommand that scaffolds the full `examples/` project plus `README.md` and `.env.example` into a target directory.

**Architecture:** `examples/` is the single template source. The build copies it to `dist/templates/` so it ships in the npm tarball. `runInit` reads the template into a `FileMap`, rewrites `config.yaml`'s `name:` to the target basename, injects two embedded meta-files, and hands the map to the existing `writeProject` (which already guards non-empty/overlap/escape). The CLI wraps `runInit` to print clean errors.

**Tech Stack:** TypeScript (ESM, NodeNext), Node ≥22.13, `node --test`, `tsc`.

---

## File Structure

- `builder/scripts/copy-templates.mjs` — **new.** Build helper; copies `examples/` → `dist/templates/` via `fs.cpSync`.
- `builder/package.json` — **modify.** Wire the copy into `build` and `prepublishOnly`.
- `builder/scripts/init.ts` — **new.** Exports `runInit(argv)`: template resolution, recursive read, name rewrite, meta-file injection, `writeProject` call.
- `builder/scripts/cli.ts` — **modify.** Add an `init` dispatch branch with clean error handling.
- `builder/test/init.test.ts` — **new.** Round-trip + behavior tests.
- `website/docs/init.md` — **new.** Short reference page (follows existing per-command doc pattern).

---

## Task 1: Build helper copies examples → dist/templates

**Files:**
- Create: `builder/scripts/copy-templates.mjs`
- Modify: `builder/package.json` (scripts block)

- [ ] **Step 1: Write the copy helper**

Create `builder/scripts/copy-templates.mjs`:

```js
// Copy the canonical example project into dist/templates so it ships in the npm
// tarball (files: ["dist"]). tsc does not emit non-.ts files, so this runs after
// it. Source of truth is examples/ at the repo root (builder/../examples).
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const examples = fileURLToPath(new URL('../../examples', import.meta.url));
const dest = fileURLToPath(new URL('../dist/templates', import.meta.url));

rmSync(dest, { recursive: true, force: true });
cpSync(examples, dest, { recursive: true });
console.log(`Copied templates → ${dest}`);
```

- [ ] **Step 2: Wire it into the build scripts**

In `builder/package.json`, change the `build` and `prepublishOnly` scripts:

```json
    "build": "tsc && node scripts/copy-templates.mjs",
    "prepublishOnly": "tsc && node scripts/copy-templates.mjs",
```

- [ ] **Step 3: Run the build and verify templates were copied**

Run: `cd builder && npm run build && ls dist/templates && ls dist/templates/workflow`
Expected: `dist/templates` lists `agent config.yaml model prompt tools workflow`; `dist/templates/workflow` lists `compare-answers.yaml condition draft-loop.yaml refine-loop.yaml research-flow.yaml steps`.

- [ ] **Step 4: Commit**

```bash
git add builder/scripts/copy-templates.mjs builder/package.json
git commit -m "build: copy examples/ to dist/templates for packaging"
```

---

## Task 2: `runInit` core (TDD)

**Files:**
- Create: `builder/scripts/init.ts`
- Test: `builder/test/init.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `builder/test/init.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd builder && node --import tsx --test test/init.test.ts`
Expected: FAIL — `Cannot find module '../scripts/init.js'` (init.ts does not exist yet).

- [ ] **Step 3: Implement `runInit`**

Create `builder/scripts/init.ts`:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeProject, type FileMap } from '../src/index.js';

// Resolve the bundled template directory. Published: dist/templates (next to this
// compiled file's parent). Dev (tsx): the repo's examples/ at builder/../examples.
function resolveTemplateDir(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const candidates = [resolve(here, '../templates'), resolve(here, '../../examples')];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`Could not locate init templates. Looked in:\n  ${candidates.join('\n  ')}`);
}

// Read every file under dir into a FileMap keyed by POSIX-style relative path.
function readTemplate(dir: string): FileMap {
  const files: FileMap = {};
  for (const rel of readdirSync(dir, { recursive: true })) {
    const relPath = String(rel).split('\\').join('/');
    const abs = join(dir, relPath);
    if (statSync(abs).isFile()) {
      files[relPath] = readFileSync(abs, 'utf8');
    }
  }
  return files;
}

const README = (name: string) => `# ${name}

A YAML Agent Builder project scaffolded with \`yamlai init\`.

## Generate the Mastra app

\`\`\`bash
yamlai validate .      # parse-only check
yamlai generate .      # emit a Mastra project to ./${name}
\`\`\`

## Configure secrets

Copy \`.env.example\` to \`.env\` and fill in your keys (the template uses OpenAI
models and embeddings).

## Layout

- \`config.yaml\` — project: agents, workflows, logger, storage, memory
- \`agent/\` — agent definitions
- \`model/\` — model configs
- \`prompt/\` — instruction files referenced by agents
- \`workflow/\` — workflows, plus \`steps/\` and \`condition/\` helpers
- \`tools/\` — tool implementations
`;

const ENV_EXAMPLE = `# Required by the generated Mastra app (OpenAI models + embeddings).
OPENAI_API_KEY=
`;

// Scaffold a complete YAML Agent Builder project into the target directory.
//   yamlai init [dir] [--force]
// dir defaults to ./mastra-app. Refuses a non-empty target unless --force.
export function runInit(argv: string[]): void {
  const force = argv.includes('--force');
  const dirArg = argv.find((a) => !a.startsWith('--')) ?? 'mastra-app';
  const target = resolve(process.cwd(), dirArg);
  const name = basename(target);

  const files = readTemplate(resolveTemplateDir());

  // Rewrite the top-level `name:` in config.yaml to the target dir basename so a
  // later bare `yamlai generate <dir>` emits to a predictably named folder.
  if (files['config.yaml']) {
    files['config.yaml'] = files['config.yaml'].replace(/^name:[^\n]*/m, `name: ${name}`);
  }

  files['README.md'] = README(name);
  files['.env.example'] = ENV_EXAMPLE;

  writeProject(files, target, resolveTemplateDir(), { force });
  console.log(`Initialized ${name}/ (${Object.keys(files).length} files). Next: yamlai generate ${dirArg}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd builder && node --import tsx --test test/init.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add builder/scripts/init.ts builder/test/init.test.ts
git commit -m "feat: add runInit scaffolder with round-trip tests"
```

---

## Task 3: Wire `init` into the CLI

**Files:**
- Modify: `builder/scripts/cli.ts`

- [ ] **Step 1: Add the `init` dispatch branch**

In `builder/scripts/cli.ts`, add the import alongside the existing ones:

```ts
import { runInit } from './init.js';
```

Then add this branch immediately after the `validate` block and before the final `runGenerate(...)` line:

```ts
if (first === 'init') {
  try {
    runInit(rest);
    process.exit(0);
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
    process.exit(1);
  }
}
```

- [ ] **Step 2: Verify init works end-to-end via the CLI (dev run)**

Run:
```bash
cd builder && rm -rf /tmp/yamlai-cli-init && \
  node --import tsx scripts/cli.ts init /tmp/yamlai-cli-init && \
  node --import tsx scripts/cli.ts validate /tmp/yamlai-cli-init
```
Expected: first command prints `Initialized yamlai-cli-init/ (18 files). Next: yamlai generate /tmp/yamlai-cli-init`; second prints `✓ valid: 2 agents, 4 workflows`.

- [ ] **Step 3: Verify the non-empty guard via the CLI**

Run: `cd builder && node --import tsx scripts/cli.ts init /tmp/yamlai-cli-init; echo "exit=$?"`
Expected: stderr contains `Refusing to overwrite non-empty directory`; `exit=1`.

- [ ] **Step 4: Run the full test suite**

Run: `cd builder && npm test`
Expected: PASS — existing suite plus the new init tests, no failures.

- [ ] **Step 5: Commit**

```bash
git add builder/scripts/cli.ts
git commit -m "feat: dispatch yamlai init subcommand"
```

---

## Task 4: Documentation page

**Files:**
- Create: `website/docs/init.md`

- [ ] **Step 1: Inspect an existing command doc for the exact pattern**

Run: `ls website/docs && sed -n '1,40p' website/docs/validate.md 2>/dev/null || echo "no validate.md — check the docs structure"`
Expected: reveals the frontmatter/heading convention used by sibling reference pages. Match it (sidebar position, title style) in the next step.

- [ ] **Step 2: Write the init reference page**

Create `website/docs/init.md`, matching the frontmatter style observed in Step 1. Body:

```markdown
# init

Scaffold a complete YAML Agent Builder project to start from.

```bash
yamlai init [dir] [--force]
```

- `dir` — target directory. Defaults to `./mastra-app`.
- `--force` — overwrite a non-empty target directory.

It writes a full working project — agents, models, prompts, tools, and four
workflows (sequential, parallel, and two loop forms) — plus a `README.md` and a
`.env.example`. The project's `config.yaml` `name` is set to the target
directory's basename.

Next steps:

```bash
yamlai validate mastra-app   # parse-only check
yamlai generate mastra-app   # emit the Mastra project
```
```

(If Step 1 showed a `sidebar_position`/`id` frontmatter block, add the matching block above the `# init` heading.)

- [ ] **Step 3: Commit**

```bash
git add website/docs/init.md
git commit -m "docs: add yamlai init reference page"
```

---

## Self-Review Notes

- **Spec coverage:** default `mastra-app` (Task 2 test 4), full `examples/` content + README + `.env.example` (Task 2), `examples/` as single source bundled to `dist/templates` (Task 1), `import.meta.url` resolution with dev fallback (Task 2 `resolveTemplateDir`), name rewrite (Task 2 test 2), `writeProject` reuse + `--force` (Task 2 test 5), CLI wiring (Task 3), round-trip test (Task 2 test 1), docs page (Task 4). All spec sections mapped.
- **Type consistency:** `runInit(argv: string[]): void` used identically in init.ts, cli.ts, and tests. `FileMap` imported from `../src/index.js` (it is re-exported there). `writeProject(files, outDir, rootDir, { force })` signature matches `src/codegen/write.ts`.
