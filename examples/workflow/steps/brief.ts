import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

// Glue step: reshape the writer's { text } into the { prompt } the editor reads.
// Authored as a step (not a tool) so `execute`'s input is type-checked against inputSchema.
export const brief = createStep({
  id: 'brief',
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ prompt: z.string() }),
  execute: async ({ inputData }) => ({
    prompt: `Revise this draft for clarity and flow:\n\n${inputData.text}`,
  }),
});
