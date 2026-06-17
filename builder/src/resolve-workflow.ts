import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { compileZodObject } from './zod-compile.js';
import { fileExportsName } from './read.js';
import { invalidExportIdReason, toExportName } from './naming.js';
import type { LoopInput, WorkflowInput, WorkflowLeafInput, WorkflowStepInput } from './schemas.js';
import type {
  ResolvedFileRef,
  ResolvedLoop,
  ResolvedLoopBody,
  ResolvedStepRef,
  ResolvedTool,
  ResolvedWorkflow,
  ResolvedWorkflowRef,
  ResolvedWorkflowStep,
} from './types.js';

/** What the resolver needs from its caller: where files live, which agent ids
 *  are declared, and a sink for problems. */
export interface ResolveContext {
  rootDir: string;
  configAgentSet: Set<string>;
  addIssue: (file: string, message: string) => void;
}

/** Resolve one schema-valid workflow into a ResolvedWorkflow, or undefined if it
 *  has any problem (each problem is recorded via ctx.addIssue). */
export function resolveWorkflow(
  wf: WorkflowInput,
  wfId: string,
  ctx: ResolveContext,
): ResolvedWorkflow | undefined {
  return new WorkflowResolver(wf, wfId, ctx).resolve();
}

/** Accumulates the import/copy ref lists for a single workflow while walking its
 *  steps. One instance per workflow; not reused. */
class WorkflowResolver {
  private readonly wfPath: string;
  private readonly agentRefs: ResolvedWorkflowRef[] = [];
  private readonly toolRefs: ResolvedTool[] = [];
  private readonly stepFileRefs: ResolvedFileRef[] = [];
  private readonly conditionFileRefs: ResolvedFileRef[] = [];
  private ok = true;

  constructor(
    private readonly wf: WorkflowInput,
    private readonly wfId: string,
    private readonly ctx: ResolveContext,
  ) {
    this.wfPath = `workflow/${wfId}.yaml`;
  }

  resolve(): ResolvedWorkflow | undefined {
    const steps: ResolvedWorkflowStep[] = [];
    for (const [i, step] of this.wf.steps.entries()) {
      const resolved = this.resolveStep(step, i);
      if (resolved) steps.push(resolved);
    }

    const inCompiled = compileZodObject(this.wf.input as Record<string, unknown>);
    const outCompiled = compileZodObject(this.wf.output as Record<string, unknown>);
    for (const e of inCompiled.errors) this.issue(`input.${e}`);
    for (const e of outCompiled.errors) this.issue(`output.${e}`);

    if (!this.ok || inCompiled.errors.length || outCompiled.errors.length) return undefined;

    return {
      id: this.wfId,
      description: this.wf.description,
      exportName: toExportName(this.wfId),
      inputZod: inCompiled.expr,
      outputZod: outCompiled.expr,
      steps,
      agents: this.agentRefs,
      tools: this.toolRefs,
      stepFiles: this.stepFileRefs,
      conditionFiles: this.conditionFileRefs,
    };
  }

  private issue(message: string): void {
    this.ctx.addIssue(this.wfPath, message);
  }

  /** Record a problem and mark this workflow unresolvable. */
  private fail(message: string): void {
    this.issue(message);
    this.ok = false;
  }

  /** Dispatch one top-level step to the matching resolver (exactly one shape). */
  private resolveStep(step: WorkflowStepInput, i: number): ResolvedWorkflowStep | undefined {
    const shapes =
      (Array.isArray(step.parallel) ? 1 : 0) +
      (typeof step.agent === 'string' ? 1 : 0) +
      (typeof step.tool === 'string' ? 1 : 0) +
      (typeof step.step === 'string' ? 1 : 0) +
      (step.loop !== undefined && step.loop !== null ? 1 : 0);
    if (shapes !== 1) {
      this.fail(`step ${i + 1} must have exactly one of \`agent:\`, \`tool:\`, \`step:\`, \`parallel:\`, or \`loop:\``);
      return undefined;
    }

    if (Array.isArray(step.parallel)) return this.resolveParallel(step.parallel, i);
    if (step.loop !== undefined && step.loop !== null) {
      const loop = this.resolveLoop(step.loop, i);
      return loop ? { kind: 'loop', loop } : undefined;
    }
    const ref = this.resolveLeaf(step, `step ${i + 1}`);
    if (!ref) {
      this.ok = false;
      return undefined;
    }
    return { kind: ref.kind, ref };
  }

