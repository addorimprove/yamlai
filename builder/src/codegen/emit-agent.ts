import type { ResolvedAgent } from '../types.js';
import { backtickString } from './emit-helpers.js';

/** Generate the source for src/mastra/agents/<id>.ts.
 *  Ref lists (tools/subAgents/workflows) arrive deduped from the parser. */
export function emitAgent(agent: ResolvedAgent): string {
  const lines: string[] = [];
  lines.push(`import { Agent } from '@mastra/core/agent';`);

  // Tool imports, in listed order.
  for (const tool of agent.tools) {
    lines.push(`import { ${tool.exportName} } from '../tools/${tool.id}';`);
  }
  // Sub-agent imports (sibling files in agents/). A self-reference needs no
  // import: the export lives in this very module.
  for (const sub of agent.subAgents) {
    if (sub.id === agent.id) continue;
    lines.push(`import { ${sub.exportName} } from './${sub.id}';`);
  }
  // Attached-workflow imports. Lazy (cyclic) agents reference workflows off the
  // mastra instance instead, so an agent⇄workflow import cycle never forms.
  if (!agent.lazyWorkflows) {
    for (const wf of agent.workflows) {
      lines.push(`import { ${wf.exportName} } from '../workflows/${wf.id}';`);
    }
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
    const toolVars = agent.tools.map((t) => t.exportName).join(', ');
    fields.push(`  tools: { ${toolVars} },`);
  }

  if (agent.subAgents.length > 0) {
    const agentVars = agent.subAgents.map((s) => s.exportName).join(', ');
    // Cyclic agents (incl. self-reference) emit a thunk so the referenced
    // bindings are read lazily, past their temporal dead zone.
    fields.push(
      agent.lazyAgents
        ? `  agents: () => ({ ${agentVars} }),`
        : `  agents: { ${agentVars} },`,
    );
  }

  if (agent.workflows.length > 0) {
    if (agent.lazyWorkflows) {
      // mastra.getWorkflow(<exportName>) avoids importing the workflow module
      // (breaks the agent⇄workflow import cycle). The arg is the REGISTRATION KEY
      // (export name), which is how index.ts registers workflows; `mastra` is
      // optional in the DynamicArgument thunk, hence `mastra!`.
      // NOTE: do NOT extend the `export const … : Agent` annotation to cover
      // lazyWorkflows — the thunk doesn't reference the agent's own binding, so there's
      // no self-referential type to break. The annotation stays governed by lazyAgents.
      const entries = agent.workflows
        .map((w) => `${w.exportName}: mastra!.getWorkflow(${JSON.stringify(w.exportName)})`)
        .join(', ');
      fields.push(`  workflows: ({ mastra }) => ({ ${entries} }),`);
    } else {
      const wfVars = agent.workflows.map((w) => w.exportName).join(', ');
      fields.push(`  workflows: { ${wfVars} },`);
    }
  }

  if (agent.memory) {
    fields.push(`  memory,`);
  }

  // Cyclic agents reference their own binding inside the `agents` thunk; an
  // explicit type annotation breaks the otherwise-circular type inference
  // (TS7022/TS7023 "implicitly has type any ... referenced in its own initializer").
  const decl = agent.lazyAgents
    ? `export const ${agent.exportName}: Agent = new Agent({`
    : `export const ${agent.exportName} = new Agent({`;
  lines.push(decl);
  lines.push(...fields);
  lines.push(`});`);
  lines.push('');
  return lines.join('\n');
}
