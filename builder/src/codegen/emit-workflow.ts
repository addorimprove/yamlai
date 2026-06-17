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
  // Custom steps live in a steps/ dir nested inside workflows/ and are imported
  // relative to this file.
  for (const s of wf.stepFiles) {
    lines.push(`import { ${s.exportName} } from './steps/${s.id}';`);
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
  // A custom step is already a `Step`, so it's used directly; agents/tools are
  // wrapped in createStep(...) to produce one.
  const renderLeaf = (ref: { kind: string; exportName: string }) =>
    ref.kind === 'step' ? ref.exportName : `createStep(${ref.exportName})`;

  for (const step of wf.steps) {
    if (step.kind === 'parallel') {
      const inner = step.children!.map(renderLeaf).join(', ');
      lines.push(`  .parallel([${inner}])`);
    } else {
      lines.push(`  .then(${renderLeaf(step.ref!)})`);
    }
  }
  lines.push(`  .commit();`);
  lines.push('');
  return lines.join('\n');
}
