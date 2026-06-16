import fs from "node:fs";
import path from "node:path";

export type ApiIndexRow = {
  seq: number;
  module: string;
  name: string;
  method: string;
  path: string;
  issue_marker: string;
};

export function parseApiIndex(markdown: string): ApiIndexRow[] {
  const rows: ApiIndexRow[] = [];
  const re = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*`([^`]+)`\s*\|\s*([^|]*)\|\s*$/;
  for (const line of markdown.split(/?
/)) {
    const m = line.match(re);
    if (!m) continue;
    rows.push({
      seq: Number(m[1]),
      module: m[2].trim(),
      name: m[3].trim(),
      method: m[4].trim(),
      path: m[5].trim(),
      issue_marker: m[6].trim()
    });
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv[2] ?? "sources/api_docs/智能体数仓完整接口文档_整理版.md";
  const output = process.argv[3] ?? "registry/seed/api_index_seed.generated.json";
  const md = fs.readFileSync(input, "utf-8");
  const rows = parseApiIndex(md);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ count: rows.length, apis: rows }, null, 2));
  console.log(`Parsed ${rows.length} API index rows -> ${output}`);
}
