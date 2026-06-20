// extract_validation_overlay.ts — 解析全量验证版.md → registry/derived/api_validation_overlay.json
//
// 输入：docs/data_api/智能体数仓完整接口文档_全量验证版.md
// 输出：
//   registry/derived/api_validation_overlay.json
//   registry/derived/api_validation_overlay_report.md
//
// 失败容忍：单行失败不阻断；entries_parsed < 100 时整体 exit 1（兜底阈值）
//
// 调用：node --import ./scripts/ts_loader.mjs scripts/extract_validation_overlay.ts

import path from "node:path";
import { readText, writeJson, writeText } from "../src/lib/io.js";
import { extractValidationOverlay } from "../src/extractors/markdown_validation_overlay_extractor.js";
import type { ParseFailure, ValidationEntry } from "../src/extractors/markdown_validation_overlay_extractor.js";

const ROOT = process.cwd();
const SOURCE_PATH = "docs/data_api/智能体数仓完整接口文档_全量验证版.md";
const OUT_JSON = "registry/derived/api_validation_overlay.json";
const OUT_REPORT = "registry/derived/api_validation_overlay_report.md";
const MIN_PARSED = 100;

function buildReport(meta: Awaited<ReturnType<typeof extractValidationOverlay>>["meta"], entries: ValidationEntry[], failures: ParseFailure[]): string {
  const lines: string[] = [];
  lines.push("# Validation Overlay Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Source: ${SOURCE_PATH}`);
  lines.push(`Source SHA-256: ${meta.source_sha256}`);
  lines.push(`Source line count: ${meta.source_line_count}`);
  lines.push(`Table header line: ${meta.table_header_line_no}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Total rows: ${meta.entries_total}`);
  lines.push(`- Parsed: ${meta.entries_parsed}`);
  lines.push(`- Failed: ${meta.entries_failed}`);
  lines.push("");
  lines.push("## Status distribution");
  for (const [k, v] of Object.entries(meta.status_distribution)) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  if (failures.length > 0) {
    lines.push("## Parse Failures");
    lines.push("");
    lines.push("| line | failure_type | message |");
    lines.push("|---:|---|---|");
    for (const f of failures) {
      const msg = f.message.replace(/\|/g, "\\|").slice(0, 200);
      lines.push(`| ${f.source_line_no} | ${f.failure_type} | ${msg} |`);
    }
    lines.push("");
  }
  lines.push("## Sampled Entries (first 5)");
  lines.push("");
  for (const e of entries.slice(0, 5)) {
    lines.push(`### seq ${e.source_seq} · ${e.name} (line ${e.source_line_no})`);
    lines.push(`- api_id: \`${e.api_id}\``);
    lines.push(`- method: ${e.method}`);
    lines.push(`- path: \`${e.path_canon}\``);
    lines.push(`- base_url_segment: \`${e.base_url_segment}\``);
    lines.push(`- url_template: \`${e.url_template}\``);
    lines.push(`- verified_status: ${e.verified_status}`);
    lines.push(`- body_template keys: ${Object.keys(e.body_template).join(", ") || "(empty)"}`);
    lines.push("");
  }
  lines.push("");
  lines.push("> 命中统计（overlay_hit / overlay_miss / overlay_orphan）由 build_cards.ts 在 leftJoin 后追加。");
  return lines.join("\n") + "\n";
}

async function main() {
  const sourceFull = path.join(ROOT, SOURCE_PATH);
  const md = readText(sourceFull);
  const result = await extractValidationOverlay(md);

  const out = {
    generated_at: new Date().toISOString(),
    source_path: SOURCE_PATH,
    ...result.meta,
    entries: result.entries,
    parse_failures: result.failures,
  };
  writeJson(path.join(ROOT, OUT_JSON), out);
  writeText(path.join(ROOT, OUT_REPORT), buildReport(result.meta, result.entries, result.failures));

  console.log(`[overlay] parsed=${result.meta.entries_parsed} failed=${result.meta.entries_failed}`);
  console.log(`[overlay] status:`, result.meta.status_distribution);
  console.log(`[overlay] -> ${OUT_JSON}`);
  console.log(`[overlay] -> ${OUT_REPORT}`);

  if (result.meta.entries_parsed < MIN_PARSED) {
    console.error(`[overlay] FAIL: parsed=${result.meta.entries_parsed} < ${MIN_PARSED}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[overlay] fatal:", e?.stack ?? e);
  process.exit(1);
});