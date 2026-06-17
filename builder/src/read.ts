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
