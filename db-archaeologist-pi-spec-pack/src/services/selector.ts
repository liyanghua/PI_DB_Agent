// Tool selector service:
//   1. intent_parse  : map task text → relevant capabilities/domains via keyword + KG.
//   2. tool_match    : pick tools whose (domain, capability) align; sort by quality of primary API.
//   3. param_gap     : compute missing params (required ∩ ¬known_params).
//   4. risk_filter   : surface blocked APIs and risky tools.
//   5. call_order    : domain-aware ordering heuristic.

import { getCards, getTools, getCard, getBlocked } from "./registry.js";
import type { ApiAssetCard, ToolRegistryEntry } from "../lib/types.js";

type ToolEntry = ToolRegistryEntry & { input_schema: { properties?: Record<string, unknown>; required?: string[] } };

const TASK_KEYWORDS: Array<{ keyword: string; capability?: string; domain?: string; weight: number }> = [
  { keyword: "转化", domain: "商品域", capability: "商品核心指标", weight: 1 },
  { keyword: "下滑", domain: "商品域", capability: "商品诊断", weight: 1 },
  { keyword: "下降", domain: "商品域", capability: "商品诊断", weight: 1 },
  { keyword: "诊断", domain: "商品域", capability: "商品诊断", weight: 1 },
  { keyword: "推广", domain: "投流域", weight: 1 },
  { keyword: "广告", domain: "投流域", weight: 1 },
  { keyword: "直通车", domain: "投流域", capability: "直通车", weight: 1 },
  { keyword: "万相台", domain: "投流域", capability: "万相台", weight: 1 },
  { keyword: "流量", domain: "流量域", weight: 1 },
  { keyword: "访客", domain: "流量域", weight: 0.6 },
  { keyword: "关键词", domain: "关键词域", weight: 1 },
  { keyword: "蓝海", domain: "关键词域", capability: "关键词机会发现", weight: 1 },
  { keyword: "竞品", domain: "竞争域", weight: 1 },
  { keyword: "竞争", domain: "竞争域", capability: "竞争格局", weight: 1 },
  { keyword: "格局", domain: "竞争域", capability: "竞争格局", weight: 1 },
  { keyword: "价格带", domain: "价格带域", capability: "价格带分析", weight: 1 },
  { keyword: "评论", domain: "评论口碑域", weight: 1 },
  { keyword: "好评", domain: "评论口碑域", weight: 1 },
  { keyword: "主图", domain: "视觉素材域", weight: 1 },
  { keyword: "卖点", domain: "视觉素材域", capability: "卖点分析", weight: 1 },
  { keyword: "类目", domain: "类目域", weight: 0.7 },
  { keyword: "店铺", domain: "店铺域", weight: 0.6 },
  { keyword: "sku", domain: "商品域", capability: "SKU分析", weight: 1 },
  { keyword: "商品", domain: "商品域", weight: 0.5 },
  { keyword: "人群", domain: "人群域", weight: 1 },
  { keyword: "画像", domain: "人群域", weight: 1 },
];

const ORDER_PRIORITY: Record<string, number> = {
  "商品域:商品基础信息": 1,
  "商品域:商品分析": 2,
  "商品域:商品核心指标": 3,
  "商品域:商品诊断": 4,
  "商品域:SKU分析": 5,
  "流量域:流量结构": 6,
  "投流域:推广花费": 7,
  "投流域:直通车": 7,
  "投流域:万相台": 7,
  "评论口碑域:好评分析": 8,
  "评论口碑域:评论分析": 8,
  "视觉素材域:主图分析": 9,
  "视觉素材域:卖点分析": 9,
  "竞争域:竞争格局": 10,
  "关键词域:关键词分析": 11,
  "关键词域:关键词机会发现": 11,
};

function priorityOf(t: ToolEntry): number {
  const key = `${t.domain}:${t.capability ?? ""}`;
  return ORDER_PRIORITY[key] ?? 50;
}

export type ToolPlanItem = {
  tool_id: string;
  call_order: number;
  reason: string;
  required_params: string[];
  missing_params: string[];
  source_apis: string[];
  quality_score: number;
  risks: string[];
};

export type ToolPlan = {
  task: string;
  intent: string;
  recommended_tools: ToolPlanItem[];
  blocked_or_deprioritized: Array<{ ref: string; reason: string }>;
  next_question: string;
};

function parseIntent(task: string): {
  domains: Map<string, number>;
  capabilities: Map<string, number>;
  hints: string[];
} {
  const domains = new Map<string, number>();
  const capabilities = new Map<string, number>();
  const hints: string[] = [];
  const lower = task.toLowerCase();
  for (const r of TASK_KEYWORDS) {
    if (lower.includes(r.keyword.toLowerCase())) {
      hints.push(r.keyword);
      if (r.domain) domains.set(r.domain, (domains.get(r.domain) ?? 0) + r.weight);
      if (r.capability) capabilities.set(r.capability, (capabilities.get(r.capability) ?? 0) + r.weight);
    }
  }
  return { domains, capabilities, hints };
}

