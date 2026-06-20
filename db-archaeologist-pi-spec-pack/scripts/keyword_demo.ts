// keyword_demo.ts: 关键词需求分析端到端 demo
// 用法：
//   node --import ./scripts/ts_loader.mjs scripts/keyword_demo.ts <category> [strategy]
//                [--live] [--id <category_id>] [--start YYYY-MM-DD] [--end YYYY-MM-DD]
// 默认 strategy=baseline_v1，从 fixtures/keyword_demand_mock 读 mock 数据
// 加 --live 走真实出站（要求 LIVE_PROBE=true 与 ZICHEN_* 环境变量齐全）
// 输出：run_id + run_dir + summary 路径，并打印 TOP 10

import { analyzeKeywordDemand } from "../src/services/keyword_demand/index.js";

const argv = process.argv.slice(2);
const positional: string[] = [];
let live = false;
let categoryId: string | undefined;
let startDate: string | undefined;
let endDate: string | undefined;

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--live") { live = true; continue; }
  if (a === "--id") { categoryId = argv[++i]; continue; }
  if (a === "--start") { startDate = argv[++i]; continue; }
  if (a === "--end") { endDate = argv[++i]; continue; }
  positional.push(a);
}

const category = positional[0];
const strategy = positional[1] ?? "baseline_v1";

if (!category) {
  console.error("用法：node --import ./scripts/ts_loader.mjs scripts/keyword_demo.ts <category> [strategy] [--live] [--id <id>] [--start YYYY-MM-DD] [--end YYYY-MM-DD]");
  console.error("示例：LIVE_PROBE=true ... scripts/keyword_demo.ts 桌布 baseline_v1 --live --start 2026-06-01 --end 2026-06-07");
  process.exit(1);
}

const date_range = startDate && endDate ? { start_date: startDate, end_date: endDate } : undefined;

const result = await analyzeKeywordDemand({
  category,
  category_id: categoryId,
  strategy,
  live,
  date_range,
});

if ("error" in result) {
  console.error("[FAIL]", result.error);
  if (result.missing_params) console.error("missing_params:", result.missing_params);
  if (result.details) console.error("details:", result.details);
  if (result.diagnostic_dir) console.error("diagnostic_dir:", result.diagnostic_dir);
  if (result.diagnostic_run_id) console.error("diagnostic_run_id:", result.diagnostic_run_id);
  if (result.pull_report) console.error("pull_report:", JSON.stringify(result.pull_report, null, 2));
  process.exit(1);
}

console.log(`✓ run_id   = ${result.run_id}`);
console.log(`✓ category = ${result.category}（${result.category_id}）`);
console.log(`✓ run_dir  = ${result.run_dir}`);
console.log(`✓ summary  = ${result.summary_path}`);
console.log(`✓ report   = ${result.report_path}`);
console.log("");
console.log("TOP 10:");
for (let i = 0; i < result.top_overall.length; i += 1) {
  const r = result.top_overall[i] as { keyword: string; scores: { kds: number }; explanation: { kds_level: string; rank_reason: string } };
  console.log(`  ${i + 1}. ${r.keyword} — ${r.scores.kds.toFixed(1)}（${r.explanation.kds_level}） ${r.explanation.rank_reason}`);
}
console.log("");
console.log("按需求类型 TOP 3 摘要：");
for (const [type, list] of Object.entries(result.top_by_type)) {
  const arr = list as Array<{ keyword: string; scores: { kds: number } }>;
  if (arr.length === 0) continue;
  const head = arr.map((r) => `${r.keyword}(${r.scores.kds.toFixed(0)})`).join(", ");
  console.log(`  [${type}] ${head}`);
}