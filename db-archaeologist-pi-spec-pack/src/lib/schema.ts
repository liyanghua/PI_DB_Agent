// Minimal JSON Schema validator (subset) — no external deps.
// Supports: type (string/number/integer/boolean/object/array/null), required, properties,
// additionalProperties, items, enum, const, minLength, maxLength, minimum, maximum,
// minItems, maxItems, pattern, anyOf, allOf, oneOf, $ref to local definitions ($defs/definitions),
// nullable via type:[...,"null"].

import { readJson } from "./io.js";

export type ValidationError = { path: string; message: string };

export type ValidationReport = {
  ok: boolean;
  errors: Array<{ index: number; id?: string; message: string; path: string }>;
  total: number;
};

type Schema = Record<string, unknown>;

const cache = new Map<string, Schema>();

export function loadSchema(schemaPath: string): Schema {
  const cached = cache.get(schemaPath);
  if (cached) return cached;
  const schema = readJson<Schema>(schemaPath);
  cache.set(schemaPath, schema);
  return schema;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}

function resolveRef(root: Schema, ref: string): Schema {
  if (!ref.startsWith("#/")) return {};
  const segs = ref.slice(2).split("/");
  let cur: unknown = root;
  for (const seg of segs) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[seg];
  }
  return (cur as Schema) ?? {};
}

function validateNode(
  root: Schema,
  schema: Schema,
  value: unknown,
  path: string,
  errors: ValidationError[]
): void {
  if (schema.$ref && typeof schema.$ref === "string") {
    validateNode(root, resolveRef(root, schema.$ref), value, path, errors);
    return;
  }
  if (Array.isArray(schema.allOf)) {
    for (const s of schema.allOf as Schema[]) validateNode(root, s, value, path, errors);
  }
  if (Array.isArray(schema.anyOf)) {
    const localErrors: ValidationError[][] = [];
    let passed = false;
    for (const s of schema.anyOf as Schema[]) {
      const sub: ValidationError[] = [];
      validateNode(root, s, value, path, sub);
      if (sub.length === 0) {
        passed = true;
        break;
      }
      localErrors.push(sub);
    }
    if (!passed) errors.push({ path, message: "anyOf failed: " + localErrors.flat().map(e => e.message).join("; ") });
  }
  if (Array.isArray(schema.oneOf)) {
    let matched = 0;
    for (const s of schema.oneOf as Schema[]) {
      const sub: ValidationError[] = [];
      validateNode(root, s, value, path, sub);
      if (sub.length === 0) matched++;
    }
    if (matched !== 1) errors.push({ path, message: `oneOf matched ${matched} schemas` });
  }

  const t = schema.type;
  if (t !== undefined) {
    const types = Array.isArray(t) ? (t as string[]) : [t as string];
    const actual = typeOf(value);
    const ok = types.some(tp => {
      if (tp === "number") return actual === "number" || actual === "integer";
      if (tp === "integer") return actual === "integer";
      return actual === tp;
    });
    if (!ok) {
      errors.push({ path, message: `expected type ${types.join("|")}, got ${actual}` });
      return;
    }
  }

  if (schema.enum && Array.isArray(schema.enum)) {
    if (!schema.enum.some(e => deepEqual(e, value))) {
      errors.push({ path, message: `value not in enum` });
    }
  }
  if (schema.const !== undefined && !deepEqual(schema.const, value)) {
    errors.push({ path, message: `value !== const` });
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push({ path, message: `string shorter than minLength ${schema.minLength}` });
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push({ path, message: `string longer than maxLength ${schema.maxLength}` });
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, message: `string does not match pattern ${schema.pattern}` });
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push({ path, message: `number < minimum ${schema.minimum}` });
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push({ path, message: `number > maximum ${schema.maximum}` });
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push({ path, message: `array shorter than minItems ${schema.minItems}` });
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push({ path, message: `array longer than maxItems ${schema.maxItems}` });
    }
    if (schema.items && typeof schema.items === "object") {
      for (let i = 0; i < value.length; i++) {
        validateNode(root, schema.items as Schema, value[i], `${path}[${i}]`, errors);
      }
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const k of schema.required as string[]) {
        if (!(k in obj)) errors.push({ path: `${path}/${k}`, message: `missing required property ${k}` });
      }
    }
    const props = (schema.properties as Record<string, Schema>) || {};
    for (const k of Object.keys(props)) {
      if (k in obj) validateNode(root, props[k], obj[k], `${path}/${k}`, errors);
    }
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(obj)) {
        if (!(k in props)) errors.push({ path: `${path}/${k}`, message: `additional property ${k} not allowed` });
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      const extra = schema.additionalProperties as Schema;
      for (const k of Object.keys(obj)) {
        if (!(k in props)) validateNode(root, extra, obj[k], `${path}/${k}`, errors);
      }
    }
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

export function validate(schemaPath: string, value: unknown): ValidationError[] {
  const schema = loadSchema(schemaPath);
  const errors: ValidationError[] = [];
  validateNode(schema, schema, value, "", errors);
  return errors;
}

export function validateMany<T extends { api_id?: string; tool_id?: string }>(
  schemaPath: string,
  items: T[]
): ValidationReport {
  const schema = loadSchema(schemaPath);
  const report: ValidationReport = { ok: true, errors: [], total: items.length };
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const errs: ValidationError[] = [];
    validateNode(schema, schema, item, "", errs);
    if (errs.length > 0) {
      report.ok = false;
      for (const e of errs) {
        report.errors.push({ index: i, id: item.api_id ?? item.tool_id, message: e.message, path: e.path });
      }
    }
  }
  return report;
}