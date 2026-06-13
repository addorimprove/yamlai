import { z } from 'zod';

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

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
});

export const AgentSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  instructions: z.string().min(1),
  model: z.string().min(1),
  tools: z.array(z.string().min(1)).default([]),
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
