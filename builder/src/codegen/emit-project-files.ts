import type { ParsedProject } from '../types.js';
import { VERSIONS } from './versions.js';

export function emitPackageJson(project: ParsedProject): string {
  const dependencies = {
    '@mastra/core': VERSIONS['@mastra/core'],
    '@mastra/loggers': VERSIONS['@mastra/loggers'],
    ...(project.storage ? { '@mastra/libsql': VERSIONS['@mastra/libsql'] } : {}),
    ...(project.memory ? { '@mastra/memory': VERSIONS['@mastra/memory'] } : {}),
    zod: VERSIONS.zod,
  };
  const pkg = {
    name: project.name,
    version: '1.0.0',
    type: 'module',
    engines: { node: '>=22.13.0' },
    scripts: {
      dev: 'mastra dev',
      build: 'mastra build',
      start: 'mastra start',
    },
    dependencies,
    devDependencies: {
      mastra: VERSIONS.mastra,
      typescript: VERSIONS.typescript,
      '@types/node': VERSIONS['@types/node'],
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

export function emitTsconfig(): string {
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ES2022',
      moduleResolution: 'bundler',
      esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      strict: true,
      // Mastra's `createStep(agent)` returns a step whose `execute` reads a
      // concrete `{ prompt }` input. Under `strictFunctionTypes` that function
      // property is checked contravariantly against the `unknown` input that
      // `.then()` infers, so EVERY agent-step workflow fails to typecheck. We
      // relax just this one flag (keeping the rest of `strict`); genuine
      // step-to-step IO mismatches are still caught — they surface on the
      // step's `inputSchema`/`outputSchema` data properties, not on `execute`.
      strictFunctionTypes: false,
      skipLibCheck: true,
      noEmit: true,
      outDir: 'dist',
    },
    include: ['src/**/*'],
  };
  return JSON.stringify(tsconfig, null, 2) + '\n';
}

export function emitGitignore(): string {
  return ['node_modules', 'dist', '.mastra', '.env', '*.db', '*.db-*', ''].join('\n');
}

/** pnpm blocks dependency build scripts by default; mastra's bundler needs
 *  esbuild's native binary, so whitelist it here or `mastra build` fails with
 *  ERR_PNPM_IGNORED_BUILDS. pnpm reads this `allowBuilds` map from
 *  pnpm-workspace.yaml (the package.json `pnpm` field is ignored). Declaring
 *  the file also makes the generated project its own self-contained workspace. */
export function emitPnpmWorkspace(): string {
  return ['allowBuilds:', '  esbuild: true', ''].join('\n');
}
