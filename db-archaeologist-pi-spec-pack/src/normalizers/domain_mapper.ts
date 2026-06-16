// Domain mapper v2: returns {domain, capability, evidence[], confidence, locked}.
// Evidence sources scored independently:
//   path keyword (strong, weight 0.45)
//   module keyword (medium, 0.25)
//   name keyword (medium, 0.25)
//   field keyword (weak, 0.15)
// Confidence = clamp(sum_of_winning_evidence_weights, 0, 1).
// Capability is inferred per-domain via secondary keyword sets.

import type { ApiAssetCard, DomainMapping } from "../lib/types.js";

type Rule = { keyword: string; domain: string; capability?: string };

const DOMAIN_RULES: Rule[] = [
  { keyword: "blue_ocean", domain: "关键词域", capability: "关键词机会发现" },
  { keyword: "蓝海", domain: "关键词域", capability: "关键词机会发现" },
  { keyword: "keyword", domain: "关键词域", capability: "关键词分析" },
  { keyword: "关键词", domain: "关键词域", capability: "关键词分析" },
  { keyword: "词根", domain: "关键词域", capability: "词根聚合" },
  { keyword: "搜索词", domain: "关键词域", capability: "搜索词分析" },

  { keyword: "competition", domain: "竞争域", capability: "竞争格局" },
  { keyword: "竞品", domain: "竞争域", capability: "竞品对比" },
  { keyword: "竞争", domain: "竞争域", capability: "竞争格局" },
  { keyword: "top300", domain: "竞争域", capability: "竞争格局" },
  { keyword: "格局", domain: "竞争域", capability: "竞争格局" },

  { keyword: "price_band", domain: "价格带域", capability: "价格带分析" },
  { keyword: "价格带", domain: "价格带域", capability: "价格带分析" },

  { keyword: "promotion", domain: "投流域", capability: "推广花费" },
  { keyword: "推广", domain: "投流域", capability: "推广花费" },
  { keyword: "ad_", domain: "投流域", capability: "广告投放" },
  { keyword: "付费", domain: "投流域", capability: "付费推广" },
  { keyword: "直通车", domain: "投流域", capability: "直通车" },
  { keyword: "万相台", domain: "投流域", capability: "万相台" },

  { keyword: "traffic", domain: "流量域", capability: "流量结构" },
  { keyword: "flow", domain: "流量域", capability: "流量结构" },
  { keyword: "流量", domain: "流量域", capability: "流量结构" },

  { keyword: "sku", domain: "商品域", capability: "SKU分析" },
  { keyword: "ads_fact_item", domain: "商品域", capability: "商品核心指标" },
  { keyword: "goods_id", domain: "商品域", capability: "商品基础信息" },
  { keyword: "goods", domain: "商品域", capability: "商品分析" },
  { keyword: "商品诊断", domain: "商品域", capability: "商品诊断" },
  { keyword: "商品", domain: "商品域", capability: "商品分析" },
  { keyword: "宽表", domain: "商品域", capability: "商品宽表" },

  { keyword: "主图", domain: "视觉素材域", capability: "主图分析" },
  { keyword: "详情页", domain: "视觉素材域", capability: "详情页分析" },
  { keyword: "卖点", domain: "视觉素材域", capability: "卖点分析" },

  { keyword: "评论", domain: "评论口碑域", capability: "评论分析" },
  { keyword: "好评", domain: "评论口碑域", capability: "好评分析" },
  { keyword: "问大家", domain: "评论口碑域", capability: "问答分析" },

  { keyword: "shop", domain: "店铺域", capability: "店铺数据" },
  { keyword: "店铺", domain: "店铺域", capability: "店铺数据" },

  { keyword: "category", domain: "类目域", capability: "类目结构" },
  { keyword: "类目", domain: "类目域", capability: "类目结构" },

  { keyword: "metric", domain: "指标域", capability: "指标查询" },
  { keyword: "指标", domain: "指标域", capability: "指标查询" },
  { keyword: "topic", domain: "指标域", capability: "指标主题" },
  { keyword: "ind_", domain: "指标域", capability: "指标查询" },

  { keyword: "task", domain: "任务域", capability: "任务管理" },
  { keyword: "kpi", domain: "任务域", capability: "KPI" },
  { keyword: "任务", domain: "任务域", capability: "任务管理" },

  { keyword: "tenant", domain: "租户连接域", capability: "租户" },
  { keyword: "register", domain: "租户连接域", capability: "注册" },
  { keyword: "数据连接器", domain: "租户连接域", capability: "数据连接器" },
  { keyword: "授权", domain: "租户连接域", capability: "授权" },

  { keyword: "人群", domain: "人群域", capability: "人群画像" },
  { keyword: "画像", domain: "人群域", capability: "人群画像" },
];

