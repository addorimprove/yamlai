import type { z } from 'zod';

/** Flatten a ZodError into a single `path: message; …` string for one issue line. */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

export interface ParseIssue {
  /** File the issue was found in, relative to the project root. */
  file: string;
  message: string;
}

/** Aggregates every problem found during parsing into one thrown error. */
export class ParseError extends Error {
  readonly issues: ParseIssue[];

  constructor(issues: ParseIssue[]) {
    const body = issues.map((i) => `  ${i.file}: ${i.message}`).join('\n');
    super(`Found ${issues.length} problem(s):\n${body}`);
    this.name = 'ParseError';
    this.issues = issues;
  }
}
