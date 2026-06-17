export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** A reference to a source file copied verbatim into the generated project —
 *  a tool, a custom step, or a loop-condition predicate. */
export interface ResolvedFileRef {
  id: string;
  /** Path relative to rootDir, e.g. "tools/echo-tool.ts". */
  filePath: string;
  /** camelCase export variable name, e.g. "echoTool". */
  exportName: string;
}

/** A tool referenced by an agent or workflow. */
export type ResolvedTool = ResolvedFileRef;

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

/** A reference to an attached workflow (agent.workflows) or a step target. */
export interface ResolvedWorkflowRef {
  id: string;
  /** camelCase export variable name, e.g. "researchFlow". */
  exportName: string;
}

/** A leaf step target inside a workflow (an agent, a tool, or a custom step). */
export interface ResolvedStepRef {
  kind: 'agent' | 'tool' | 'step';
  id: string;
  exportName: string;
}

/** A loop body: one leaf, or an inline nested-workflow sequence. */
export type ResolvedLoopBody =
  | { kind: 'leaf'; ref: ResolvedStepRef }
  | {
      kind: 'sequence';
      /** Synthetic nested-workflow id, e.g. "refine-loop-loop-2". */
      id: string;
      /** `z.object({...})` source for the nested workflow's input/output. */
      inputZod: string;
      outputZod: string;
      steps: ResolvedStepRef[];
    };

/** A resolved loop step: a body driven by dountil/dowhile/foreach. */
export interface ResolvedLoop {
  loopKind: 'dountil' | 'dowhile' | 'foreach';
  body: ResolvedLoopBody;
  /** Predicate file for dountil/dowhile; absent for foreach and pure-count loops. */
  condition?: ResolvedFileRef;
  /** Iteration guard for dountil/dowhile/pure-count. */
  maxIterations?: number;
  /** Parallelism for foreach. */
  concurrency?: number;
}

/** One workflow step: a single agent/tool/step, a parallel block, or a loop. */
export interface ResolvedWorkflowStep {
  kind: 'agent' | 'tool' | 'step' | 'parallel' | 'loop';
  /** Set when kind is 'agent' | 'tool' | 'step'. */
  ref?: ResolvedStepRef;
  /** Set when kind is 'parallel' (always length >= 2). */
  children?: ResolvedStepRef[];
  /** Set when kind is 'loop'. */
  loop?: ResolvedLoop;
}

export interface ResolvedWorkflow {
  id: string;
  description: string;
  /** camelCase export variable name, e.g. "researchFlow". */
  exportName: string;
  /** `z.object({...})` source expression for the workflow input/output. */
  inputZod: string;
  outputZod: string;
  steps: ResolvedWorkflowStep[];
  /** Distinct agents referenced anywhere in this workflow, in first-seen order (for imports). */
  agents: ResolvedWorkflowRef[];
  /** Distinct tools referenced anywhere in this workflow, in first-seen order (for imports + copy). */
  tools: ResolvedTool[];
  /** Distinct custom steps referenced in this workflow, first-seen order (for imports + verbatim copy). */
  stepFiles: ResolvedFileRef[];
  /** Distinct condition predicates referenced by loops, first-seen order (imports + verbatim copy). */
  conditionFiles: ResolvedFileRef[];
}

export interface ResolvedAgent {
  id: string;
  /** camelCase export variable name, e.g. "supportAgent". */
  exportName: string;
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
  /** Workflows attached to this agent (from its `workflows:` list). */
  workflows: ResolvedWorkflowRef[];
  /** True when an attached workflow lies on an agent⇄workflow cycle back to this
   *  agent. Such agents reference their workflows off the `mastra` instance
   *  (`mastra.getWorkflow(id)`) instead of importing them, so no import cycle forms. */
  lazyWorkflows: boolean;
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
  workflows: ResolvedWorkflow[];
}
