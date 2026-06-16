// Smoke check for services. Not a full test, just a sanity ping for stage 6.

import { askApiCatalog } from "../services/qa.js";
import { selectToolsForTask } from "../services/selector.js";
import { lineageOfTool, lineageOfMetric } from "../services/lineage.js";

const QAS = [
  "有没有查商品核心指标的接口？",
  "关键词趋势分析有哪些接口？",
  "哪个接口能查竞争格局V3？",
  "哪些接口返回字段说明为空？",
];

console.log("=== askApiCatalog ===");
for (const q of QAS) {
  const r = askApiCatalog(q, { limit: 3 });
  console.log(`Q: ${q}`);
  for (const c of r.candidates) {
    console.log(`  - ${c.method} ${c.path} | ${c.domain} | q=${c.quality_score} | ${c.lifecycle_status}`);
  }
}

console.log("\n=== selectToolsForTask ===");
const plan = selectToolsForTask("分析某个商品最近7天转化下降的原因", {});
console.log(`intent: ${plan.intent}`);
for (const it of plan.recommended_tools) {
  console.log(`  ${it.call_order}. ${it.tool_id} q=${it.quality_score} missing=${it.missing_params.join(",")}`);
}
console.log(`next_question: ${plan.next_question}`);

console.log("\n=== lineageOfTool(get_goods_core_metrics) ===");
const lin = lineageOfTool("get_goods_core_metrics");
if (lin) console.log(lin.text.split("\n").slice(0, 12).join("\n"));

console.log("\n=== lineageOfMetric(pay_rate) ===");
console.log(lineageOfMetric("pay_rate").text.split("\n").slice(0, 8).join("\n"));