import { z } from 'zod';

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

export const ScopeSchema = z.enum(['thread', 'resource']);

const MessageRangeSchema = z.union([
  z.number().int().positive(),
  z.object({
    before: z.number().int().min(0),
    after: z.number().int().min(0),
  }),
]);

const SemanticRecallSchema = z.object({
  embedder: z.string().min(1),
  top_k: z.number().int().positive().default(4),
  message_range: MessageRangeSchema.default({ before: 1, after: 1 }),
  scope: ScopeSchema.optional(),
});

const WorkingMemorySchema = z.preprocess(
  (v) => (v === null ? {} : v),
  z.object({
    template: z.string().min(1).optional(),
    scope: ScopeSchema.optional(),
  }),
);

export const MemorySchema = z.preprocess(
  (v) => (v === null ? {} : v),
  z.object({
    last_messages: z.number().int().positive().optional(),
    semantic_recall: SemanticRecallSchema.optional(),
    working_memory: WorkingMemorySchema.optional(),
  }),
);

export const ConfigSchema = z.object({
  name: z.string().min(1),
  agents: z.array(z.string().min(1)).min(1),
  workflows: z.array(z.string().min(1)).default([]),
  logger: z
    .object({ level: LogLevelSchema.default('info') })
    .default({ level: 'info' }),
  storage: z
    .object({
      type: z.literal('libsql'),
      url: z.string().min(1),
    })
    .optional(),
  memory: MemorySchema.optional(),
});

export const AgentSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  // Prompt id: references prompt/<instructions>.md (like `model` -> model/<id>.yaml).
  instructions: z.string().min(1),
  model: z.string().min(1),
  tools: z.array(z.string().min(1)).default([]),
  agents: z.array(z.string().min(1)).default([]),
  workflows: z.array(z.string().min(1)).default([]),
  memory: z.boolean().default(false),
});

export const ModelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
});

// A single workflow step: exactly one of agent/tool/step/parallel — enforced in
// the parser (so the message is aggregated into ParseError, not a raw Zod union
// error). `input`/`output` are raw primitive-field maps compiled by zod-compile.ts.
const WorkflowLeafSchema = z.object({
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
});

// A loop wraps a body (single leaf OR a `steps:` sequence) with a driver
// (until/while/foreach/max_iterations). Exactly-one-of rules enforced in the parser.
const LoopSchema = z.object({
  until: z.string().min(1).optional(),
  while: z.string().min(1).optional(),
  foreach: z.boolean().optional(),
  // single-leaf body:
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
  // multi-step body (requires input/output):
  steps: z.array(WorkflowLeafSchema).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  // guards:
  max_iterations: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().optional(),
});

const WorkflowStepSchema = z.object({
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
  parallel: z.array(WorkflowLeafSchema).optional(),
  loop: LoopSchema.optional(),
});

export const WorkflowSchema = z.object({
  // No `name`: Mastra workflows are identified by `id` (the filename) and only
  // carry an optional `description`. A `name:` left in the YAML is ignored.
  description: z.string().default(''),
  input: z.record(z.string(), z.unknown()).default({}),
  output: z.record(z.string(), z.unknown()).default({}),
  steps: z.array(WorkflowStepSchema).min(1),
});

export type ConfigInput = z.infer<typeof ConfigSchema>;
export type AgentInput = z.infer<typeof AgentSchema>;
export type ModelInput = z.infer<typeof ModelSchema>;
export type MemoryInput = z.infer<typeof MemorySchema>;
export type WorkflowInput = z.infer<typeof WorkflowSchema>;
