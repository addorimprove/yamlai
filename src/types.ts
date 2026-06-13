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

export interface ResolvedAgent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model: ResolvedModel;
  tools: ResolvedTool[];
}

export interface ParsedProject {
  name: string;
  logger: { level: LogLevel };
  storage?: { type: 'libsql'; url: string };
  agents: ResolvedAgent[];
}
