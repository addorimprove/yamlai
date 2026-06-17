import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { AgentSchema, ConfigSchema, ModelSchema, WorkflowSchema } from './schemas.js';
import { compileZodObject } from './zod-compile.js';
import type { MemoryInput } from './schemas.js';
import { ParseError, type ParseIssue } from './errors.js';
import { toExportName } from './naming.js';
import type {
  ParsedProject,
  ResolvedAgent,
  ResolvedMemory,
  ResolvedModel,
  ResolvedStepRef,
  ResolvedTool,
  ResolvedWorkflow,
  ResolvedWorkflowRef,
  ResolvedWorkflowStep,
} from './types.js';

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/** Returns the set of nodes that lie on a delegation cycle (including
 *  self-loops). Edges to nodes absent from the graph — unresolved/invalid
 *  references, reported elsewhere — are not followed. Cycles are allowed (Mastra
 *  exposes each sub-agent as a runtime tool, so recursion is bounded by the
 *  agent's step limit); these nodes only need their `agents` field emitted lazily
 *  to dodge ESM temporal-dead-zone / circular-import crashes at module load. */
function findCyclicNodes(graph: Map<string, string[]>): Set<string> {
  const cyclic = new Set<string>();
  for (const start of graph.keys()) {
    // Walk forward from `start`; if we ever reach `start` again it is on a cycle.
    const seen = new Set<string>();
    const stack = [...(graph.get(start) ?? [])];
    while (stack.length > 0) {
      const node = stack.pop() as string;
      if (node === start) {
        cyclic.add(start);
        break;
      }
      if (seen.has(node) || !graph.has(node)) continue;
      seen.add(node);
      for (const next of graph.get(node) ?? []) stack.push(next);
    }
  }
  return cyclic;
}

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

  // Returns undefined when an issue has been recorded and this file should be skipped.
  function readYaml(relPath: string): unknown {
    const abs = join(rootDir, relPath);
    if (!existsSync(abs)) {
      addIssue(relPath, 'file not found');
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = parseYaml(readFileSync(abs, 'utf8'));
    } catch (err) {
      addIssue(relPath, `invalid YAML: ${(err as Error).message}`);
      return undefined;
    }
    if (parsed === null || parsed === undefined) {
      addIssue(relPath, 'file is empty or contains only null');
      return undefined;
    }
    return parsed;
  }

  // Reads a raw text file (e.g. a prompt .md). Returns undefined (and records an
  // issue) when the file is missing or blank.
  function readText(relPath: string): string | undefined {
    const abs = join(rootDir, relPath);
    if (!existsSync(abs)) {
      addIssue(relPath, 'file not found');
      return undefined;
    }
    const content = readFileSync(abs, 'utf8');
    if (content.trim() === '') {
      addIssue(relPath, 'file is empty');
      return undefined;
    }
    return content;
  }

  // 1. config.yaml — fatal if missing/invalid (nothing else is reachable).
  const rawConfig = readYaml('config.yaml');
  if (rawConfig === undefined) throw new ParseError(issues);

  const configResult = ConfigSchema.safeParse(rawConfig);
  if (!configResult.success) {
    addIssue('config.yaml', formatZodError(configResult.error));
    throw new ParseError(issues);
  }
  const config = configResult.data;

  // 2-5. Resolve each agent (continue past errors to collect them all).
  const agents: ResolvedAgent[] = [];

  // Sub-agent references, captured for every schema-valid agent (even ones that
  // later fail prompt/model resolution), keyed by agent id.
  const subAgentRefs = new Map<string, string[]>();
  const agentWorkflowRefs = new Map<string, string[]>();
  const configAgentSet = new Set(config.agents);

  for (const agentId of config.agents) {
    const agentPath = `agent/${agentId}.yaml`;
    const rawAgent = readYaml(agentPath);
    if (rawAgent === undefined) continue;

    const agentResult = AgentSchema.safeParse(rawAgent);
    if (!agentResult.success) {
      addIssue(agentPath, formatZodError(agentResult.error));
      continue;
    }
    const agent = agentResult.data;
    subAgentRefs.set(agentId, agent.agents);
    agentWorkflowRefs.set(agentId, agent.workflows);

    // instructions: `instructions` is a prompt id referencing prompt/<id>.md.
    const promptPath = `prompt/${agent.instructions}.md`;
    const promptContent = readText(promptPath);
    const instructions =
      promptContent !== undefined ? promptContent.trimEnd() : undefined;

    // model
    const modelPath = `model/${agent.model}.yaml`;
    const rawModel = readYaml(modelPath);
    let resolvedModel: ResolvedModel | undefined;
    if (rawModel !== undefined) {
      const modelResult = ModelSchema.safeParse(rawModel);
      if (!modelResult.success) {
        addIssue(modelPath, formatZodError(modelResult.error));
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

    // tools
    const tools: ResolvedTool[] = [];
    for (const toolId of agent.tools) {
      const toolPath = `tools/${toolId}.ts`;
      if (!existsSync(join(rootDir, toolPath))) {
        addIssue(agentPath, `tool not found: ${toolPath}`);
        continue;
      }
      tools.push({
        id: toolId,
        filePath: toolPath,
        exportName: toExportName(toolId),
      });
    }

    // Only emit a fully-resolved agent; prompt/model issues are already recorded.
    if (instructions === undefined || !resolvedModel) continue;

    if (agent.memory && config.memory === undefined) {
      addIssue(agentPath, 'memory: true but config.yaml has no `memory:` block');
    }

    agents.push({
      id: agentId,
      name: agent.name,
      description: agent.description,
      instructions,
      model: resolvedModel,
      tools,
      subAgents: agent.agents.map((id) => ({ id, exportName: toExportName(id) })),
      lazyAgents: false, // set below once the full sub-agent graph is known
      workflows: agent.workflows.map((id) => ({ id, exportName: toExportName(id) })),
      lazyWorkflows: false, // set in Phase C
      memory: agent.memory,
    });
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
    const rawWf = readYaml(wfPath);
    if (rawWf === undefined) continue;

    const wfResult = WorkflowSchema.safeParse(rawWf);
    if (!wfResult.success) {
      addIssue(wfPath, formatZodError(wfResult.error));
      continue;
    }
    const wf = wfResult.data;

    const agentRefs: ResolvedWorkflowRef[] = [];
    const toolRefs: ResolvedTool[] = [];
    const stepFileRefs: ResolvedTool[] = [];
    let ok = true;

    // Resolve one leaf (agent | tool | step), recording refs for imports. Returns
    // undefined and records an issue on any problem.
    const resolveLeaf = (
      node: { agent?: string; tool?: string; step?: string },
      where: string,
    ): ResolvedStepRef | undefined => {
      const kinds = [
        node.agent !== undefined ? 'agent' : null,
        node.tool !== undefined ? 'tool' : null,
        node.step !== undefined ? 'step' : null,
      ].filter(Boolean);
      if (kinds.length !== 1) {
        addIssue(wfPath, `${where} must have exactly one of \`agent:\`, \`tool:\`, or \`step:\``);
        return undefined;
      }
      if (node.agent !== undefined) {
        const id = node.agent;
        if (!configAgentSet.has(id)) {
          addIssue(wfPath, `agent not found: ${id} (must be listed in config.yaml agents)`);
          return undefined;
        }
        const exportName = toExportName(id);
        if (!agentRefs.some((a) => a.id === id)) agentRefs.push({ id, exportName });
        return { kind: 'agent', id, exportName };
      }
      if (node.tool !== undefined) {
        const id = node.tool;
        const toolPath = `tools/${id}.ts`;
        if (!existsSync(join(rootDir, toolPath))) {
          addIssue(wfPath, `tool not found: ${toolPath}`);
          return undefined;
        }
        const exportName = toExportName(id);
        if (!toolRefs.some((t) => t.id === id)) {
          toolRefs.push({ id, filePath: toolPath, exportName });
        }
        return { kind: 'tool', id, exportName };
      }
      const id = node.step!;
      const stepPath = `step/${id}.ts`;
      if (!existsSync(join(rootDir, stepPath))) {
        addIssue(wfPath, `step not found: ${stepPath}`);
        return undefined;
      }
      const exportName = toExportName(id);
      if (!stepFileRefs.some((s) => s.id === id)) {
        stepFileRefs.push({ id, filePath: stepPath, exportName });
      }
      return { kind: 'step', id, exportName };
    };

    const resolvedSteps: ResolvedWorkflowStep[] = [];
    for (const [i, step] of wf.steps.entries()) {
      const hasParallel = Array.isArray(step.parallel);
      const hasAgent = typeof step.agent === 'string';
      const hasTool = typeof step.tool === 'string';
      const hasStep = typeof step.step === 'string';
      if ((hasParallel ? 1 : 0) + (hasAgent ? 1 : 0) + (hasTool ? 1 : 0) + (hasStep ? 1 : 0) !== 1) {
        addIssue(wfPath, `step ${i + 1} must have exactly one of \`agent:\`, \`tool:\`, \`step:\`, or \`parallel:\``);
        ok = false;
        continue;
      }
      if (hasParallel) {
        const kids = step.parallel as { agent?: string; tool?: string; step?: string }[];
        if (kids.length < 2) {
          addIssue(wfPath, `step ${i + 1}: \`parallel\` needs at least 2 steps (use a plain step otherwise)`);
          ok = false;
          continue;
        }
        const resolvedKids: ResolvedStepRef[] = [];
        for (const [j, kid] of kids.entries()) {
          const c = resolveLeaf(kid, `step ${i + 1} parallel child ${j + 1}`);
          if (!c) ok = false;
          else resolvedKids.push(c);
        }
        // Mastra keys parallel results by step id (the agent/tool id). Two children
        // with the same id would silently overwrite each other (and both still run),
        // so reject duplicates here rather than emit code that loses a result.
        const dupes = new Set<string>();
        const seenKids = new Set<string>();
        for (const c of resolvedKids) {
          if (seenKids.has(c.id)) dupes.add(c.id);
          seenKids.add(c.id);
        }
        for (const id of dupes) {
          addIssue(wfPath, `step ${i + 1}: \`parallel\` has duplicate step \`${id}\` — each parallel child must be a distinct agent/tool`);
          ok = false;
        }
        if (resolvedKids.length === kids.length && dupes.size === 0) {
          resolvedSteps.push({ kind: 'parallel', children: resolvedKids });
        }
      } else {
        const ref = resolveLeaf(step, `step ${i + 1}`);
        if (!ref) ok = false;
        else resolvedSteps.push({ kind: ref.kind, ref });
      }
    }

    const inCompiled = compileZodObject(wf.input as Record<string, unknown>);
    const outCompiled = compileZodObject(wf.output as Record<string, unknown>);
    for (const e of inCompiled.errors) addIssue(wfPath, `input.${e}`);
    for (const e of outCompiled.errors) addIssue(wfPath, `output.${e}`);

    if (!ok || inCompiled.errors.length || outCompiled.errors.length) continue;

    workflows.push({
      id: wfId,
      description: wf.description,
      exportName: toExportName(wfId),
      inputZod: inCompiled.expr,
      outputZod: outCompiled.expr,
      steps: resolvedSteps,
      agents: agentRefs,
      tools: toolRefs,
      stepFiles: stepFileRefs,
    });
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
      { name: toExportName(agent.id), key: `agent:${agent.id}` },
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
