import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FileMap } from './types.js';

export interface WriteOptions {
  /** Overwrite a non-empty directory even without our marker file. */
  force?: boolean;
}

/** Write a FileMap to outDir. Guards against clobbering the input or unrelated dirs. */
export function writeProject(
  files: FileMap,
  outDir: string,
  rootDir: string,
  opts: WriteOptions = {},
): void {
  const absOut = resolve(outDir);
  const absRoot = resolve(rootDir);

  if (isSameOrNested(absOut, absRoot)) {
    throw new Error(
      `Refusing to write: output dir ${absOut} overlaps the input dir ${absRoot}.`,
    );
  }

  if (existsSync(absOut) && readdirSync(absOut).length > 0) {
    if (!opts.force) {
      throw new Error(
        `Refusing to overwrite non-empty directory ${absOut}. Pass force to override.`,
      );
    }
    rmSync(absOut, { recursive: true, force: true });
  }

  for (const [relPath, contents] of Object.entries(files)) {
    const dest = join(absOut, relPath);
    if (dest !== absOut && !dest.startsWith(absOut + sep)) {
      throw new Error(`Refusing to write: path ${relPath} escapes the output directory.`);
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, contents);
  }
}

/** True if a === b, or one is nested inside the other. */
function isSameOrNested(a: string, b: string): boolean {
  if (a === b) return true;
  const within = (parent: string, child: string) => {
    const rel = relative(parent, child);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  };
  return within(a, b) || within(b, a);
}
