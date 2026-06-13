/** Escape a string for safe inclusion inside a `backtick` template literal:
 *  backslash, backtick, and the ${ interpolation opener. */
export function backtickString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}
