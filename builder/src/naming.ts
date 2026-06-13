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
