import type { ResolvedAgent } from '../types.js';
import { toExportName } from '../naming.js';
import { backtickString } from './emit-helpers.js';

/** Generate the source for src/mastra/agents/<id>.ts. */
export function emitAgent(agent: ResolvedAgent): string {
  const lines: string[] = [];
  lines.push(`import { Agent } from '@mastra/core/agent';`);

  // Tool imports — deduped, in listed order.
  const seenImport = new Set<string>();
  for (const tool of agent.tools) {
    if (seenImport.has(tool.exportName)) continue;
    seenImport.add(tool.exportName);
    lines.push(`import { ${tool.exportName} } from '../tools/${tool.id}';`);
  }
  if (agent.memory) {
    lines.push(`import { memory } from '../utils/memory';`);
  }
  lines.push('');

  const fields: string[] = [];
  fields.push(`  id: ${JSON.stringify(agent.id)},`);
  fields.push(`  name: ${JSON.stringify(agent.name)},`);
  if (agent.description) {
    fields.push(`  description: ${JSON.stringify(agent.description)},`);
  }
  fields.push(`  instructions: \`${backtickString(agent.instructions)}\`,`);
  fields.push(`  model: ${JSON.stringify(agent.model.routerString)},`);

  const settings: string[] = [];
  if (agent.model.temperature !== undefined) {
    settings.push(`temperature: ${agent.model.temperature}`);
  }
  if (agent.model.maxTokens !== undefined) {
    settings.push(`maxTokens: ${agent.model.maxTokens}`);
  }
  if (settings.length > 0) {
    fields.push(`  modelSettings: { ${settings.join(', ')} },`);
  }

  if (agent.tools.length > 0) {
    const toolVars = [...new Set(agent.tools.map((t) => t.exportName))].join(', ');
    fields.push(`  tools: { ${toolVars} },`);
  }

  if (agent.memory) {
    fields.push(`  memory,`);
  }

  lines.push(`export const ${toExportName(agent.id)} = new Agent({`);
  lines.push(...fields);
  lines.push(`});`);
  lines.push('');
  return lines.join('\n');
}
