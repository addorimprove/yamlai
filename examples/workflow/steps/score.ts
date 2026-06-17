import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

// Second stage of the multi-step loop body: a distinct step id from `refine`
// (each step in a nested-workflow chain must have a unique id).
export const score = createStep({
  id: 'score',
  inputSchema: z.object({ text: z.string(), score: z.number() }),
  outputSchema: z.object({ text: z.string(), score: z.number() }),
  execute: async ({ inputData }) => ({ text: inputData.text, score: inputData.score + 1 }),
});
