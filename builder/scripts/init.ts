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

Run these from inside this directory. The generated Mastra app must live outside
the project, so it is written to a sibling folder.

\`\`\`bash
yamlai validate .                   # parse-only check
yamlai generate . ../${name}-build  # emit the Mastra app to ../${name}-build
\`\`\`

## Configure secrets

The dev server boots without any key. To actually chat with the agents, copy
\`.env.example\` to \`.env\` and set \`OPENAI_API_KEY\` (the default model is
\`openai/gpt-5-mini\` — change \`model/\` to use a different provider).

## Layout

- \`config.yaml\` — project: agents, workflows, logger, storage, memory
- \`agent/\` — agent definitions
- \`model/\` — model configs
- \`prompt/\` — instruction files referenced by agents
- \`workflow/\` — workflows, plus \`steps/\` and \`condition/\` helpers
- \`tools/\` — tool implementations
`;

const ENV_EXAMPLE = `# Only needed to chat with the agents (default model: openai/gpt-5-mini).
# The dev server boots without it.
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

  const templateDir = resolveTemplateDir();
  const files = readTemplate(templateDir);

  // Rewrite the top-level `name:` in config.yaml to the target dir basename so the
  // scaffolded project's name matches its folder.
  if (files['config.yaml']) {
    files['config.yaml'] = files['config.yaml'].replace(/^name:[^\n]*/m, `name: ${name}`);
  }

  files['README.md'] = README(name);
  files['.env.example'] = ENV_EXAMPLE;

  writeProject(files, target, templateDir, { force });
  console.log(
    `Initialized ${name}/ (${Object.keys(files).length} files). ` +
      `Next: yamlai generate ${dirArg} ${dirArg}-build`,
  );
}
