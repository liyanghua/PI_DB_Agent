// keyword_eval.ts: CLI 跑业务金标评测
// 用法：node --import ./scripts/ts_loader.mjs scripts/keyword_eval.ts [strategy=baseline_v1] [k=20]

import { runEvaluation } from "../src/services/keyword_demand/eval.js";

const argv = process.argv.slice(2);
const strategy = argv[0] ?? "baseline_v1";
const k = argv[1] != null ? parseInt(argv[1], 10) : 20;

const report = await runEvaluation({ strategy, k });

console.log(`✓ 评测完成：strategy=${strategy}, k=${k}`);
console.log(`  json: ${report.paths.json}`);
console.log(`  md  : ${report.paths.md}`);
console.log("");
console.log("聚合指标：");
console.log(`  precision@${k}：${report.aggregate.avg_precision_at_k.toFixed(3)}`);
console.log(`  recall@${k}   ：${report.aggregate.avg_recall_at_k.toFixed(3)}`);
console.log(`  NDCG@${k}     ：${report.aggregate.avg_ndcg_at_k.toFixed(3)}`);
console.log(`  must_include 命中率：${(report.aggregate.avg_must_include_hit_rate * 100).toFixed(1)}%`);
console.log(`  must_exclude 违反数：${report.aggregate.total_must_exclude_violations}`);
console.log(`  整体通过：${report.aggregate.pass_threshold ? "✓" : "✗"}`);
console.log("");
console.log("各类目：");
for (const c of report.categories) {
  console.log(`  - ${c.category}: prec=${c.metrics.precision_at_k.toFixed(3)} recall=${c.metrics.recall_at_k.toFixed(3)} ndcg=${c.metrics.ndcg_at_k.toFixed(3)} ${c.passed ? "✓" : "✗"}`);
  if (c.must_exclude_violations.length > 0) {
    console.log(`    × 违反 must_exclude：${c.must_exclude_violations.join("、")}`);
  }
}

if (report.comparison_to_baseline) {
  console.log("");
  console.log("对比 baseline：");
  console.log(`  precision Δ：${report.comparison_to_baseline.precision_delta >= 0 ? "+" : ""}${report.comparison_to_baseline.precision_delta.toFixed(3)}`);
  console.log(`  可替代 baseline：${report.comparison_to_baseline.accept_as_baseline_replacement ? "✓" : "✗"}`);
}

if (!report.aggregate.pass_threshold) process.exit(1);