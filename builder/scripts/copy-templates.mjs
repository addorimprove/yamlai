// Post-build packaging steps (run after `tsc`, before publish):
//  1. Copy the canonical example project into dist/templates so it ships in the
//     npm tarball (files: ["dist"]). tsc does not emit non-.ts files.
//  2. Mark the compiled CLI bin executable. tsc emits 0644, and relying on npm to
//     add the bit on install is flaky (global installs can end up non-exec → the
//     bin fails with "Permission denied"). Ship it 0755 so it always runs.
// Source of truth is examples/ at the repo root (builder/../examples).
import { chmodSync, cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const examples = fileURLToPath(new URL('../../examples', import.meta.url));
const dest = fileURLToPath(new URL('../dist/templates', import.meta.url));

rmSync(dest, { recursive: true, force: true });
cpSync(examples, dest, { recursive: true });
console.log(`Copied templates → ${dest}`);

const bin = fileURLToPath(new URL('../dist/scripts/cli.js', import.meta.url));
chmodSync(bin, 0o755);
console.log(`Made bin executable → ${bin}`);
