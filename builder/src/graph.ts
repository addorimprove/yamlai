/** Returns the set of nodes that lie on a directed cycle (including self-loops).
 *  Edges to nodes absent from the graph — unresolved/invalid references, reported
 *  elsewhere — are not followed, so a partial graph never crashes the walk.
 *
 *  Used to find delegation cycles (sub-agent or agent⇄workflow): a node on a
 *  cycle must emit its cyclic field lazily to dodge ESM temporal-dead-zone /
 *  circular-import crashes at module load. */
export function findCyclicNodes(graph: Map<string, string[]>): Set<string> {
  const cyclic = new Set<string>();
  for (const start of graph.keys()) {
    // Walk forward from `start`; if we ever reach `start` again it is on a cycle.
    const seen = new Set<string>();
    const stack = [...(graph.get(start) ?? [])];
    while (stack.length > 0) {
      const node = stack.pop() as string;
      if (node === start) {
        cyclic.add(start);
        break;
      }
      if (seen.has(node) || !graph.has(node)) continue;
      seen.add(node);
      for (const next of graph.get(node) ?? []) stack.push(next);
    }
  }
  return cyclic;
}
