import type { ResolvedMemory } from '../types.js';
import { backtickString } from './emit-helpers.js';

/** Generate the source for src/mastra/utils/memory.ts. */
export function emitMemory(memory: ResolvedMemory, storageUrl: string): string {
  const hasRecall = memory.semanticRecall !== undefined;
  const url = JSON.stringify(storageUrl);

  const lines: string[] = [];
  lines.push(`import { Memory } from '@mastra/memory';`);
  lines.push(
    hasRecall
      ? `import { LibSQLStore, LibSQLVector } from '@mastra/libsql';`
      : `import { LibSQLStore } from '@mastra/libsql';`,
  );
  lines.push('');

  const ctor: string[] = [];
  ctor.push(`  storage: new LibSQLStore({ id: 'memory-storage', url: ${url} }),`);
  if (hasRecall) {
    const sr = memory.semanticRecall!;
    ctor.push(`  vector: new LibSQLVector({ id: 'memory-vector', url: ${url} }),`);
    ctor.push(`  embedder: ${JSON.stringify(sr.embedder)},`);
  }

  const options: string[] = [];
  if (memory.lastMessages !== undefined) {
    options.push(`    lastMessages: ${memory.lastMessages},`);
  }
  if (hasRecall) {
    const sr = memory.semanticRecall!;
    const parts: string[] = [`topK: ${sr.topK}`, `messageRange: ${formatRange(sr.messageRange)}`];
    if (sr.scope) parts.push(`scope: ${JSON.stringify(sr.scope)}`);
    options.push(`    semanticRecall: { ${parts.join(', ')} },`);
  }
  if (memory.workingMemory) {
    const wm = memory.workingMemory;
    const parts: string[] = [`enabled: true`];
    if (wm.scope) parts.push(`scope: ${JSON.stringify(wm.scope)}`);
    if (wm.template !== undefined) parts.push(`template: \`${backtickString(wm.template)}\``);
    options.push(`    workingMemory: { ${parts.join(', ')} },`);
  }

  ctor.push(`  options: {`);
  ctor.push(...options);
  ctor.push(`  },`);

  lines.push(`export const memory = new Memory({`);
  lines.push(...ctor);
  lines.push(`});`);
  lines.push('');
  return lines.join('\n');
}

function formatRange(r: number | { before: number; after: number }): string {
  return typeof r === 'number' ? String(r) : `{ before: ${r.before}, after: ${r.after} }`;
}
