import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const echoTool = createTool({
  id: 'echo-tool',
  description: 'Echoes the input text back.',
  inputSchema: z.object({
    text: z.string().describe('Text to echo back'),
  }),
  outputSchema: z.object({
    text: z.string(),
  }),
  execute: async (inputData) => {
    return { text: inputData.text };
  },
});
