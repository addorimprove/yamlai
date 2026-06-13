import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ParsedProject } from '../types.js';
import type { FileMap } from './types.js';
import { emitAgent } from './emit-agent.js';
import { emitIndex } from './emit-mastra.js';
import {
  emitGitignore,
  emitPackageJson,
  emitPnpmWorkspace,
  emitTsconfig,
} from './emit-project-files.js';

/** Produce the full in-memory file map for a Mastra project from a ParsedProject.
 *  Tool .ts sources are read verbatim from rootDir; all other content is
 *  generated in-memory (this function performs no writes). */
export function generateProject(project: ParsedProject, rootDir: string): FileMap {
  const files: FileMap = {};

  files['package.json'] = emitPackageJson(project);
  files['tsconfig.json'] = emitTsconfig();
  files['pnpm-workspace.yaml'] = emitPnpmWorkspace();
  files['.gitignore'] = emitGitignore();
  files['src/mastra/index.ts'] = emitIndex(project);

  for (const agent of project.agents) {
    files[`src/mastra/agents/${agent.id}.ts`] = emitAgent(agent);
    for (const tool of agent.tools) {
      const dest = `src/mastra/tools/${tool.id}.ts`;
      if (files[dest]) continue; // copy each tool once even if shared across agents
      files[dest] = readFileSync(join(rootDir, tool.filePath), 'utf8');
    }
  }

  return files;
}