function qualityForTool(t: ToolEntry): number {
  const apiId = (t.source_apis ?? [])[0];
  const card = apiId ? getCard(apiId) : undefined;
  return card?.quality_score ?? 0.5;
}

function risksForTool(t: ToolEntry): string[] {
  const risks: string[] = [];
  const apis = [...(t.source_apis ?? []), ...(t.fallback_apis ?? [])];
  for (const id of apis) {
    const card = getCard(id);
    if (!card) continue;
    if (/\{[^}]+\}/.test(card.path)) risks.push(`${id}:path_placeholder`);
    if ((card.issues ?? []).some(i => i.type === "missing_response_fields")) risks.push(`${id}:missing_response_fields`);
  }
  return risks;
}

function scoreToolForIntent(t: ToolEntry, domains: Map<string, number>, capabilities: Map<string, number>): number {
  let s = 0;
  if (domains.has(t.domain)) s += 2 * domains.get(t.domain)!;
  if (t.capability && capabilities.has(t.capability)) s += 3 * capabilities.get(t.capability)!;
  s += 0.5 * qualityForTool(t);
  if (t.origin === "manual") s += 0.5;
  return s;
}

export function selectToolsForTask(task: string, knownParams: Record<string, unknown> = {}): ToolPlan {
  const tools = getTools() as ToolEntry[];
  const { domains, capabilities, hints } = parseIntent(task);

  if (domains.size === 0 && capabilities.size === 0) {
    return {
      task,
      intent: "unparsed",
      recommended_tools: [],
      blocked_or_deprioritized: [],
      next_question: "请说明分析对象（商品/关键词/竞品/店铺）和时间范围。",
    };
  }

  const scored = tools
    .filter(t => t.domain !== "公共基础域")
    .map(t => ({ t, score: scoreToolForIntent(t, domains, capabilities) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || priorityOf(a.t) - priorityOf(b.t));

  const top = scored.slice(0, 6);

  const knownKeys = new Set(Object.keys(knownParams).filter(k => knownParams[k] !== undefined && knownParams[k] !== ""));
  const items: ToolPlanItem[] = top.map(({ t }, idx) => {
    const allRequired = ((t.input_schema?.required as string[]) ?? []);
    const allParams = Object.keys((t.input_schema?.properties as Record<string, unknown>) ?? {});
    const isUsableParam = (p: string) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p) && p.length <= 32;
    const requiredParams = (allRequired.length ? allRequired : allParams).filter(isUsableParam).slice(0, 6);
    const missing = requiredParams.filter(k => !knownKeys.has(k));
    const apiPaths: string[] = [];
    for (const id of t.source_apis ?? []) {
      const card = getCard(id);
      if (card) apiPaths.push(card.path);
      else apiPaths.push(id);
    }
    return {
      tool_id: t.tool_id,
      call_order: idx + 1,
      reason: `intent_match domain=${t.domain} capability=${t.capability ?? ""} hints=[${hints.join(",")}]`,
      required_params: requiredParams,
      missing_params: missing,
      source_apis: apiPaths,
      quality_score: qualityForTool(t),
      risks: risksForTool(t),
    };
  });

  items.sort((a, b) => {
    const pa = priorityOf(tools.find(t => t.tool_id === a.tool_id)! as ToolEntry);
    const pb = priorityOf(tools.find(t => t.tool_id === b.tool_id)! as ToolEntry);
    return pa - pb;
  });
  items.forEach((it, i) => (it.call_order = i + 1));

  const blockedAll = getBlocked().blocked;
  const blocked: Array<{ ref: string; reason: string }> = [];
  const cardsByDomain: ApiAssetCard[] = getCards().filter(c => domains.has(c.domain));
  for (const c of cardsByDomain) {
    const b = blockedAll.find(x => x.api_id === c.api_id);
    if (b) blocked.push({ ref: c.api_id, reason: b.reasons.join("|") });
  }

  const allMissing = items.flatMap(it => it.missing_params);
  const uniqMissing = [...new Set(allMissing)];
  const fillHints: string[] = [];
  if (uniqMissing.some(p => /date|date_range|start|end|period|month|day/i.test(p))) {
    fillHints.push("时间范围（start_date / end_date）");
  }
  if (uniqMissing.some(p => /goods_id|item_id/i.test(p))) fillHints.push("商品 ID");
  if (uniqMissing.some(p => /keyword|search_value/i.test(p))) fillHints.push("关键词");
  if (uniqMissing.some(p => /category|cate/i.test(p))) fillHints.push("类目");
  const next_question = uniqMissing.length
    ? `请提供：${uniqMissing.join("、")}${fillHints.length ? `（建议补充 ${fillHints.join("，")}）` : ""}`
    : "已就绪，可直接调用。";

  return {
    task,
    intent: hints.join(" | "),
    recommended_tools: items,
    blocked_or_deprioritized: blocked.slice(0, 10),
    next_question,
  };
}