import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Merge tool: after `.parallel([...])` the input is ONE object keyed by each
// parallel step's id, so this tool's inputSchema mirrors that keyed shape.
export const mergeAnswers = createTool({
  id: 'merge-answers',
  description: 'Combine the research and support answers into one comparison.',
  inputSchema: z.object({
    'research-agent': z.object({ text: z.string() }),
    'support-agent': z.object({ text: z.string() }),
  }),
  outputSchema: z.object({ comparison: z.string() }),
  execute: async (inputData) => ({
    comparison: [
      `Research: ${inputData['research-agent'].text}`,
      `Support:  ${inputData['support-agent'].text}`,
    ].join('\n\n'),
  }),
});
