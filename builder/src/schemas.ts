import { z } from 'zod';

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

export const ScopeSchema = z.enum(['thread', 'resource']);

const MessageRangeSchema = z.union([
  z.number().int().positive(),
  z.object({
    before: z.number().int().min(0),
    after: z.number().int().min(0),
  }).strict(),
]);

const SemanticRecallSchema = z.object({
  embedder: z.string().min(1),
  top_k: z.number().int().positive().default(4),
  message_range: MessageRangeSchema.default({ before: 1, after: 1 }),
  scope: ScopeSchema.optional(),
}).strict();

const WorkingMemorySchema = z.preprocess(
  (v) => (v === null ? {} : v),
  z.object({
    template: z.string().min(1).optional(),
    scope: ScopeSchema.optional(),
  }).strict(),
);

export const MemorySchema = z.preprocess(
  (v) => (v === null ? {} : v),
  z.object({
    last_messages: z.number().int().positive().optional(),
    semantic_recall: SemanticRecallSchema.optional(),
    working_memory: WorkingMemorySchema.optional(),
  }).strict(),
);

export const ConfigSchema = z.object({
  name: z.string().min(1),
  agents: z.array(z.string().min(1)).min(1),
  workflows: z.array(z.string().min(1)).default([]),
  logger: z
    .object({ level: LogLevelSchema.default('info') })
    .strict()
    .default({ level: 'info' }),
  storage: z
    .object({
      type: z.literal('libsql'),
      url: z.string().min(1),
    })
    .strict()
    .optional(),
  memory: MemorySchema.optional(),
}).strict();

export const AgentSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  instructions: z.string().min(1),
  model: z.string().min(1),
  tools: z.array(z.string().min(1)).default([]),
  agents: z.array(z.string().min(1)).default([]),
  workflows: z.array(z.string().min(1)).default([]),
  memory: z.boolean().default(false),
}).strict();

export const ModelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
}).strict();

const WorkflowLeafSchema = z.object({
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
}).strict();

const LoopSchema = z.object({
  until: z.string().min(1).optional(),
  while: z.string().min(1).optional(),
  foreach: z.boolean().optional(),
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
  steps: z.array(WorkflowLeafSchema).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  max_iterations: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().optional(),
}).strict();

const WorkflowStepSchema = z.object({
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
  parallel: z.array(WorkflowLeafSchema).optional(),
  loop: LoopSchema.optional(),
}).strict();

export const WorkflowSchema = z.object({
  description: z.string().default(''),
  input: z.record(z.string(), z.unknown()).default({}),
  output: z.record(z.string(), z.unknown()).default({}),
  steps: z.array(WorkflowStepSchema).min(1),
}).strict();

export type ConfigInput = z.infer<typeof ConfigSchema>;
export type AgentInput = z.infer<typeof AgentSchema>;
export type ModelInput = z.infer<typeof ModelSchema>;
export type MemoryInput = z.infer<typeof MemorySchema>;
export type WorkflowInput = z.infer<typeof WorkflowSchema>;
export type WorkflowStepInput = z.infer<typeof WorkflowStepSchema>;
export type WorkflowLeafInput = z.infer<typeof WorkflowLeafSchema>;
export type LoopInput = z.infer<typeof LoopSchema>;
