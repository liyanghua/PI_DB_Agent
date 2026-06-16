import type { ParamRow, ResponseField, RequestSchema, ResponseSchema } from "../lib/types.js";

export type DetailParseResult = {
  api_id?: string;
  source_seq: number;
  method: string;
  name: string;
  module?: string;
  path?: string;
  source_line_no?: number;
  request_schema?: RequestSchema;
  response_schema?: ResponseSchema;
  parse_failure: boolean;
  parse_warnings: string[];
};

const SECTION_HEAD = /^## (\d+)\.\s+(GET|POST|PUT|DELETE|PATCH)\s+(.+?)\s*$/;
const SUBSECTION_HEAD = /^### (.+?)\s*$/;

type Section = {
  seq: number;
  method: string;
  name: string;
  body: string[];
  startLine: number;
};

function splitSections(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const out: Section[] = [];
  let cur: Section | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(SECTION_HEAD);
    if (m) {
      if (cur) out.push(cur);
      cur = {
        seq: Number(m[1]),
        method: m[2],
        name: m[3].trim(),
        body: [],
        startLine: i + 1
      };
      continue;
    }
    if (cur) cur.body.push(line);
  }
  if (cur) out.push(cur);
  return out;
}

function splitSubsections(body: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let curName: string | null = null;
  let curLines: string[] = [];
  for (const line of body) {
    const m = line.match(SUBSECTION_HEAD);
    if (m) {
      if (curName) map.set(curName, curLines);
      curName = m[1].trim();
      curLines = [];
      continue;
    }
    if (curName) curLines.push(line);
  }
  if (curName) map.set(curName, curLines);
  return map;
}

