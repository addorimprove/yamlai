import { ConfigSchema, WorkflowSchema } from './schemas.js';
import type { MemoryInput } from './schemas.js';
import { ParseError, formatZodError, type ParseIssue } from './errors.js';
import { toExportName } from './naming.js';
import { findCyclicNodes } from './graph.js';
import { readYaml } from './read.js';
import { resolveAgent } from './resolve-agent.js';
import { resolveWorkflow } from './resolve-workflow.js';
import type {
  ParsedProject,
  ResolvedAgent,
  ResolvedMemory,
  ResolvedWorkflow,
} from './types.js';

function resolveMemory(m: MemoryInput): ResolvedMemory {
  const out: ResolvedMemory = {};
  if (m.last_messages !== undefined) out.lastMessages = m.last_messages;
  if (m.semantic_recall) {
    out.semanticRecall = {
      embedder: m.semantic_recall.embedder,
      topK: m.semantic_recall.top_k,
      messageRange: m.semantic_recall.message_range,
      scope: m.semantic_recall.scope,
    };
  }
  if (m.working_memory) {
    out.workingMemory = {
      template: m.working_memory.template?.trimEnd(),
      scope: m.working_memory.scope,
    };
  }
  return out;
}

/** Parse and resolve a YAML Agent Builder project rooted at `rootDir`.
 *  Throws ParseError listing every problem found. */
