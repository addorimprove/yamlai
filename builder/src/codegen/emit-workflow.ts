import type { ResolvedWorkflow } from '../types.js';

/** Generate the source for src/mastra/workflows/<id>.ts. */
export function emitWorkflow(wf: ResolvedWorkflow): string {
  const lines: string[] = [];
  lines.push(`import { createWorkflow, createStep } from '@mastra/core/workflows';`);
  lines.push(`import { z } from 'zod';`);
  // Distinct agent/tool imports, in first-seen order (already deduped in the parser).
  for (const a of wf.agents) {
    lines.push(`import { ${a.exportName} } from '../agents/${a.id}';`);
  }
  for (const t of wf.tools) {
    lines.push(`import { ${t.exportName} } from '../tools/${t.id}';`);
  }
  lines.push('');

  lines.push(`export const ${wf.exportName} = createWorkflow({`);
  lines.push(`  id: ${JSON.stringify(wf.id)},`);
  if (wf.description) {
    lines.push(`  description: ${JSON.stringify(wf.description)},`);
  }
  lines.push(`  inputSchema: ${wf.inputZod},`);
  lines.push(`  outputSchema: ${wf.outputZod},`);
  lines.push(`})`);
  for (const step of wf.steps) {
    if (step.kind === 'parallel') {
      const inner = step.children!.map((c) => `createStep(${c.exportName})`).join(', ');
      lines.push(`  .parallel([${inner}])`);
    } else {
      lines.push(`  .then(createStep(${step.ref!.exportName}))`);
    }
  }
  lines.push(`  .commit();`);
  lines.push('');
  return lines.join('\n');
}
