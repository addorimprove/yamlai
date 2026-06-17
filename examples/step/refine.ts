import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

// Body of a refine loop: nudge the draft and bump its score by one.
export const refine = createStep({
  id: 'refine',
  inputSchema: z.object({ text: z.string(), score: z.number() }),
  outputSchema: z.object({ text: z.string(), score: z.number() }),
  execute: async ({ inputData }) => ({ text: inputData.text + '.', score: inputData.score + 1 }),
});
