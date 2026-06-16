// Captures real outputs from each pi tool for the four demo scenarios in the
// PRD (商品下滑 / 蓝海关键词 / 竞争 V3 / 空返回排查). Output goes to demo/session.md.

import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

type RegisteredTool = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details: unknown;
  }>;
};

const tools: RegisteredTool[] = [];
const piMock = { registerTool(t: RegisteredTool) { tools.push(t); } };

const extPath = path.resolve("./.pi/extensions/db_archaeologist.extension.ts");
const mod = (await import(pathToFileURL(extPath).href)) as { default: (pi: typeof piMock) => void };
mod.default(piMock);

type Step = { user: string; tool: string; params: Record<string, unknown> };
type Scene = { title: string; intro: string; steps: Step[] };

const scenes: Scene[] = [
  {
    title: "Scene 1 — 商品最近 7 天转化下降归因",
    intro: "Agent 先用 select_tools_for_task 列出工具链与参数缺口，再用 list_domain_apis 看商品域候选接口。",
    steps: [
      { user: "分析商品 1234 最近 7 天转化下降的原因", tool: "select_tools_for_task", params: { task: "分析商品 1234 最近 7 天转化下降的原因", known_params: { goods_id: "1234" } } },
      { user: "商品域里目前 agent_ready 的接口都有哪些？", tool: "list_domain_apis", params: { domain: "商品域", status: "agent_ready", limit: 5 } },
    ],
  },
  {
    title: "Scene 2 — 蓝海关键词挖掘",
    intro: "ask_api_catalog 直接做问答，再用 explain_tool_lineage 解释字段血缘。",
    steps: [
      { user: "有没有可以挖蓝海关键词的接口？", tool: "ask_api_catalog", params: { question: "蓝海关键词挖掘", domain: "关键词域", limit: 5 } },
      { user: "搜索人气这个指标具体来自哪个接口？", tool: "explain_tool_lineage", params: { metric: "搜索人气" } },
    ],
  },
  {
    title: "Scene 3 — 竞争格局 V3",
    intro: "ask_api_catalog 做接口定位，get_api_asset_card 拉完整资产卡确认入参。",
    steps: [
      { user: "哪个接口能查竞争格局 V3？", tool: "ask_api_catalog", params: { question: "竞争格局 V3 哪个接口", limit: 3 } },
      { user: "把这张卡完整给我看看", tool: "get_api_asset_card", params: { api_id: "data_competition_pattern_analysis" } },
    ],
  },
  {
    title: "Scene 4 — 空返回 / 字段缺失排查",
    intro: "list_api_quality_issues 过滤问题接口，确认它们没进 tool_registry。",
    steps: [
      { user: "返回字段说明缺失的接口有哪些？", tool: "list_api_quality_issues", params: { issue_type: "missing_response_fields", limit: 5 } },
      { user: "路径里带 {api-id} 占位符的接口都被屏蔽了吗？", tool: "list_api_quality_issues", params: { issue_type: "path_placeholder", limit: 5 } },
    ],
  },
];

const lines: string[] = [];
lines.push("# DB Archaeologist Demo Session");
lines.push("");
lines.push("以下 transcript 全部由 `npm run smoke:pi` 等价路径自动捕获，工具回包来自 `.pi/extensions/db_archaeologist.extension.ts`，数据全部来自 `registry/derived/`。");
lines.push("");

for (const scene of scenes) {
  lines.push(`## ${scene.title}`);
  lines.push("");
  lines.push(scene.intro);
  lines.push("");
  for (const step of scene.steps) {
    const tool = tools.find(t => t.name === step.tool);
    if (!tool) throw new Error(`tool ${step.tool} not registered`);
    const r = await tool.execute("demo", step.params);
    const text = r.content[0].text;
    const trimmed = text.length > 1800 ? text.slice(0, 1800) + "\n…(truncated)" : text;
    lines.push(`**User**: ${step.user}`);
    lines.push("");
    lines.push(`**Tool call**: \`${step.tool}\``);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(step.params, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("**Tool result**:");
    lines.push("");
    lines.push("```json");
    lines.push(trimmed);
    lines.push("```");
    lines.push("");
  }
}

mkdirSync("demo", { recursive: true });
writeFileSync("demo/session.md", lines.join("\n"));
console.log(`Wrote demo/session.md with ${scenes.length} scenes.`);