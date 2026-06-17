// Loop predicate (Mastra LoopConditionFunction): receives the body's output as
// `inputData` plus the engine's `iterationCount`. Stop refining once the score is
// high enough. Copied verbatim into src/mastra/workflows/condition/.
export const goodEnough = async ({
  inputData,
}: {
  inputData: { text: string; score: number };
  iterationCount: number;
}) => inputData.score >= 3;
