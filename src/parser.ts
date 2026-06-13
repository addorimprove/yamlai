import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { AgentSchema, ConfigSchema, ModelSchema } from './schemas.js';
import { ParseError, type ParseIssue } from './errors.js';
import { toExportName } from './naming.js';
import type {
  ParsedProject,
  ResolvedAgent,
  ResolvedModel,
  ResolvedTool,
} from './types.js';

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/** Parse and resolve a YAML Agent Builder project rooted at `rootDir`.
 *  Throws ParseError listing every problem found. */
export function parseProject(rootDir: string): ParsedProject {
  const issues: ParseIssue[] = [];
  const addIssue = (file: string, message: string) =>
    issues.push({ file, message });

  function readYaml(relPath: string): unknown | undefined {
    const abs = join(rootDir, relPath);
    if (!existsSync(abs)) {
      addIssue(relPath, 'file not found');
      return undefined;
    }
    try {
      return parseYaml(readFileSync(abs, 'utf8'));
    } catch (err) {
      addIssue(relPath, `invalid YAML: ${(err as Error).message}`);
      return undefined;
    }
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

    // Only emit a fully-resolved agent; model issues are already recorded.
    if (!resolvedModel) continue;

    agents.push({
      id: agentId,
      name: agent.name,
      description: agent.description,
      instructions: agent.instructions,
      model: resolvedModel,
      tools,
    });
  }

  if (issues.length > 0) throw new ParseError(issues);

  return {
    name: config.name,
    logger: { level: config.logger.level },
    storage: config.storage,
    agents,
  };
}