  /** Resolve one leaf (agent | tool | step), recording its ref for imports/copy.
   *  Returns undefined and records an issue on any problem. */
  private resolveLeaf(node: WorkflowLeafInput, where: string): ResolvedStepRef | undefined {
    const kinds = [
      node.agent !== undefined ? 'agent' : null,
      node.tool !== undefined ? 'tool' : null,
      node.step !== undefined ? 'step' : null,
    ].filter(Boolean);
    if (kinds.length !== 1) {
      this.issue(`${where} must have exactly one of \`agent:\`, \`tool:\`, or \`step:\``);
      return undefined;
    }

    if (node.agent !== undefined) {
      const id = node.agent;
      if (!this.ctx.configAgentSet.has(id)) {
        this.issue(`agent not found: ${id} (must be listed in config.yaml agents)`);
        return undefined;
      }
      const exportName = toExportName(id);
      if (!this.agentRefs.some((a) => a.id === id)) this.agentRefs.push({ id, exportName });
      return { kind: 'agent', id, exportName };
    }
    if (node.tool !== undefined) {
      const id = node.tool;
      const filePath = `tools/${id}.ts`;
      const exportName = this.resolveFileExport(id, filePath, 'tool');
      if (!exportName) return undefined;
      if (!this.toolRefs.some((t) => t.id === id)) this.toolRefs.push({ id, filePath, exportName });
      return { kind: 'tool', id, exportName };
    }
    const id = node.step!;
    const filePath = `workflow/steps/${id}.ts`;
    const exportName = this.resolveFileExport(id, filePath, 'step');
    if (!exportName) return undefined;
    if (!this.stepFileRefs.some((s) => s.id === id)) this.stepFileRefs.push({ id, filePath, exportName });
    return { kind: 'step', id, exportName };
  }

