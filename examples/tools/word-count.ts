import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const wordCount = createTool({
  id: 'word-count',
  description: 'Counts the words in the given text.',
  inputSchema: z.object({
    text: z.string().describe('Text to count words in'),
  }),
  outputSchema: z.object({
    words: z.number(),
  }),
  execute: async (inputData) => {
    return { words: inputData.text.trim().split(/\s+/).filter(Boolean).length };
  },
});
