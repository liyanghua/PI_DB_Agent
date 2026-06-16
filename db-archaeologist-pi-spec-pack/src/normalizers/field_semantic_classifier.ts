// Field semantic classifier:
//   - alias-driven metric matching (registry/metric_dictionary.seed.yaml)
//   - lightweight entity inference per card (商品/店铺/类目/关键词/人群/SKU/订单)
// Outputs metric_mapping[] + entity_mapping[] for an ApiAssetCard.

import type { ApiAssetCard, MetricMapping, EntityMapping, ResponseField } from "../lib/types.js";

export type MetricDict = {
  metrics: Record<
    string,
    {
      cn_name: string;
      type: string;
      aliases?: string[];
    }
  >;
};

export function buildAliasIndex(dict: MetricDict): Map<string, string> {
  const idx = new Map<string, string>();
  for (const [metric, entry] of Object.entries(dict.metrics ?? {})) {
    idx.set(metric.toLowerCase(), metric);
    idx.set((entry.cn_name ?? "").toLowerCase(), metric);
    for (const alias of entry.aliases ?? []) {
      idx.set(alias.toLowerCase(), metric);
    }
  }
  return idx;
}

export function classifyMetrics(
  fields: ResponseField[],
  aliasIndex: Map<string, string>
): MetricMapping[] {
  const out: MetricMapping[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    const candidates = [f.name ?? "", f.desc ?? ""].map(s => s.toLowerCase().trim()).filter(Boolean);
    let metric: string | undefined;
    let via: MetricMapping["via"] = "alias";
    for (const c of candidates) {
      if (aliasIndex.has(c)) {
        metric = aliasIndex.get(c);
        via = "alias";
        break;
      }
    }
    if (!metric) {
      for (const c of candidates) {
        for (const [alias, m] of aliasIndex) {
          if (alias.length >= 4 && c.includes(alias)) {
            metric = m;
            via = "name_match";
            break;
          }
        }
        if (metric) break;
      }
    }
    if (!metric) continue;
    const key = `${f.path}::${metric}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ field_path: f.path, metric, via });
  }
  return out;
}

const ENTITY_RULES: Array<{ entity: string; keywords: string[] }> = [
  { entity: "Product", keywords: ["goods", "item", "商品", "sku", "spu", "宝贝"] },
  { entity: "SKU", keywords: ["sku"] },
  { entity: "Shop", keywords: ["shop", "店铺", "tenant"] },
  { entity: "Category", keywords: ["category", "cate", "类目"] },
  { entity: "Keyword", keywords: ["keyword", "关键词", "search_word", "词根", "搜索词"] },
  { entity: "User", keywords: ["user", "buyer", "客户", "人群"] },
  { entity: "Brand", keywords: ["brand", "品牌"] },
  { entity: "Order", keywords: ["order", "订单", "trade"] },
  { entity: "Promotion", keywords: ["promotion", "ad_", "推广", "投放", "campaign"] },
];

export function inferEntities(card: ApiAssetCard): EntityMapping[] {
  const haystack = [
    card.name ?? "",
    card.module ?? "",
    card.path ?? "",
    ...(card.request_schema?.query ?? []).map(p => `${p.name} ${p.desc ?? ""}`),
    ...((card.request_schema?.body ?? []) ?? []).map(p => `${p.name} ${p.desc ?? ""}`),
    ...(card.response_schema?.fields ?? []).map(f => `${f.name ?? ""} ${f.desc ?? ""}`),
  ]
    .join(" ")
    .toLowerCase();

  const seen = new Map<string, Set<string>>();
  for (const rule of ENTITY_RULES) {
    for (const kw of rule.keywords) {
      if (haystack.includes(kw.toLowerCase())) {
        const set = seen.get(rule.entity) ?? new Set<string>();
        set.add(kw);
        seen.set(rule.entity, set);
      }
    }
  }
  const out: EntityMapping[] = [];
  for (const [entity, kws] of seen) {
    out.push({ entity, evidence: [...kws] });
  }
  return out;
}