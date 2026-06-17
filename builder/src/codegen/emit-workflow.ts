import type { ResolvedLoop, ResolvedLoopBody, ResolvedWorkflow } from '../types.js';

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
  // Loop predicates live in a condition/ dir nested inside workflows/.
  for (const c of wf.conditionFiles) {
    lines.push(`import { ${c.exportName} } from './condition/${c.id}';`);
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

  // A loop body is either a single leaf or an inline nested workflow (a Workflow
  // is itself a Step, so it can be passed to dountil/dowhile/foreach directly).
  const renderLoopBody = (b: ResolvedLoopBody): string => {
    if (b.kind === 'leaf') return renderLeaf(b.ref);
    const inner = b.steps.map((s) => `      .then(${renderLeaf(s)})`).join('\n');
    return (
      `createWorkflow({ id: ${JSON.stringify(b.id)}, inputSchema: ${b.inputZod}, outputSchema: ${b.outputZod} })\n` +
      `${inner}\n` +
      `      .commit()`
    );
  };

  // The loop's condition argument: the imported predicate, optionally wrapped with
  // a max_iterations guard, or a pure iteration guard when there's no predicate.
  const renderLoopCondition = (lp: ResolvedLoop): string => {
    const n = lp.maxIterations;
    if (!lp.condition) return `async (args) => args.iterationCount >= ${n}`;
    const c = lp.condition.exportName;
    if (n === undefined) return c;
    return lp.loopKind === 'dountil'
      ? `async (args) => (await ${c}(args)) || args.iterationCount >= ${n}`
      : `async (args) => (await ${c}(args)) && args.iterationCount < ${n}`;
  };

  for (const step of wf.steps) {
    if (step.kind === 'parallel') {
      const inner = step.children.map(renderLeaf).join(', ');
      lines.push(`  .parallel([${inner}])`);
    } else if (step.kind === 'loop') {
      const lp = step.loop;
      const body = renderLoopBody(lp.body);
      if (lp.loopKind === 'foreach') {
        const opts = lp.concurrency !== undefined ? `, { concurrency: ${lp.concurrency} }` : '';
        lines.push(`  .foreach(${body}${opts})`);
      } else {
        lines.push(`  .${lp.loopKind}(${body}, ${renderLoopCondition(lp)})`);
      }
    } else {
      lines.push(`  .then(${renderLeaf(step.ref)})`);
    }
  }
  lines.push(`  .commit();`);
  lines.push('');
  return lines.join('\n');
}
