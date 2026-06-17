import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/** Sink for problems found while reading; same shape the resolvers use. */
export type AddIssue = (file: string, message: string) => void;

/** Read+parse a YAML file relative to rootDir. Returns undefined (and records an
 *  issue) when the file is missing, empty, or not valid YAML. */
export function readYaml(rootDir: string, relPath: string, addIssue: AddIssue): unknown {
  const abs = join(rootDir, relPath);
  if (!existsSync(abs)) {
    addIssue(relPath, 'file not found');
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(abs, 'utf8'));
  } catch (err) {
    addIssue(relPath, `invalid YAML: ${(err as Error).message}`);
    return undefined;
  }
  if (parsed === null || parsed === undefined) {
    addIssue(relPath, 'file is empty or contains only null');
    return undefined;
  }
  return parsed;
}

/** Heuristic check that TS/JS `source` declares a named export `name`. Recognises
 *  `export const|let|var|function|class NAME` (incl. `async function`/`function*`)
 *  and `export { NAME }` / `export { x as NAME }` (incl. re-export `... } from`).
 *  Comments are not stripped, so it errs toward accepting — a generated import of a
 *  copied step/tool/condition file fails to compile only when the name is genuinely
 *  absent, and this catches that before codegen rather than at `tsc`. */
export function sourceExportsName(source: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const decl = new RegExp(
    `export\\s+(?:async\\s+)?(?:const|let|var|function\\*?|class)\\s+${escaped}\\b`,
  );
  if (decl.test(source)) return true;
  // `export { a, x as NAME, NAME }` — including the `... } from '...'` re-export form.
  const blockRe = /export\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(source)) !== null) {
    for (const spec of m[1].split(',')) {
      const trimmed = spec.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+as\s+/);
      const exported = (parts[1] ?? parts[0]).trim();
      if (exported === name) return true;
    }
  }
  return false;
}

/** True if the file at rootDir/relPath has a named export `name`. Assumes the file
 *  exists (callers check existence first to keep their own "not found" message). */
export function fileExportsName(rootDir: string, relPath: string, name: string): boolean {
  return sourceExportsName(readFileSync(join(rootDir, relPath), 'utf8'), name);
}

/** Read a raw text file (e.g. a prompt .md) relative to rootDir. Returns undefined
 *  (and records an issue) when the file is missing or blank. */
export function readText(rootDir: string, relPath: string, addIssue: AddIssue): string | undefined {
  const abs = join(rootDir, relPath);
  if (!existsSync(abs)) {
    addIssue(relPath, 'file not found');
    return undefined;
  }
  const content = readFileSync(abs, 'utf8');
  if (content.trim() === '') {
    addIssue(relPath, 'file is empty');
    return undefined;
  }
  return content;
}
