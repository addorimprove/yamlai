import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Merge tool: after `.parallel([...])` the input is ONE object keyed by each
// parallel step's id. Mastra types that as a record (index signature) keyed by
// string with the common child-output shape, so the inputSchema must be a
// `z.record(...)` (an exact-keys `z.object` fails to typecheck under strict).
export const mergeDrafts = createTool({
  id: 'merge-drafts',
  description: 'Combine the writer and editor drafts into one comparison.',
  inputSchema: z.record(z.string(), z.object({ text: z.string() })),
  outputSchema: z.object({ comparison: z.string() }),
  execute: async (inputData) => ({
    comparison: [
      `Writer: ${inputData['writer-agent'].text}`,
      `Editor: ${inputData['editor-agent'].text}`,
    ].join('\n\n'),
  }),
});
