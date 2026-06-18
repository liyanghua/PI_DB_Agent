// keyword_compare.ts: CLI 对比两个 run
// 用法：node --import ./scripts/ts_loader.mjs scripts/keyword_compare.ts <run_id_a> <run_id_b> [top_k]

import { compareRuns } from "../src/services/keyword_demand/compare.js";

const argv = process.argv.slice(2);
const runA = argv[0];
const runB = argv[1];
const topK = argv[2] != null ? parseInt(argv[2], 10) : 20;

if (!runA || !runB) {
  console.error("用法：node --import ./scripts/ts_loader.mjs scripts/keyword_compare.ts <run_id_a> <run_id_b> [top_k]");
  process.exit(1);
}

const out = await compareRuns({ run_id_a: runA, run_id_b: runB, top_k: topK });

if ("error" in out) {
  console.error("[FAIL]", out.error, out.details ?? "");
  process.exit(1);
}

const r = out.result;
console.log(`✓ 对比完成`);
console.log(`  json: ${out.paths.json}`);
console.log(`  md  : ${out.paths.md}`);
console.log("");
console.log(`类目：${r.run_a.category}（${r.run_a.category_id}）`);
console.log(`策略：${r.run_a.strategy} vs ${r.run_b.strategy}`);
console.log(`Top@${r.top_k} 重叠率：${(r.overlap_rate * 100).toFixed(1)}%`);
console.log(`Spearman：${r.ranking_correlation.spearman.toFixed(3)}, Kendall：${r.ranking_correlation.kendall_tau.toFixed(3)}, NDCG：${r.ranking_correlation.ndcg_at_k.toFixed(3)}`);
console.log("");
console.log("决议建议：");
console.log(r.recommendation.split("\n").map((l) => `  ${l}`).join("\n"));