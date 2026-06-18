// keyword_demo.ts: 关键词需求分析端到端 demo
// 用法：node --import ./scripts/ts_loader.mjs scripts/keyword_demo.ts <category> [strategy]
// 默认 strategy=baseline_v1，从 fixtures/keyword_demand_mock 读 mock 数据
// 输出：run_id + run_dir + summary 路径，并打印 TOP 10

import { analyzeKeywordDemand } from "../src/services/keyword_demand/index.js";

const argv = process.argv.slice(2);
const category = argv[0];
const strategy = argv[1] ?? "baseline_v1";

if (!category) {
  console.error("用法：node --import ./scripts/ts_loader.mjs scripts/keyword_demo.ts <category> [strategy]");
  console.error("示例：node --import ./scripts/ts_loader.mjs scripts/keyword_demo.ts 入户地垫");
  process.exit(1);
}

const result = await analyzeKeywordDemand({
  category,
  strategy,
  live: false,
});

if ("error" in result) {
  console.error("[FAIL]", result.error);
  if (result.missing_params) console.error("missing_params:", result.missing_params);
  if (result.details) console.error("details:", result.details);
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