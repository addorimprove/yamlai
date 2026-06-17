/** Convert a kebab/snake-case id into a camelCase export variable name.
 *  e.g. "echo-tool" -> "echoTool", "support-agent" -> "supportAgent". */
export function toExportName(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part, i) =>
      i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join('');
}

/** ECMAScript reserved words that can't name a `const`/`import` binding in an ES
 *  module (modules are always strict). An id whose camelCase form lands here would
 *  emit code that fails to parse (TS1389/TS1109), so the parser rejects it. */
const RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
  // reserved in strict mode (and therefore in modules)
  'implements', 'interface', 'let', 'package', 'private', 'protected', 'public',
  'static', 'yield', 'await',
]);

/** Why `id` cannot be turned into a safe export identifier, or null if it's fine.
 *  Guards against ids whose camelCase form is empty, not a legal JS identifier
 *  (e.g. a leading digit), or a reserved word — all of which would emit
 *  uncompilable TypeScript (TS1003/TS1134/TS1389) rather than a clear error. */
export function invalidExportIdReason(id: string): string | null {
  const name = toExportName(id);
  if (name === '') {
    return `id \`${id}\` has no identifier characters (yields an empty export name)`;
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    return `id \`${id}\` yields \`${name}\`, which is not a valid JavaScript identifier`;
  }
  if (RESERVED_WORDS.has(name)) {
    return `id \`${id}\` yields \`${name}\`, which is a reserved word`;
  }
  return null;
}
