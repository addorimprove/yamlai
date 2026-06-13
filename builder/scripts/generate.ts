import { resolve } from 'node:path';
import { generateProject, parseProject, writeProject } from '../src/index.js';

// Generic CLI: generate a Mastra project from any YAML Agent Builder project.
//   pnpm gen <input-dir> [output-dir] [--force]
// Paths are resolved relative to the current working directory. output-dir
// defaults to ./<config.name>. By default the writer refuses to overwrite a
// non-empty directory it didn't generate; pass --force to override.
const argv = process.argv.slice(2);
const force = argv.includes('--force');
const [inputArg, outputArg] = argv.filter((a) => a !== '--force');

if (!inputArg) {
  console.error('Usage: pnpm gen <input-dir> [output-dir] [--force]');
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
