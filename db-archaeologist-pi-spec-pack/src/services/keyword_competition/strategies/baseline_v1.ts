// src/services/keyword_competition/strategies/baseline_v1.ts
// CPS baseline_v1：CPS = 0.60 × competition_index + 0.40 × market_avg_bid_normalized
//
// Phase 3 Batch 2 双源重构后：
//   - competition_index 子分数主源 = distinct_shop_count_log（竞争域类目聚合，aggregation_kind=category_broadcast）
//   - market_avg_bid 子分数主源 = avg_cost_per_clk（投流域关键词级，aggregation_kind=keyword_native）
//   - cpc_source=missing 且 ci 可用 → solo_competition_index 路径
// 子分数回退链与自洽规范见 docs/20 §2.

import type {
  AggregationKind,
  CompetitionMetricRecord,
  CompetitionScoreRecord,
  CpsExplanation,
  CpsSubScoreDetail,
  CpsWeights,
} from "../types.js";

interface SubScoreOutcome {
  detail: CpsSubScoreDetail;
  available: boolean;
  aggregation_kind?: AggregationKind;
}

export function scoreWithCpsBaseline(
  records: CompetitionMetricRecord[],
  weights: CpsWeights,
): { scored: CompetitionScoreRecord[]; trace_lines: object[] } {
  const scored: CompetitionScoreRecord[] = [];
  const trace_lines: object[] = [];

  for (const r of records) {
    const ci = computeCompetitionIndex(r, weights);
    const mb = computeMarketAvgBid(r, weights);

    const fallbackChain: string[] = [];
    if (!ci.available && !mb.available) {
      trace_lines.push({ keyword: r.keyword, reason: "skipped_no_signal" });
      continue;
    }

    let cps: number;
    let formula: string;

    if (ci.available && mb.available) {
      cps =
        weights.base_cps.competition_index * ci.detail.normalized_value +
        weights.base_cps.market_avg_bid * mb.detail.normalized_value;
      formula = `${weights.base_cps.competition_index} × competition_index_normalized + ${weights.base_cps.market_avg_bid} × market_avg_bid_normalized`;
    } else if (ci.available) {
      cps = ci.detail.normalized_value;
      formula = `solo_competition_index → CPS = competition_index_normalized`;
      fallbackChain.push("solo_competition_index");
    } else {
      cps = mb.detail.normalized_value;
      formula = `solo_market_avg_bid → CPS = market_avg_bid_normalized`;
      fallbackChain.push("solo_market_avg_bid");
    }

    cps = clip01_100(cps);

    const level = pickLevel(cps, weights);

    const explanation: CpsExplanation = {
      field_provenance: buildProvenance(r, ci, mb),
      subscores: [ci.detail, mb.detail],
      formula,
      cps_level: level.code,
      fallback_chain: dedupe([...fallbackChain, ...ci.detail.fallback_chain, ...mb.detail.fallback_chain]),
      rank_reason: buildRankReason(cps, ci, mb, level.cn_name, r.cpc_source),
    };

    scored.push({
      ...r,
      cps,
      subscores: {
        competition_index: ci.detail.normalized_value,
        market_avg_bid: mb.detail.normalized_value,
      },
      explanation,
    });
    trace_lines.push({ keyword: r.keyword, cps, explanation });
  }

  return { scored, trace_lines };
}

