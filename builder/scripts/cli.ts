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
