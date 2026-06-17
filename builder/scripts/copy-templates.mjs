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
