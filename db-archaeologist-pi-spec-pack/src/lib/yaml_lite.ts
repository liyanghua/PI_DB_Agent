// Minimal YAML parser/dumper for db-archaeologist seeds.
// Supports: mapping (a: b), nested mapping, sequence (- item), scalars (string/number/boolean/null),
// inline arrays [a, b], inline objects {k: v}, single/double-quoted strings, and # comments.
// Not supported: anchors, tags, multi-line block scalars (>, |), flow-style mixed nesting beyond 1 level.

type Scalar = string | number | boolean | null;

function stripComment(line: string): string {
  let inStr: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === inStr && line[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === "#") return line.slice(0, i);
  }
  return line;
}

function parseScalar(raw: string): Scalar {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return s;
}

/**
 * Mapping key 专用：仅剥离 yaml quote 包裹，不做 null/bool/number 类型转换。
 * 修复 yaml `">=0.2": 100` 这种用引号包裹特殊字符 key 时，旧实现保留字面引号字符的 bug。
 * 影响：仅 keyword_trend_weights.yaml 的 TMS 桶 key 走这里，其他 yaml 无 quoted block-mapping key。
 */
function unquoteKey(raw: string): string {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return s;
}

function parseFlow(raw: string): unknown {
  const s = raw.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitFlow(inner).map(parseFlowItem);
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return {};
    const obj: Record<string, unknown> = {};
    for (const part of splitFlow(inner)) {
      const idx = part.indexOf(":");
      if (idx === -1) continue;
      const k = unquoteKey(part.slice(0, idx));
      const v = part.slice(idx + 1).trim();
      obj[k] = parseFlowItem(v);
    }
    return obj;
  }
  return parseScalar(s);
}

function parseFlowItem(s: string): unknown {
  const t = s.trim();
  if (t.startsWith("[") || t.startsWith("{")) return parseFlow(t);
  return parseScalar(t);
}

function splitFlow(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  let inStr: '"' | "'" | null = null;
  for (const c of s) {
    if (inStr) {
      buf += c;
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      buf += c;
      continue;
    }
    if (c === "[" || c === "{") {
      depth++;
      buf += c;
      continue;
    }
    if (c === "]" || c === "}") {
      depth--;
      buf += c;
      continue;
    }
    if (c === "," && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

type Line = { indent: number; text: string; raw: string };

function tokenize(input: string): Line[] {
  const lines: Line[] = [];
  for (const raw of input.split(/\r?\n/)) {
    const noComment = stripComment(raw);
    if (noComment.trim() === "") continue;
    const indent = noComment.match(/^ */)![0].length;
    lines.push({ indent, text: noComment.slice(indent).trimEnd(), raw });
  }
  return lines;
}

function parseBlock(lines: Line[], idx: number, indent: number): { value: unknown; next: number } {
  if (idx >= lines.length || lines[idx].indent < indent) {
    return { value: null, next: idx };
  }
  const first = lines[idx];
  const isList = first.text.startsWith("- ");
  if (isList) {
    const arr: unknown[] = [];
    let i = idx;
    while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("- ")) {
      const ln = lines[i];
      const content = ln.text.slice(2).trim();
      if (content === "") {
        const { value, next } = parseBlock(lines, i + 1, indent + 2);
        arr.push(value);
        i = next;
        continue;
      }
      const colonIdx = findMappingColon(content);
      if (colonIdx >= 0) {
        const k = unquoteKey(content.slice(0, colonIdx));
        const v = content.slice(colonIdx + 1).trim();
        const item: Record<string, unknown> = {};
        if (v === "") {
          const { value, next } = parseBlock(lines, i + 1, indent + 2);
          item[k] = value ?? null;
          i = next;
        } else {
          item[k] = v.startsWith("[") || v.startsWith("{") ? parseFlow(v) : parseScalar(v);
          i++;
        }
        while (i < lines.length && lines[i].indent === indent + 2) {
          const sub = lines[i];
          const subColon = findMappingColon(sub.text);
          if (subColon < 0) break;
          const sk = unquoteKey(sub.text.slice(0, subColon));
          const sv = sub.text.slice(subColon + 1).trim();
          if (sv === "") {
            const { value, next } = parseBlock(lines, i + 1, indent + 4);
            item[sk] = value ?? null;
            i = next;
          } else {
            item[sk] = sv.startsWith("[") || sv.startsWith("{") ? parseFlow(sv) : parseScalar(sv);
            i++;
          }
        }
        arr.push(item);
        continue;
      }
      arr.push(content.startsWith("[") || content.startsWith("{") ? parseFlow(content) : parseScalar(content));
      i++;
    }
    return { value: arr, next: i };
  }
  const obj: Record<string, unknown> = {};
  let i = idx;
  while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith("- ")) {
    const ln = lines[i];
    const colonIdx = findMappingColon(ln.text);
    if (colonIdx < 0) {
      i++;
      continue;
    }
    const k = unquoteKey(ln.text.slice(0, colonIdx));
    const v = ln.text.slice(colonIdx + 1).trim();
    if (v === "") {
      const childIndent = i + 1 < lines.length ? lines[i + 1].indent : indent + 2;
      const { value, next } = parseBlock(lines, i + 1, childIndent);
      obj[k] = value ?? null;
      i = next;
    } else {
      obj[k] = v.startsWith("[") || v.startsWith("{") ? parseFlow(v) : parseScalar(v);
      i++;
    }
  }
  return { value: obj, next: i };
}

function findMappingColon(s: string): number {
  let inStr: '"' | "'" | null = null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === ":" && depth === 0) {
      const next = s[i + 1];
      if (next === undefined || next === " " || next === "\t") return i;
    }
  }
  return -1;
}

