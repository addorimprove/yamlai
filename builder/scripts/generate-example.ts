import { resolve } from 'node:path';
import { generateProject, parseProject, writeProject } from '../src/index.js';

// examples/ lives at the repo root, one level up from builder/.
const root = '../examples';
const project = parseProject(root);
const files = generateProject(project, root);
const outDir = process.argv[2] ?? resolve(process.cwd(), project.name);
writeProject(files, outDir, root, { force: true });
console.log(`Generated ${Object.keys(files).length} files → ${outDir}`);
