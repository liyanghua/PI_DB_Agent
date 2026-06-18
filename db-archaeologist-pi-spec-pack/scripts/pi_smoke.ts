// Mock pi runtime: invokes the extension and exercises every registered tool.
// Skips typebox; the mock only needs registerTool() and execute() to fire.

import path from "node:path";
import { pathToFileURL } from "node:url";

type RegisteredTool = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
};

const tools: RegisteredTool[] = [];
const piMock = {
  registerTool(t: RegisteredTool) {
    tools.push(t);
  },
};

const extPath = path.resolve("./.pi/extensions/db_archaeologist.extension.ts");
const mod = (await import(pathToFileURL(extPath).href)) as { default: (pi: typeof piMock) => void };
mod.default(piMock);

console.log(`Registered ${tools.length} tools:`);
for (const t of tools) console.log(`  - ${t.name}`);

const cases: Array<{ name: string; params: Record<string, unknown> }> = [
  { name: "ask_api_catalog", params: { question: "有没有查商品核心指标的接口？", limit: 3 } },
  { name: "select_tools_for_task", params: { task: "分析某个商品最近7天转化下降的原因", known_params: { goods_id: "1" } } },
  { name: "get_api_asset_card", params: { api_id: "agent_goods_id_ads_fact_item_summary_d" } },
  { name: "explain_tool_lineage", params: { tool_id: "get_goods_core_metrics" } },
  { name: "list_domain_apis", params: { domain: "商品域", status: "agent_ready", limit: 3 } },
  { name: "list_api_quality_issues", params: { issue_type: "missing_response_fields", limit: 3 } },
  { name: "probe_api_sample", params: { api_id: "agent_goods_id_ads_fact_item_summary_d", top: 3 } },
  { name: "propose_insight_plan", params: { topic: "竞争格局分析", candidate_limit: 6 } },
  { name: "analyze_keyword_demand", params: { category: "入户地垫", top_n: 5, per_demand_type_top: 3 } },
  { name: "list_keyword_runs", params: { limit: 3, category: "入户地垫" } },
];

const runIds: string[] = [];

for (const c of cases) {
  const t = tools.find(x => x.name === c.name);
  if (!t) {
    console.error(`Missing tool ${c.name}`);
    process.exit(1);
  }
  const r = (await t.execute("test", c.params)) as { content: Array<{ text: string }>; details: unknown };
  console.log(`\n=== ${c.name} ===`);
  console.log(r.content[0].text.slice(0, 400));
  if (c.name === "analyze_keyword_demand") {
    const d = (r as { details?: { run_id?: string } }).details;
    if (d?.run_id) runIds.push(d.run_id);
  }
}

// 再跑一次 analyze 拿到第二个 run_id（同 category，hash 相同会复用同一目录，配 timestamp 会不同）
const analyzeTool = tools.find(x => x.name === "analyze_keyword_demand")!;
const r2 = (await analyzeTool.execute("test2", { category: "入户地垫", top_n: 5 })) as { details?: { run_id?: string } };
if (r2.details?.run_id) runIds.push(r2.details.run_id);

if (runIds.length >= 2 && runIds[0] !== runIds[1]) {
  const compareTool = tools.find(x => x.name === "compare_keyword_runs")!;
  const r = (await compareTool.execute("test", { run_id_a: runIds[0], run_id_b: runIds[1] })) as { content: Array<{ text: string }> };
  console.log(`\n=== compare_keyword_runs ===`);
  console.log(r.content[0].text.slice(0, 400));
} else {
  console.log(`\n=== compare_keyword_runs === skipped (run_ids=${runIds.join(",")})`);
}