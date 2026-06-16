// Minimal TypeBox stub for local pi_smoke. Only enough surface so the
// extension's `Type.Object({...})` calls succeed and produce a JSON-shaped
// schema we can inspect. Real pi runtime ships its own TypeBox.

function tag(kind, extra = {}) {
  return { [Symbol.for("TypeBox.Kind")]: kind, ...extra };
}

export const Type = {
  Object(props, options = {}) {
    return tag("Object", { type: "object", properties: props, required: Object.keys(props), ...options });
  },
  String(opts = {}) {
    return tag("String", { type: "string", ...opts });
  },
  Number(opts = {}) {
    return tag("Number", { type: "number", ...opts });
  },
  Boolean(opts = {}) {
    return tag("Boolean", { type: "boolean", ...opts });
  },
  Optional(schema) {
    return { ...schema, optional: true };
  },
  Record(_keySchema, valueSchema, opts = {}) {
    return tag("Record", { type: "object", additionalProperties: valueSchema, ...opts });
  },
  Any(opts = {}) {
    return tag("Any", { ...opts });
  },
  Array(item, opts = {}) {
    return tag("Array", { type: "array", items: item, ...opts });
  },
};

export default { Type };