const W = { path: 0.45, module: 0.25, name: 0.25, field: 0.15 };

type DomainEvidence = { domain: string; capability?: string; weight: number; reason: string };

export function inferDomainV2(card: {
  name: string;
  module: string;
  path: string;
  response_schema?: { fields?: { name?: string; desc?: string }[] };
}): DomainMapping {
  const evidences: DomainEvidence[] = [];

  const collect = (text: string, weight: number, channel: string) => {
    const haystack = text.toLowerCase();
    for (const rule of DOMAIN_RULES) {
      if (haystack.includes(rule.keyword.toLowerCase())) {
        evidences.push({
          domain: rule.domain,
          capability: rule.capability,
          weight,
          reason: `${channel}:${rule.keyword}`,
        });
      }
    }
  };

  collect(card.path ?? "", W.path, "path");
  collect(card.module ?? "", W.module, "module");
  collect(card.name ?? "", W.name, "name");

  const fields = card.response_schema?.fields ?? [];
  const fieldText = fields.map(f => `${f.name ?? ""} ${f.desc ?? ""}`).join(" ");
  collect(fieldText, W.field, "field");

  if (evidences.length === 0) {
    return { domain: "未分类域", confidence: 0, evidence: ["no_keyword_match"], locked: false };
  }

  const tally = new Map<string, { weight: number; reasons: string[]; capabilities: Map<string, number> }>();
  for (const e of evidences) {
    const cur = tally.get(e.domain) ?? { weight: 0, reasons: [], capabilities: new Map() };
    cur.weight += e.weight;
    cur.reasons.push(e.reason);
    if (e.capability) {
      cur.capabilities.set(e.capability, (cur.capabilities.get(e.capability) ?? 0) + e.weight);
    }
    tally.set(e.domain, cur);
  }

  let bestDomain = "未分类域";
  let bestEntry: { weight: number; reasons: string[]; capabilities: Map<string, number> } | null = null;
  for (const [domain, entry] of tally) {
    if (!bestEntry || entry.weight > bestEntry.weight) {
      bestDomain = domain;
      bestEntry = entry;
    }
  }
  if (!bestEntry) {
    return { domain: "未分类域", confidence: 0, evidence: ["no_keyword_match"], locked: false };
  }

  let bestCap: string | undefined;
  let bestCapWeight = -1;
  for (const [cap, w] of bestEntry.capabilities) {
    if (w > bestCapWeight) {
      bestCap = cap;
      bestCapWeight = w;
    }
  }

  const confidence = Math.max(0, Math.min(1, bestEntry.weight));

  return {
    domain: bestDomain,
    capability: bestCap,
    confidence: Math.round(confidence * 1000) / 1000,
    evidence: bestEntry.reasons,
    locked: false,
  };
}

export function applyLockedOverrides(
  cards: ApiAssetCard[],
  locked: Record<string, { domain?: string; capability?: string }>
): void {
  for (const card of cards) {
    const ov = locked[card.api_id];
    if (!ov) continue;
    const dm = card.domain_mapping ?? { domain: card.domain, confidence: 0, evidence: [], locked: false };
    if (ov.domain) {
      card.domain = ov.domain;
      dm.domain = ov.domain;
    }
    if (ov.capability) {
      card.capability = ov.capability;
      dm.capability = ov.capability;
    }
    dm.locked = true;
    dm.evidence = [...dm.evidence, "manual_lock"];
    dm.confidence = 1;
    card.domain_mapping = dm;
  }
}

export function inferDomain(input: { name: string; module: string; path: string }): string {
  return inferDomainV2({ name: input.name, module: input.module, path: input.path }).domain;
}