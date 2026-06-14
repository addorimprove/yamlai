import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { AgentSchema, ConfigSchema, ModelSchema } from './schemas.js';
import type { MemoryInput } from './schemas.js';
import { ParseError, type ParseIssue } from './errors.js';
import { toExportName } from './naming.js';
import type {
  ParsedProject,
  ResolvedAgent,
  ResolvedMemory,
  ResolvedModel,
  ResolvedTool,
} from './types.js';

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/** Returns a cycle path (e.g. ['a','b','a']) if the sub-agent graph contains one,
 *  else null. Only edges to nodes present in the graph are followed; references to
 *  agents missing a ref-list are validated separately. Detects self-references. */
function detectSubAgentCycle(graph: Map<string, string[]>): string[] | null {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  function visit(node: string): string[] | null {
    color.set(node, GREY);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue; // invalid/unresolved ref — reported elsewhere
      const c = color.get(next) ?? WHITE;
      if (c === GREY) {
        return [...stack.slice(stack.indexOf(next)), next];
      }
      if (c === WHITE) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  }

  for (const node of graph.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
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
      memory: agent.memory,
    });
  }

  const memoryUsed = config.memory !== undefined || agents.some((a) => a.memory);
  if (memoryUsed && !config.storage) {
    addIssue('config.yaml', 'memory requires a `storage` block in config.yaml');
  }

  // Every referenced sub-agent must also be a declared agent in config.yaml.
  for (const [parentId, refs] of subAgentRefs) {
    for (const ref of refs) {
      if (!configAgentSet.has(ref)) {
        addIssue(
          `agent/${parentId}.yaml`,
          `sub-agent not found: ${ref} (must be listed in config.yaml agents)`,
        );
      }
    }
  }
  const cycle = detectSubAgentCycle(subAgentRefs);
  if (cycle) {
    addIssue(
      `agent/${cycle[0]}.yaml`,
      `circular sub-agent reference: ${cycle.join(' -> ')}`,
    );
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
  };
}
