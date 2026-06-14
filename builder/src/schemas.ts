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

export const SemanticRecallSchema = z.object({
  embedder: z.string().min(1),
  top_k: z.number().int().positive().default(4),
  message_range: MessageRangeSchema.default({ before: 1, after: 1 }),
  scope: ScopeSchema.optional(),
});

export const WorkingMemorySchema = z.preprocess(
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
  memory: z.boolean().default(false),
});

export const ModelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
});

export type ConfigInput = z.infer<typeof ConfigSchema>;
export type AgentInput = z.infer<typeof AgentSchema>;
export type ModelInput = z.infer<typeof ModelSchema>;
export type MemoryInput = z.infer<typeof MemorySchema>;
