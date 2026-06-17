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
