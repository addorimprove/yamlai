import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Glue tool: reshape a research agent's { text } into the { prompt } the next agent reads.
// Tools double as the shaping/merge units in v1 (no separate `step/` resource yet).
export const rephrase = createTool({
  id: 'rephrase',
  description: 'Turn research notes into a prompt for the support agent.',
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ prompt: z.string() }),
  execute: async (inputData) => ({
    prompt: `Using these research notes, answer the user clearly:\n\n${inputData.text}`,
  }),
});
