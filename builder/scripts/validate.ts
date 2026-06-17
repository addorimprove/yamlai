import { parseProject, ParseError } from '../src/index.js';

export interface ValidateResult {
  code: 0 | 1 | 2;
  stdout?: string;
  stderr?: string;
}

// Parse-only check: run parseProject and report problems without generating
// code. `root` must already be an absolute/resolved path.
export function runValidate(root: string, opts: { json?: boolean } = {}): ValidateResult {
  try {
    const project = parseProject(root);
    if (opts.json) {
      return { code: 0, stdout: JSON.stringify({ ok: true, issues: [] }) };
    }
    return {
      code: 0,
      stdout: `✓ valid: ${project.agents.length} agents, ${project.workflows.length} workflows`,
    };
  } catch (err) {
    if (err instanceof ParseError) {
      if (opts.json) {
        return { code: 1, stdout: JSON.stringify({ ok: false, issues: err.issues }) };
      }
      return { code: 1, stderr: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      return { code: 2, stdout: JSON.stringify({ ok: false, error: message }) };
    }
    return { code: 2, stderr: message };
  }
}
