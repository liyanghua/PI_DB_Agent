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
];

for (const c of cases) {
  const t = tools.find(x => x.name === c.name);
  if (!t) {
    console.error(`Missing tool ${c.name}`);
    process.exit(1);
  }
  const r = (await t.execute("test", c.params)) as { content: Array<{ text: string }>; details: unknown };
  console.log(`\n=== ${c.name} ===`);
  console.log(r.content[0].text.slice(0, 400));
}