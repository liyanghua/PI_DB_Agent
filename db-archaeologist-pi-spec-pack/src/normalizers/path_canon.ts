// Path canonicalization: drop multi-tenant prefixes, keep alphanumeric-segment path.
// Examples (from docs):
//   /openApi/api/{api-id}/5/openApi/api/123/5/agent/foo  -> /agent/foo
//   /openApi/api/123/5/agent/foo                          -> /agent/foo
//   /agent/foo                                            -> /agent/foo

const PREFIX_PATTERNS = [
  /^\/openApi\/api\/\{[^}]+\}\/\d+(?=\/)/i,
  /^\/openApi\/api\/\d+\/\d+(?=\/)/i,
  /^\/openApi\/api\/\{[^}]+\}(?=\/)/i,
  /^\/openApi\/api\/\d+(?=\/)/i,
  /^\/openApi\/api(?=\/)/i,
  /^\/openApi(?=\/)/i,
];

export function canonicalizePath(raw: string): { path: string; raw: string; placeholder: boolean } {
  if (!raw) return { path: "", raw: "", placeholder: false };
  let p = raw.trim();
  for (let i = 0; i < 6; i++) {
    let changed = false;
    for (const pat of PREFIX_PATTERNS) {
      const next = p.replace(pat, "");
      if (next !== p) {
        p = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  if (!p.startsWith("/")) p = "/" + p;
  const placeholder = /\{[^}]+\}/.test(p);
  return { path: p, raw, placeholder };
}

export function pathToApiId(canonical: string): string {
  return canonical
    .replace(/^\/+/, "")
    .replace(/\{[^}]+\}/g, "param")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}