export function parseProject(rootDir: string): ParsedProject {
  const issues: ParseIssue[] = [];
  const addIssue = (file: string, message: string) =>
    issues.push({ file, message });

  // 1. config.yaml — fatal if missing/invalid (nothing else is reachable).
  const rawConfig = readYaml(rootDir, 'config.yaml', addIssue);
  if (rawConfig === undefined) throw new ParseError(issues);

  const configResult = ConfigSchema.safeParse(rawConfig);
  if (!configResult.success) {
    addIssue('config.yaml', formatZodError(configResult.error));
    throw new ParseError(issues);
  }
  const config = configResult.data;

  // A repeated id in config.agents/config.workflows would emit duplicate imports
  // and a duplicate object key in the generated index.ts — a `tsc` failure in the
  // generated project rather than a clear error here. Reject it up front.
  const reportDuplicates = (field: string, ids: string[]): void => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) dupes.add(id);
      seen.add(id);
    }
    for (const id of [...dupes].sort()) {
      addIssue('config.yaml', `duplicate ${field}: \`${id}\` is listed more than once`);
    }
  };
  reportDuplicates('agent', config.agents);
  reportDuplicates('workflow', config.workflows);

  // 2. Resolve each agent (continue past errors to collect them all).
  const agents: ResolvedAgent[] = [];

  // Sub-agent references, captured for every schema-valid agent (even ones that
  // later fail prompt/model resolution), keyed by agent id.
  const subAgentRefs = new Map<string, string[]>();
  const agentWorkflowRefs = new Map<string, string[]>();
  const configAgentSet = new Set(config.agents);

  const hasMemoryConfig = config.memory !== undefined;
  for (const agentId of config.agents) {
    // Per-agent resolution (prompt/model/tools) lives in its own module; the
    // parser keeps the cross-agent passes (refs, cycles, collisions) below.
    const res = resolveAgent(agentId, { rootDir, hasMemoryConfig, addIssue });
    if (!res) continue;
    // Captured for every schema-valid agent, even ones that fail prompt/model
    // resolution, so their references are still validated and graphed.
    subAgentRefs.set(agentId, res.subAgentRefs);
    agentWorkflowRefs.set(agentId, res.workflowRefs);
    if (res.agent) agents.push(res.agent);
  }

  const memoryUsed = config.memory !== undefined || agents.some((a) => a.memory);
  if (memoryUsed && !config.storage) {
    addIssue('config.yaml', 'memory requires a `storage` block in config.yaml');
  }

  // Every referenced sub-agent must also be a declared agent in config.yaml.
  // Dedupe refs so a repeated id (e.g. `agents: [x, x]`) is reported once.
  for (const [parentId, refs] of subAgentRefs) {
    for (const ref of new Set(refs)) {
      if (!configAgentSet.has(ref)) {
        addIssue(
          `agent/${parentId}.yaml`,
          `sub-agent not found: ${ref} (must be listed in config.yaml agents)`,
        );
      }
    }
  }
  // Cycles (incl. self-reference) are permitted; flag the agents on a cycle so
  // codegen emits their `agents` field lazily.
  const cyclicNodes = findCyclicNodes(subAgentRefs);
  for (const agent of agents) {
    if (cyclicNodes.has(agent.id)) agent.lazyAgents = true;
  }

  // Workflows ---------------------------------------------------------------
  // Resolve each declared workflow; collect every problem (don't stop at first).
  const configWorkflowSet = new Set(config.workflows);
  const workflows: ResolvedWorkflow[] = [];

  for (const wfId of config.workflows) {
    const wfPath = `workflow/${wfId}.yaml`;
    const rawWf = readYaml(rootDir, wfPath, addIssue);
    if (rawWf === undefined) continue;

    const wfResult = WorkflowSchema.safeParse(rawWf);
    if (!wfResult.success) {
      addIssue(wfPath, formatZodError(wfResult.error));
      continue;
    }

    // Semantic resolution (step shapes, ref lookup, loop rules) lives in its own
    // module; the parser only handles file IO + schema validation.
    const resolved = resolveWorkflow(wfResult.data, wfId, { rootDir, configAgentSet, addIssue });
    if (resolved) workflows.push(resolved);
  }

  // Validate every attached workflow exists in config.workflows.
  for (const [parentId, refs] of agentWorkflowRefs) {
    for (const ref of new Set(refs)) {
      if (!configWorkflowSet.has(ref)) {
        addIssue(
          `agent/${parentId}.yaml`,
          `workflow not found: ${ref} (must be listed in config.yaml workflows)`,
        );
      }
    }
  }

  // Agent⇄workflow cycle detection. Build one graph over both node kinds
  // (namespaced a:/w: so an agent id and workflow id never collide): agents point
  // to their sub-agents AND attached workflows; workflows point to their agent
  // steps. An agent on a cycle here attaches its workflows lazily (off `mastra`)
  // so no agent⇄workflow import cycle forms. (Conservative: any agent on a cycle
  // with attachments is lazified — always safe, occasionally lazier than strictly
  // necessary, mirroring how `lazyAgents` works for sub-agent cycles.)
  const wfGraph = new Map<string, string[]>();
  for (const agent of agents) {
    wfGraph.set(`a:${agent.id}`, [
      ...agent.subAgents.map((s) => `a:${s.id}`),
      ...agent.workflows.map((w) => `w:${w.id}`),
    ]);
  }
  for (const wf of workflows) {
    wfGraph.set(`w:${wf.id}`, wf.agents.map((a) => `a:${a.id}`));
  }
  const wfCyclic = findCyclicNodes(wfGraph);
  for (const agent of agents) {
    if (agent.workflows.length > 0 && wfCyclic.has(`a:${agent.id}`)) {
      agent.lazyWorkflows = true;
    }
  }

  // Distinct ids that normalise to the same camelCase export name would emit
  // duplicate identifiers in the generated TypeScript (e.g. `research-agent`
  // and `research_agent` both -> `researchAgent`, or a tool id colliding with
  // an agent id). Catch these as parse issues instead of emitting code that
  // fails to compile. Each binding is keyed by source so the same id appearing
  // twice (a deduped import) is not mistaken for a collision.
  const reportCollisions = (
    file: string,
    bindings: { name: string; key: string }[],
  ): void => {
    const byName = new Map<string, Set<string>>();
    for (const { name, key } of bindings) {
      let keys = byName.get(name);
      if (!keys) byName.set(name, (keys = new Set()));
      keys.add(key);
    }
    for (const [name, keys] of byName) {
      if (keys.size > 1) {
        addIssue(
          file,
          `export name \`${name}\` is produced by multiple bindings (${[...keys].sort().join(', ')}); ids must yield distinct camelCase names`,
        );
      }
    }
  };
  // Project scope: every declared agent AND workflow is a top-level import in index.ts.
  reportCollisions('config.yaml', [
    ...config.agents.map((id) => ({ name: toExportName(id), key: `agent:${id}` })),
    ...config.workflows.map((id) => ({ name: toExportName(id), key: `workflow:${id}` })),
  ]);
  // Module scope: an agent file's own export, its tool imports, its sub-agent
  // imports, and the reserved imports the emitter always/conditionally adds
  // (`Agent` from @mastra/core, `memory` from utils) all share one identifier
  // namespace. A self-reference reuses the agent's own export (no import), so it
  // is excluded.
  for (const agent of agents) {
    reportCollisions(`agent/${agent.id}.yaml`, [
      { name: 'Agent', key: 'reserved:Agent' },
      ...(agent.memory ? [{ name: 'memory', key: 'reserved:memory' }] : []),
      { name: agent.exportName, key: `agent:${agent.id}` },
      ...agent.tools.map((t) => ({ name: t.exportName, key: `tool:${t.id}` })),
      ...agent.subAgents
        .filter((s) => s.id !== agent.id)
        .map((s) => ({ name: s.exportName, key: `agent:${s.id}` })),
      ...(agent.lazyWorkflows
        ? []
        : agent.workflows.map((w) => ({ name: w.exportName, key: `workflow:${w.id}` }))),
    ]);
  }

  // Module scope for each workflow file: its own export, its agent/tool imports,
  // and the reserved imports the emitter always adds.
  for (const wf of workflows) {
    reportCollisions(`workflow/${wf.id}.yaml`, [
      { name: 'createWorkflow', key: 'reserved:createWorkflow' },
      { name: 'createStep', key: 'reserved:createStep' },
      { name: 'z', key: 'reserved:z' },
      { name: wf.exportName, key: `workflow:${wf.id}` },
      ...wf.agents.map((a) => ({ name: a.exportName, key: `agent:${a.id}` })),
      ...wf.tools.map((t) => ({ name: t.exportName, key: `tool:${t.id}` })),
      ...wf.stepFiles.map((s) => ({ name: s.exportName, key: `step:${s.id}` })),
      ...wf.conditionFiles.map((c) => ({ name: c.exportName, key: `condition:${c.id}` })),
    ]);
  }

  if (issues.length > 0) throw new ParseError(issues);

  const memory =
    config.memory !== undefined && agents.some((a) => a.memory)
      ? resolveMemory(config.memory)
      : undefined;

  return {
    name: config.name,
    logger: { level: config.logger.level },
    storage: config.storage,
    memory,
    agents,
    workflows,
  };
}