function computeCompetitionIndex(r: CompetitionMetricRecord, weights: CpsWeights): SubScoreOutcome {
  const chain = weights.competition_index_fallback;
  const fallbackSrc = r.source?.[0];
  const srcOf = (field: string): string | undefined => r.field_source_api?.[field] ?? fallbackSrc;
  for (const code of chain) {
    if (code === "distinct_shop_count_log" && typeof r.distinct_shop_count === "number" && r.distinct_shop_count > 0) {
      const v = clip01_100(Math.log10(r.distinct_shop_count + 1) * 25);
      return {
        available: true,
        aggregation_kind: "category_broadcast",
        detail: {
          name: "competition_index",
          formula: "log10(distinct_shop_count + 1) × 25 (类目聚合广播)",
          raw_value: r.distinct_shop_count,
          normalized_value: v,
          fallback_chain: [],
          raw_field: "distinct_shop_count",
          source_api: srcOf("distinct_shop_count"),
        },
      };
    }
    if (code === "brand_concentration_top3" && typeof r.brand_concentration === "number") {
      const v = clip01_100(r.brand_concentration * 100);
      return {
        available: true,
        aggregation_kind: "category_broadcast",
        detail: {
          name: "competition_index",
          formula: "top3_brand_share × 100 (类目聚合广播)",
          raw_value: r.brand_concentration,
          normalized_value: v,
          fallback_chain: ["fallback_brand_concentration_top3"],
          raw_field: "brand_concentration",
          source_api: srcOf("brand_concentration"),
        },
      };
    }
    if (code === "competition_index" && typeof r.competition_index === "number") {
      const v = clip01_100(r.competition_index);
      return {
        available: true,
        aggregation_kind: "category_broadcast",
        detail: {
          name: "competition_index",
          formula: "raw competition_index (兼容旧 fixture)",
          raw_value: r.competition_index,
          normalized_value: v,
          fallback_chain: ["fallback_legacy_competition_index"],
          raw_field: "competition_index",
          source_api: srcOf("competition_index"),
        },
      };
    }
    if (code === "competitor_count_log" && typeof r.competitor_count === "number" && r.competitor_count > 0) {
      const v = clip01_100(Math.log10(r.competitor_count + 1) * 25);
      return {
        available: true,
        aggregation_kind: "category_broadcast",
        detail: {
          name: "competition_index",
          formula: "log10(competitor_count + 1) × 25 (兼容旧 fixture)",
          raw_value: r.competitor_count,
          normalized_value: v,
          fallback_chain: ["fallback_competitor_count_log"],
          raw_field: "competitor_count",
          source_api: srcOf("competitor_count"),
        },
      };
    }
    if (code === "solo_default") {
      return {
        available: false,
        detail: {
          name: "competition_index",
          formula: "solo_default = 50",
          normalized_value: 50,
          fallback_chain: ["solo_default"],
        },
      };
    }
  }
  return {
    available: false,
    detail: { name: "competition_index", normalized_value: 50, fallback_chain: ["no_signal_neutral_50"] },
  };
}

function computeMarketAvgBid(r: CompetitionMetricRecord, weights: CpsWeights): SubScoreOutcome {
  const chain = weights.market_avg_bid_fallback;
  const cap = weights.market_avg_bid_normalize.cap_cny;
  const logBase = weights.market_avg_bid_normalize.log_base;
  const denom = Math.log(cap + 1) / Math.log(logBase);
  const fallbackSrc = r.source?.[0];
  const srcOf = (field: string): string | undefined => r.field_source_api?.[field] ?? fallbackSrc;

  const normCpc = (cpc: number): number =>
    clip01_100((Math.log(cpc + 1) / Math.log(logBase) / denom) * 100);

  for (const code of chain) {
    if (code === "avg_cost_per_clk" && typeof r.avg_cpc_cny === "number" && r.cpc_source === "paid") {
      const v = normCpc(r.avg_cpc_cny);
      return {
        available: true,
        aggregation_kind: "keyword_native",
        detail: {
          name: "market_avg_bid",
          formula: `log${logBase}(avg_cost_per_clk + 1) / log${logBase}(${cap + 1}) × 100 (投流域 kw_name 级)`,
          raw_value: r.avg_cpc_cny,
          normalized_value: v,
          fallback_chain: [],
          raw_field: "avg_cost_per_clk",
          source_api: srcOf("avg_cpc_cny"),
        },
      };
    }
    if (code === "weighted_cost_per_clk" && typeof r.weighted_cost_per_clk === "number") {
      const v = normCpc(r.weighted_cost_per_clk);
      return {
        available: true,
        aggregation_kind: "keyword_native",
        detail: {
          name: "market_avg_bid",
          formula: `log${logBase}(weighted_cost_per_clk + 1) / log${logBase}(${cap + 1}) × 100 (sum(cost)/sum(clk))`,
          raw_value: r.weighted_cost_per_clk,
          normalized_value: v,
          fallback_chain: ["fallback_weighted_cost_per_clk"],
          raw_field: "weighted_cost_per_clk",
          source_api: srcOf("weighted_cost_per_clk"),
        },
      };
    }
    if (code === "avg_cpc_cny" && typeof r.avg_cpc_cny === "number" && r.cpc_source !== "paid") {
      const v = normCpc(r.avg_cpc_cny);
      return {
        available: true,
        aggregation_kind: "keyword_native",
        detail: {
          name: "market_avg_bid",
          formula: `log${logBase}(avg_cpc_cny + 1) / log${logBase}(${cap + 1}) × 100 (兼容旧 fixture)`,
          raw_value: r.avg_cpc_cny,
          normalized_value: v,
          fallback_chain: ["fallback_legacy_avg_cpc_cny"],
          raw_field: "avg_cpc_cny",
          source_api: srcOf("avg_cpc_cny"),
        },
      };
    }
    if (code === "market_avg_bid" && typeof r.market_avg_bid === "number") {
      const v = normCpc(r.market_avg_bid);
      return {
        available: true,
        aggregation_kind: "keyword_native",
        detail: {
          name: "market_avg_bid",
          formula: `兼容字段 log${logBase}(market_avg_bid + 1) / log${logBase}(${cap + 1}) × 100`,
          raw_value: r.market_avg_bid,
          normalized_value: v,
          fallback_chain: ["fallback_market_avg_bid_alias"],
          raw_field: "market_avg_bid",
          source_api: srcOf("market_avg_bid"),
        },
      };
    }
    if (code === "solo_default") {
      return {
        available: false,
        detail: {
          name: "market_avg_bid",
          formula: "solo_default = 30",
          normalized_value: 30,
          fallback_chain: ["solo_default"],
        },
      };
    }
  }
  return {
    available: false,
    detail: { name: "market_avg_bid", normalized_value: 30, fallback_chain: ["no_signal_neutral_30"] },
  };
}

