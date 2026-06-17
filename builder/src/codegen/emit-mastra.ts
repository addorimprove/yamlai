import type { ParsedProject } from '../types.js';
import { toExportName } from '../naming.js';

/** Generate the source for src/mastra/index.ts. */
export function emitIndex(project: ParsedProject): string {
  const lines: string[] = [];
  lines.push(`import { Mastra } from '@mastra/core/mastra';`);
  lines.push(`import { PinoLogger } from '@mastra/loggers';`);
  if (project.storage) {
    lines.push(`import { LibSQLStore } from '@mastra/libsql';`);
  }
  for (const agent of project.agents) {
    lines.push(`import { ${toExportName(agent.id)} } from './agents/${agent.id}';`);
  }
  for (const wf of project.workflows) {
    lines.push(`import { ${wf.exportName} } from './workflows/${wf.id}';`);
  }
  lines.push('');

  const agentVars = project.agents.map((a) => toExportName(a.id)).join(', ');
  lines.push(`export const mastra = new Mastra({`);
  lines.push(`  agents: { ${agentVars} },`);
  if (project.workflows.length > 0) {
    const wfVars = project.workflows.map((w) => w.exportName).join(', ');
    lines.push(`  workflows: { ${wfVars} },`);
  }
  if (project.storage) {
    lines.push(
      `  storage: new LibSQLStore({ id: 'mastra-storage', url: ${JSON.stringify(project.storage.url)} }),`,
    );
  }
  lines.push(
    `  logger: new PinoLogger({ name: 'Mastra', level: ${JSON.stringify(project.logger.level)} }),`,
  );
  lines.push(`});`);
  lines.push('');
  return lines.join('\n');
}
