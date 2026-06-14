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
  // Sub-agent imports — deduped, in listed order. Sibling files in agents/.
  // A self-reference needs no import: the export lives in this very module.
  const seenSubImport = new Set<string>();
  for (const sub of agent.subAgents) {
    if (sub.id === agent.id) continue;
    if (seenSubImport.has(sub.exportName)) continue;
    seenSubImport.add(sub.exportName);
    lines.push(`import { ${sub.exportName} } from './${sub.id}';`);
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
  const settings: string[] = [];
  if (agent.model.temperature !== undefined) {
    settings.push(`temperature: ${agent.model.temperature}`);
  }
  if (agent.model.maxTokens !== undefined) {
    settings.push(`maxOutputTokens: ${agent.model.maxTokens}`);
  }
  const modelStr = JSON.stringify(agent.model.routerString);
  if (settings.length > 0) {
    fields.push(`  model: [{ model: ${modelStr}, modelSettings: { ${settings.join(', ')} } }],`);
  } else {
    fields.push(`  model: ${modelStr},`);
  }

  if (agent.tools.length > 0) {
    const toolVars = [...new Set(agent.tools.map((t) => t.exportName))].join(', ');
    fields.push(`  tools: { ${toolVars} },`);
  }

  if (agent.subAgents.length > 0) {
    const agentVars = [...new Set(agent.subAgents.map((s) => s.exportName))].join(', ');
    // Cyclic agents (incl. self-reference) emit a thunk so the referenced
    // bindings are read lazily, past their temporal dead zone.
    fields.push(
      agent.lazyAgents
        ? `  agents: () => ({ ${agentVars} }),`
        : `  agents: { ${agentVars} },`,
    );
  }

  if (agent.memory) {
    fields.push(`  memory,`);
  }

  // Cyclic agents reference their own binding inside the `agents` thunk; an
  // explicit type annotation breaks the otherwise-circular type inference
  // (TS7022/TS7023 "implicitly has type any ... referenced in its own initializer").
  const decl = agent.lazyAgents
    ? `export const ${toExportName(agent.id)}: Agent = new Agent({`
    : `export const ${toExportName(agent.id)} = new Agent({`;
  lines.push(decl);
  lines.push(...fields);
  lines.push(`});`);
  lines.push('');
  return lines.join('\n');
}