function pickLevel(cps: number, weights: CpsWeights): { code: string; cn_name: string } {
  for (const lv of weights.cps_levels) {
    if (cps >= lv.min && cps < lv.max) return { code: lv.code, cn_name: lv.cn_name };
  }
  const last = weights.cps_levels[weights.cps_levels.length - 1];
  return { code: last.code, cn_name: last.cn_name };
}

function buildRankReason(
  cps: number,
  ci: SubScoreOutcome,
  mb: SubScoreOutcome,
  levelCn: string,
  cpcSource: CompetitionMetricRecord["cpc_source"],
): string {
  const ciTxt = ci.available ? `竞争指数 ${ci.detail.normalized_value.toFixed(0)}（类目广播）` : "竞争指数缺失";
  const mbTxt = mb.available
    ? `平均出价 ${mb.detail.normalized_value.toFixed(0)}（${cpcSource === "paid" ? "投流域" : "兼容字段"}）`
    : cpcSource === "missing"
      ? "未投放（无 CPC）"
      : "出价信号缺失";
  return `${levelCn}（CPS ${cps.toFixed(1)}：${ciTxt}；${mbTxt}）`;
}

function buildProvenance(
  r: CompetitionMetricRecord,
  ci: SubScoreOutcome,
  mb: SubScoreOutcome,
): CpsExplanation["field_provenance"] {
  const prov: CpsExplanation["field_provenance"] = {};
  const fallbackSrc = r.source?.[0] ?? "unknown";
  const srcOf = (field: string): string => r.field_source_api?.[field] ?? fallbackSrc;

  if (typeof r.distinct_shop_count === "number") {
    prov.distinct_shop_count = {
      value: r.distinct_shop_count,
      source_api: srcOf("distinct_shop_count"),
      raw_field: "distinct_shop_count",
      aggregation_kind: "category_broadcast",
    };
  }
  if (typeof r.competition_index === "number") {
    prov.competition_index = {
      value: r.competition_index,
      source_api: srcOf("competition_index"),
      raw_field: "competition_index",
      aggregation_kind: ci.aggregation_kind ?? "category_broadcast",
    };
  }
  if (typeof r.brand_concentration === "number") {
    prov.brand_concentration = {
      value: r.brand_concentration,
      source_api: srcOf("brand_concentration"),
      raw_field: "brand_concentration",
      aggregation_kind: "category_broadcast",
    };
  }
  if (typeof r.avg_cpc_cny === "number") {
    prov.avg_cpc_cny = {
      value: r.avg_cpc_cny,
      source_api: srcOf("avg_cpc_cny"),
      raw_field: r.cpc_source === "paid" ? "avg_cost_per_clk" : "avg_cpc_cny",
      aggregation_kind: mb.aggregation_kind ?? "keyword_native",
    };
  }
  if (typeof r.weighted_cost_per_clk === "number") {
    prov.weighted_cost_per_clk = {
      value: r.weighted_cost_per_clk,
      source_api: srcOf("weighted_cost_per_clk"),
      raw_field: "weighted_cost_per_clk",
      aggregation_kind: "keyword_native",
    };
  }
  if (typeof r.competitor_count === "number") {
    prov.competitor_count = {
      value: r.competitor_count,
      source_api: srcOf("competitor_count"),
      raw_field: "competitor_count",
      aggregation_kind: "category_broadcast",
    };
  }
  if (typeof r.ad_keyword_ratio === "number") {
    prov.ad_keyword_ratio = {
      value: r.ad_keyword_ratio,
      source_api: srcOf("ad_keyword_ratio"),
      raw_field: "ad_keyword_ratio",
    };
  }
  return prov;
}

function clip01_100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)));
}