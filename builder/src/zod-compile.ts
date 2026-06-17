// builder/src/zod-compile.ts
/** Compile a flat YAML object of primitive field specs into a `z.object({...})`
 *  source-code expression (a string the emitter drops verbatim). Returns the
 *  expression plus a per-field error list (aggregated by the caller into ParseError).
 *
 *  Supported field forms (spec "Schemas — YAML→Zod" table):
 *    string | number | boolean        -> z.string() / z.number() / z.boolean()
 *    string[] | number[] | boolean[]  -> z.array(z.<base>())
 *    [a, b, ...]                       -> z.enum(['a','b',...])
 *    any scalar/array string form may end with `?` -> .optional()
 *  Nested objects / other types are rejected (use a glue tool to shape complex IO). */
export function compileZodObject(obj: Record<string, unknown>): { expr: string; errors: string[] } {
  const errors: string[] = [];
  const entries: string[] = [];
  for (const [key, raw] of Object.entries(obj)) {
    const r = compileField(raw);
    if (r.error) {
      errors.push(`${key}: ${r.error}`);
      continue;
    }
    entries.push(`${zodKey(key)}: ${r.expr}`);
  }
  const expr = entries.length ? `z.object({ ${entries.join(', ')} })` : 'z.object({})';
  return { expr, errors };
}

const BASES: Record<string, string> = {
  string: 'z.string()',
  number: 'z.number()',
  boolean: 'z.boolean()',
};

function compileField(raw: unknown): { expr?: string; error?: string } {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return { error: 'enum must have at least one value' };
    if (!raw.every((v) => typeof v === 'string')) return { error: 'enum values must be strings' };
    return { expr: `z.enum([${raw.map((v) => JSON.stringify(v)).join(', ')}])` };
  }
  if (typeof raw !== 'string') {
    return { error: 'unsupported field type (use string/number/boolean, a [] suffix, ? for optional, or a [..] enum)' };
  }
  let spec = raw.trim();
  let optional = false;
  if (spec.endsWith('?')) {
    optional = true;
    spec = spec.slice(0, -1).trim();
  }
  let array = false;
  if (spec.endsWith('[]')) {
    array = true;
    spec = spec.slice(0, -2).trim();
  }
  const base = BASES[spec];
  if (!base) return { error: `unknown primitive \`${spec}\` (expected string, number, or boolean)` };
  let expr = array ? `z.array(${base})` : base;
  if (optional) expr += '.optional()';
  return { expr };
}

/** Quote object keys that aren't bare JS identifiers so the emitted z.object is valid TS. */
function zodKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}
