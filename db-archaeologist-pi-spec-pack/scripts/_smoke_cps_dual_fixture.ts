// _smoke 临时：跑双源 fixture 端到端，验证三阶段聚合 + record 完整字段
import { analyzeKeywordCompetition } from "../src/services/keyword_competition/index.js";
import { readJson } from "../src/lib/io.js";
import { join } from "node:path";

const out = await analyzeKeywordCompetition({
  category: "入户地垫",
  live: false,
  top_n: 13,
  per_bucket_top: 5,
  date_range: { start_date: "2026-09-01", end_date: "2026-09-30" },
});

if ("error" in out) {
  console.error("[ERROR]", out);
  process.exit(1);
}

console.log("[run]", out.run_id);
console.log("[records]", out.cps_records_count);
console.log("[universe_source]", out.keyword_universe_source);

// 读 category_metrics / keyword_metrics
const cat = readJson<Record<string, any>>(join(out.run_dir, "cps_category_metrics.json"));
const kwm = readJson<Record<string, any>>(join(out.run_dir, "cps_keyword_cpc.json"));
console.log("\n[category_metrics]", JSON.stringify(cat, null, 2));
console.log("\n[keyword_metrics keys]", Object.keys(kwm));

// 读 scores
const scores = readJson<any[]>(join(out.run_dir, "cps_scores.json"));
console.log("\n[cpc_source distribution]");
const dist: Record<string, number> = {};
for (const r of scores) dist[r.cpc_source] = (dist[r.cpc_source] ?? 0) + 1;
console.log(dist);

// 检查 broadcast 自洽：所有 record 的 competition_index 必须一致（同类目）
const ciSet = new Set(scores.map((r) => r.competition_index));
console.log("\n[broadcast self-consistency] competition_index unique values:", [...ciSet]);

// 检查 aggregation_kind 标记
const sample = scores.find((r) => r.cpc_source === "paid");
console.log("\n[paid sample provenance]", sample?.keyword, JSON.stringify(sample?.explanation?.field_provenance, null, 2));

const missing = scores.find((r) => r.cpc_source === "missing");
console.log("\n[missing sample]", missing?.keyword, "cps=", missing?.cps, "fallback_chain=", missing?.explanation?.fallback_chain);

// top_overall
console.log("\n[top_overall]", out.top_overall.map((r: any) => `${r.keyword}=${r.cps.toFixed(1)}(${r.cpc_source})`).join(" | "));

console.log("\n[smoke] OK");