  private resolveParallel(kids: WorkflowLeafInput[], i: number): ResolvedWorkflowStep | undefined {
    if (kids.length < 2) {
      this.fail(`step ${i + 1}: \`parallel\` needs at least 2 steps (use a plain step otherwise)`);
      return undefined;
    }
    const children: ResolvedStepRef[] = [];
    for (const [j, kid] of kids.entries()) {
      const c = this.resolveLeaf(kid, `step ${i + 1} parallel child ${j + 1}`);
      if (!c) this.ok = false;
      else children.push(c);
    }
    // Mastra keys parallel results by step id (the agent/tool id). Two children
    // with the same id would silently overwrite each other (and both still run),
    // so reject duplicates here rather than emit code that loses a result.
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const c of children) {
      if (seen.has(c.id)) dupes.add(c.id);
      seen.add(c.id);
    }
    for (const id of dupes) {
      this.fail(`step ${i + 1}: \`parallel\` has duplicate step \`${id}\` — each parallel child must be a distinct agent/tool`);
    }
    if (children.length === kids.length && dupes.size === 0) {
      return { kind: 'parallel', children };
    }
    return undefined;
  }

  private resolveLoop(lp: LoopInput, i: number): ResolvedLoop | undefined {
    const n = i + 1;

    // --- driver (at most one of until/while/foreach; a pure-count loop needs max_iterations) ---
    const drivers = [
      lp.until !== undefined ? 'until' : null,
      lp.while !== undefined ? 'while' : null,
      lp.foreach !== undefined ? 'foreach' : null,
    ].filter(Boolean);
    if (drivers.length > 1) {
      this.fail(`step ${n}: loop has more than one of \`until:\`, \`while:\`, \`foreach:\``);
      return undefined;
    }
    if (drivers.length === 0 && lp.max_iterations === undefined) {
      this.fail(`step ${n}: loop needs one of \`until:\`, \`while:\`, \`foreach:\`, or \`max_iterations:\``);
      return undefined;
    }
    if (lp.foreach !== undefined && lp.foreach !== true) {
      this.fail(`step ${n}: \`foreach\` must be \`true\``);
      return undefined;
    }
    if (lp.foreach && lp.max_iterations !== undefined) {
      this.fail(`step ${n}: \`max_iterations\` is not valid with \`foreach:\``);
      return undefined;
    }
    if (lp.concurrency !== undefined && !lp.foreach) {
      this.fail(`step ${n}: \`concurrency\` is only valid with \`foreach:\``);
      return undefined;
    }

    const body = this.resolveLoopBody(lp, i);
    if (!body) return undefined;

    // --- condition (until/while only) ---
    let condition: ResolvedFileRef | undefined;
    if (lp.until !== undefined || lp.while !== undefined) {
      const condId = (lp.until ?? lp.while)!;
      const filePath = `workflow/condition/${condId}.ts`;
      const exportName = this.resolveFileExport(condId, filePath, 'condition');
      if (!exportName) {
        this.ok = false;
        return undefined;
      }
      if (!this.conditionFileRefs.some((c) => c.id === condId)) {
        this.conditionFileRefs.push({ id: condId, filePath, exportName });
      }
      condition = { id: condId, filePath, exportName };
    }

    const loopKind: ResolvedLoop['loopKind'] = lp.foreach
      ? 'foreach'
      : lp.while !== undefined
        ? 'dowhile'
        : 'dountil';

    return { loopKind, body, condition, maxIterations: lp.max_iterations, concurrency: lp.concurrency };
  }

  /** A loop body is exactly one of: a single leaf, or a multi-step `steps:`
   *  sequence (which becomes an inline nested workflow, hence its own input/output). */
  private resolveLoopBody(lp: LoopInput, i: number): ResolvedLoopBody | undefined {
    const n = i + 1;
    const hasLeafBody = lp.agent !== undefined || lp.tool !== undefined || lp.step !== undefined;
    const hasSeqBody = Array.isArray(lp.steps) && lp.steps.length > 0;
    if (hasLeafBody === hasSeqBody) {
      this.fail(`step ${n}: loop must have exactly one body — a single \`agent:\`/\`tool:\`/\`step:\` or a \`steps:\` list`);
      return undefined;
    }

    if (hasLeafBody) {
      if (lp.input !== undefined || lp.output !== undefined) {
        this.fail(`step ${n}: \`input:\`/\`output:\` are only for a multi-step \`steps:\` body`);
        return undefined;
      }
      const ref = this.resolveLeaf({ agent: lp.agent, tool: lp.tool, step: lp.step }, `step ${n} loop body`);
      if (!ref) {
        this.ok = false;
        return undefined;
      }
      return { kind: 'leaf', ref };
    }

    if (lp.input === undefined || lp.output === undefined) {
      this.fail(`step ${n}: a multi-step loop body requires \`input:\` and \`output:\``);
      return undefined;
    }
    const inC = compileZodObject(lp.input);
    const outC = compileZodObject(lp.output);
    for (const e of inC.errors) this.issue(`step ${n} loop input.${e}`);
    for (const e of outC.errors) this.issue(`step ${n} loop output.${e}`);
    const steps: ResolvedStepRef[] = [];
    let bodyOk = true;
    for (const [j, kid] of lp.steps!.entries()) {
      const r = this.resolveLeaf(kid, `step ${n} loop body step ${j + 1}`);
      if (!r) bodyOk = false;
      else steps.push(r);
    }
    if (!bodyOk || inC.errors.length || outC.errors.length) {
      this.ok = false;
      return undefined;
    }
    return { kind: 'sequence', id: `${this.wfId}-loop-${n}`, inputZod: inC.expr, outputZod: outC.expr, steps };
  }

  private fileExists(relPath: string): boolean {
    return existsSync(join(this.ctx.rootDir, relPath));
  }

  /** Validate a referenced tool/step/condition file: its id yields a safe export
   *  identifier, the file exists, and it actually exports that name (the generated
   *  import assumes it). Returns the export name, or undefined after recording why. */
  private resolveFileExport(
    id: string,
    relPath: string,
    kind: 'tool' | 'step' | 'condition',
  ): string | undefined {
    const reason = invalidExportIdReason(id);
    if (reason) {
      this.issue(`${kind} ${reason}`);
      return undefined;
    }
    if (!this.fileExists(relPath)) {
      this.issue(`${kind} not found: ${relPath}`);
      return undefined;
    }
    const exportName = toExportName(id);
    if (!fileExportsName(this.ctx.rootDir, relPath, exportName)) {
      this.issue(`${relPath} must export \`${exportName}\` (a named export matching the ${kind} id \`${id}\`)`);
      return undefined;
    }
    return exportName;
  }
}
