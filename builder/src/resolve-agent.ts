import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentSchema, ModelSchema } from './schemas.js';
import { formatZodError } from './errors.js';
import { invalidExportIdReason, toExportName } from './naming.js';
import { fileExportsName, readText, readYaml, type AddIssue } from './read.js';
import type { ResolvedAgent, ResolvedModel, ResolvedTool } from './types.js';

/** What the resolver needs from its caller: where files live, whether the project
 *  declares a memory block, and a sink for problems. */
export interface ResolveAgentContext {
  rootDir: string;
  hasMemoryConfig: boolean;
  addIssue: AddIssue;
}

/** The outcome of resolving one schema-valid agent. The raw sub-agent/workflow ref
 *  lists are returned even when the agent itself fails prompt/model resolution, so
 *  the caller can still validate those references and build the cycle graph. */
export interface ResolvedAgentResult {
  subAgentRefs: string[];
  workflowRefs: string[];
  /** Present only when the agent fully resolved (prompt + model + tools all valid). */
  agent?: ResolvedAgent;
}

/** Dedupe ref objects by `id`, preserving first-seen order. */
function uniqueById<T extends { id: string }>(refs: T[]): T[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

/** Resolve one agent's file (prompt, model, tools) into a ResolvedAgent. Returns
 *  undefined when the agent file is missing or schema-invalid; otherwise returns
 *  its ref lists with `agent` set only if every part resolved. Problems are
 *  recorded via ctx.addIssue. The `lazyAgents`/`lazyWorkflows` flags are left
 *  false here — the caller sets them once the full cross-agent graph is known. */
export function resolveAgent(
  agentId: string,
  ctx: ResolveAgentContext,
): ResolvedAgentResult | undefined {
  const agentPath = `agent/${agentId}.yaml`;
  const rawAgent = readYaml(ctx.rootDir, agentPath, ctx.addIssue);
  if (rawAgent === undefined) return undefined;

  const agentResult = AgentSchema.safeParse(rawAgent);
  if (!agentResult.success) {
    ctx.addIssue(agentPath, formatZodError(agentResult.error));
    return undefined;
  }
  const agent = agentResult.data;
  const result: ResolvedAgentResult = {
    subAgentRefs: agent.agents,
    workflowRefs: agent.workflows,
  };

  // instructions: `instructions` is a prompt id referencing prompt/<id>.md.
  const promptContent = readText(ctx.rootDir, `prompt/${agent.instructions}.md`, ctx.addIssue);
  const instructions = promptContent !== undefined ? promptContent.trimEnd() : undefined;

  // model
  const modelPath = `model/${agent.model}.yaml`;
  const rawModel = readYaml(ctx.rootDir, modelPath, ctx.addIssue);
  let resolvedModel: ResolvedModel | undefined;
  if (rawModel !== undefined) {
    const modelResult = ModelSchema.safeParse(rawModel);
    if (!modelResult.success) {
      ctx.addIssue(modelPath, formatZodError(modelResult.error));
    } else {
      const m = modelResult.data;
      resolvedModel = {
        id: agent.model,
        provider: m.provider,
        model: m.model,
        routerString: `${m.provider}/${m.model}`,
        temperature: m.temperature,
        maxTokens: m.max_tokens,
      };
    }
  }

  // tools — deduped by id (a repeated tool emits one import + one map entry).
  const tools: ResolvedTool[] = [];
  for (const toolId of agent.tools) {
    const toolPath = `tools/${toolId}.ts`;
    const reason = invalidExportIdReason(toolId);
    if (reason) {
      ctx.addIssue(agentPath, `tool ${reason}`);
      continue;
    }
    if (!existsSync(join(ctx.rootDir, toolPath))) {
      ctx.addIssue(agentPath, `tool not found: ${toolPath}`);
      continue;
    }
    const exportName = toExportName(toolId);
    if (!fileExportsName(ctx.rootDir, toolPath, exportName)) {
      // Name the source id only when it isn't already the export name (kebab/snake ids).
      const detail = toolId === exportName ? '' : ` (the camelCase of tool id \`${toolId}\`)`;
      ctx.addIssue(agentPath, `${toolPath} must export \`${exportName}\`${detail}`);
      continue;
    }
    if (tools.some((t) => t.id === toolId)) continue;
    tools.push({ id: toolId, filePath: toolPath, exportName });
  }

  // Only emit a fully-resolved agent; prompt/model issues are already recorded.
  if (instructions === undefined || !resolvedModel) return result;

  if (agent.memory && !ctx.hasMemoryConfig) {
    ctx.addIssue(agentPath, 'memory: true but config.yaml has no `memory:` block');
  }

  result.agent = {
    id: agentId,
    exportName: toExportName(agentId),
    name: agent.name,
    description: agent.description,
    instructions,
    model: resolvedModel,
    tools,
    // Ref lists are deduped by id so the emitter never re-deduplicates.
    subAgents: uniqueById(agent.agents.map((id) => ({ id, exportName: toExportName(id) }))),
    lazyAgents: false, // set by the caller once the full sub-agent graph is known
    workflows: uniqueById(agent.workflows.map((id) => ({ id, exportName: toExportName(id) }))),
    lazyWorkflows: false, // set by the caller once the agent⇄workflow graph is known
    memory: agent.memory,
  };
  return result;
}
