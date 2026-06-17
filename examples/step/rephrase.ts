import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

// Glue step: reshape a research agent's { text } into the { prompt } the support agent reads.
// Authored as a step (not a tool) so `execute`'s input is type-checked against inputSchema.
export const rephrase = createStep({
  id: 'rephrase',
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ prompt: z.string() }),
  execute: async ({ inputData }) => ({
    prompt: `Using these research notes, answer the user clearly:\n\n${inputData.text}`,
  }),
});