function parseMarkdownTable(lines: string[]): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  let header: string[] | null = null;
  let sawDivider = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      if (header && sawDivider) break;
      continue;
    }
    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map(c => c.trim());
    if (!header) {
      header = cells;
      continue;
    }
    if (!sawDivider && cells.every(c => /^:?-+:?$/.test(c))) {
      sawDivider = true;
      continue;
    }
    if (!sawDivider) {
      header = cells;
      continue;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]] = cells[i] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function parseBasicInfo(lines: string[]): {
  path?: string;
  module?: string;
  source_line_no?: number;
} {
  const rows = parseMarkdownTable(lines);
  const out: { path?: string; module?: string; source_line_no?: number } = {};
  for (const row of rows) {
    const key = row["项目"] ?? row["项 目"];
    const value = row["内容"] ?? "";
    if (!key) continue;
    const v = value.replace(/`/g, "").trim();
    if (key.includes("请求路径")) out.path = v;
    else if (key.includes("所属模块")) out.module = v;
    else if (key.includes("源文档行号")) {
      const n = Number(v);
      if (Number.isFinite(n)) out.source_line_no = n;
    }
  }
  return out;
}

function parseParams(lines: string[]): RequestSchema {
  const rows = parseMarkdownTable(lines);
  const req: RequestSchema = { query: [], body: null, headers: [], path_params: [] };
  const bodyParams: ParamRow[] = [];
  for (const row of rows) {
    const name = row["名称"] ?? "";
    const pos = (row["位置"] ?? "").toLowerCase();
    const type = row["类型"] ?? "";
    const required = (row["必选"] ?? "").trim() === "是";
    const desc = row["说明"] ?? "";
    if (!name) continue;
    const param: ParamRow = { name, type, required, desc };
    if (pos === "header") {
      req.headers.push(name);
    } else if (pos === "body") {
      param.position = "body";
      bodyParams.push(param);
    } else if (pos === "path") {
      param.position = "path";
      req.path_params.push(param);
    } else {
      param.position = "query";
      req.query.push(param);
    }
  }
  req.body = bodyParams.length ? bodyParams : null;
  return req;
}

function extractFirstJsonBlock(lines: string[]): string | null {
  let inJson = false;
  const buf: string[] = [];
  for (const line of lines) {
    if (!inJson) {
      if (/^```json\s*$/.test(line.trim())) inJson = true;
      continue;
    }
    if (/^```\s*$/.test(line.trim())) break;
    buf.push(line);
  }
  return buf.length ? buf.join("\n") : null;
}

function parseResponseFormat(lines: string[]): { example: unknown | null; root: string } {
  const raw = extractFirstJsonBlock(lines);
  if (!raw) return { example: null, root: "data" };
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    let root = "data";
    if (obj && typeof obj === "object" && "data" in obj) {
      const d = (obj as { data: unknown }).data;
      if (d && typeof d === "object" && d !== null && "result" in (d as Record<string, unknown>)) {
        const result = (d as Record<string, unknown>).result;
        root = Array.isArray(result) ? "data.result[]" : "data.result";
      } else {
        root = Array.isArray(d) ? "data[]" : "data";
      }
    }
    return { example: obj, root };
  } catch {
    return { example: null, root: "data" };
  }
}

function parseResponseFields(lines: string[]): ResponseField[] {
  const rows = parseMarkdownTable(lines);
  const out: ResponseField[] = [];
  const stack: string[] = [];
  for (const row of rows) {
    const rawName = row["名称"] ?? "";
    if (!rawName) continue;
    const m = rawName.match(/^(»+)?\s*(.+)$/);
    const depthMarker = m?.[1] ?? "";
    const cleanName = (m?.[2] ?? rawName).trim();
    const depth = depthMarker.length;
    while (stack.length >= depth) stack.pop();
    stack.push(cleanName);
    const path = stack.join(".");
    out.push({
      path,
      name: cleanName,
      type: row["类型"] ?? "",
      desc: row["中文名"] || row["说明"] || ""
    });
  }
  return out;
}

export function parseDetailSection(section: Section): DetailParseResult {
  const warnings: string[] = [];
  const subs = splitSubsections(section.body);

  const basic = subs.has("基本信息") ? parseBasicInfo(subs.get("基本信息")!) : {};
  if (!basic.path) warnings.push("missing_basic_info_path");

  let request: RequestSchema | undefined;
  if (subs.has("参数字段说明")) {
    request = parseParams(subs.get("参数字段说明")!);
  } else {
    warnings.push("missing_param_table");
  }

  let response: ResponseSchema | undefined;
  if (subs.has("返回格式")) {
    const fmt = parseResponseFormat(subs.get("返回格式")!);
    const fields = subs.has("返回字段说明")
      ? parseResponseFields(subs.get("返回字段说明")!)
      : [];
    if (fmt.example === null) warnings.push("empty_or_invalid_response_example");
    if (fields.length === 0) warnings.push("missing_response_fields");
    response = { root: fmt.root, fields, example: fmt.example };
  } else {
    warnings.push("missing_response_format");
  }

  const parse_failure = !basic.path && !request && !response;

  return {
    source_seq: section.seq,
    method: section.method,
    name: section.name,
    module: basic.module,
    path: basic.path,
    source_line_no: basic.source_line_no,
    request_schema: request,
    response_schema: response,
    parse_failure,
    parse_warnings: warnings
  };
}

export function parseAllDetails(markdown: string): DetailParseResult[] {
  const sections = splitSections(markdown);
  return sections.map(parseDetailSection);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const input =
    process.argv[2] ?? "sources/api_docs/智能体数仓完整接口文档_整理版.md";
  const output =
    process.argv[3] ?? "registry/derived/api_details.raw.json";
  const reportPath =
    process.argv[4] ?? "registry/derived/api_parse_report.md";

  const md = fs.readFileSync(input, "utf-8");
  const details = parseAllDetails(md);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(
    output,
    JSON.stringify({ count: details.length, details }, null, 2)
  );

  const failures = details.filter(d => d.parse_failure);
  const partial = details.filter(d => !d.parse_failure && d.parse_warnings.length > 0);
  const reportLines: string[] = [];
  reportLines.push("# API Parse Report");
  reportLines.push("");
  reportLines.push(`Total sections: ${details.length}`);
  reportLines.push(`Hard failures: ${failures.length}`);
  reportLines.push(`Partial (with warnings): ${partial.length}`);
  reportLines.push("");
  if (failures.length) {
    reportLines.push("## Hard failures");
    reportLines.push("");
    for (const d of failures) {
      reportLines.push(`- seq=${d.source_seq} ${d.method} ${d.name}`);
    }
    reportLines.push("");
  }
  if (partial.length) {
    reportLines.push("## Partial parses");
    reportLines.push("");
    for (const d of partial) {
      reportLines.push(
        `- seq=${d.source_seq} ${d.method} ${d.name} :: ${d.parse_warnings.join(", ")}`
      );
    }
  }
  fs.writeFileSync(reportPath, reportLines.join("\n") + "\n");
  console.log(
    `Parsed ${details.length} detail sections (failures=${failures.length}, partial=${partial.length}) -> ${output}`
  );
}