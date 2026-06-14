export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ResolvedTool {
  id: string;
  /** Path relative to rootDir, e.g. "tools/echo-tool.ts". */
  filePath: string;
  /** camelCase export variable name, e.g. "echoTool". */
  exportName: string;
}

export interface ResolvedModel {
  id: string;
  provider: string;
  model: string;
  /** `${provider}/${model}` — the Mastra Model Router string. */
  routerString: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ResolvedSemanticRecall {
  /** `${provider}/${model}` embedder router string. */
  embedder: string;
  topK: number;
  messageRange: number | { before: number; after: number };
  scope?: 'thread' | 'resource';
}

export interface ResolvedWorkingMemory {
  template?: string;
  scope?: 'thread' | 'resource';
}

export interface ResolvedMemory {
  lastMessages?: number;
  semanticRecall?: ResolvedSemanticRecall;
  workingMemory?: ResolvedWorkingMemory;
}

export interface ResolvedSubAgent {
  id: string;
  /** camelCase export variable name, e.g. "researchAgent". */
  exportName: string;
}

export interface ResolvedAgent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model: ResolvedModel;
  tools: ResolvedTool[];
  /** Agents this agent can delegate to (referenced from its `agents:` list). */
  subAgents: ResolvedSubAgent[];
  /** True when this agent sits on a delegation cycle (incl. a self-reference).
   *  Such agents must emit their `agents` field as a thunk to avoid ESM
   *  temporal-dead-zone / circular-import crashes at module load. */
  lazyAgents: boolean;
  /** Whether this agent imports the shared project memory. */
  memory: boolean;
}

export interface ParsedProject {
  name: string;
  logger: { level: LogLevel };
  storage?: { type: 'libsql'; url: string };
  /** The single project-wide memory config, present only when defined AND used. */
  memory?: ResolvedMemory;
  agents: ResolvedAgent[];
}