export function parseYaml(input: string): unknown {
  const lines = tokenize(input);
  if (lines.length === 0) return null;
  const baseIndent = lines[0].indent;
  const { value } = parseBlock(lines, 0, baseIndent);
  return value;
}

function needsQuote(s: string): boolean {
  if (s === "") return true;
  if (/^[-+]?\d/.test(s)) return true;
  if (/^(true|false|null|~|yes|no)$/i.test(s)) return true;
  return /[:#&*!,?\[\]{}|>%@`'"\n]/.test(s) || /^\s|\s$/.test(s);
}

function dumpScalar(v: Scalar): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return needsQuote(v) ? JSON.stringify(v) : v;
}

function dumpInner(value: unknown, indent: number): string {
  const pad = " ".repeat(indent);
  if (value === null || typeof value !== "object") {
    return dumpScalar(value as Scalar);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map(item => {
        if (item === null || typeof item !== "object") return `${pad}- ${dumpScalar(item as Scalar)}`;
        if (Array.isArray(item)) return `${pad}-\n${dumpInner(item, indent + 2)}`;
        const obj = item as Record<string, unknown>;
        const keys = Object.keys(obj);
        if (keys.length === 0) return `${pad}- {}`;
        const head = keys[0];
        const headVal = obj[head];
        const headLine =
          headVal === null || typeof headVal !== "object"
            ? `${pad}- ${head}: ${dumpScalar(headVal as Scalar)}`
            : Array.isArray(headVal) && headVal.length === 0
              ? `${pad}- ${head}: []`
              : !Array.isArray(headVal) && Object.keys(headVal as Record<string, unknown>).length === 0
                ? `${pad}- ${head}: {}`
                : `${pad}- ${head}:\n${dumpInner(headVal, indent + 4)}`;
        const restLines = keys.slice(1).map(k => {
          const v = obj[k];
          if (v === null || typeof v !== "object") {
            return `${pad}  ${k}: ${dumpScalar(v as Scalar)}`;
          }
          if (Array.isArray(v) && v.length === 0) return `${pad}  ${k}: []`;
          if (!Array.isArray(v) && Object.keys(v as Record<string, unknown>).length === 0) {
            return `${pad}  ${k}: {}`;
          }
          return `${pad}  ${k}:\n${dumpInner(v, indent + 4)}`;
        });
        return [headLine, ...restLines].join("\n");
      })
      .join("\n");
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{}";
  return keys
    .map(k => {
      const v = obj[k];
      if (v === null || typeof v !== "object") {
        return `${pad}${k}: ${dumpScalar(v as Scalar)}`;
      }
      if (Array.isArray(v) && v.length === 0) return `${pad}${k}: []`;
      if (!Array.isArray(v) && Object.keys(v as Record<string, unknown>).length === 0) {
        return `${pad}${k}: {}`;
      }
      return `${pad}${k}:\n${dumpInner(v, indent + 2)}`;
    })
    .join("\n");
}

export function dumpYaml(value: unknown): string {
  return dumpInner(value, 0) + "\n";
}