// strategies/baseline_v1.ts: KDS baseline 公式实现（spec §6）
// 输入：KeywordMetricRecord[] + ClassificationRecord[] + weights
// 输出：{ scored: KeywordScoreRecord[], trace_lines: object[] }
// 特性：所有 subscores 公式可重算、fallback_chain 显式记录

import type {
  ClassificationRecord,
  KdsWeights,
  KeywordExplanation,
  KeywordMetricRecord,
  KeywordScoreRecord,
  SubScoreDetail,
} from "../types.js";

interface ScoringContext {
  weights: KdsWeights;
  allRecords: KeywordMetricRecord[];
}

/**
 * Baseline V1 策略入口
 */
export function scoreWithBaseline(
  records: KeywordMetricRecord[],
  classifications: ClassificationRecord[],
  weights: KdsWeights,
): { scored: KeywordScoreRecord[]; trace_lines: object[] } {
  const ctx: ScoringContext = { weights, allRecords: records };
  const classMap = new Map(classifications.map((c) => [c.keyword, c]));

  const scored: KeywordScoreRecord[] = [];
  const trace_lines: object[] = [];

  for (const record of records) {
    const cls = classMap.get(record.keyword);
    if (!cls) continue; // 理论上不会发生

    // transaction_block 直接跳过 KDS 计算
    if (cls.labels.includes("transaction_block")) {
      const result: KeywordScoreRecord = {
        ...record,
        ...cls,
        scores: { scale: 0, growth: 0, traffic: 0, conversion: 0, base_kds: 0, kds: 0 },
        explanation: {
          field_provenance: {},
          subscores: [],
          kds_level: "reject",
          rank_reason: "transaction_block 交易阻塞词不参与 KDS 计算",
        },
      };
      scored.push(result);
      trace_lines.push({ keyword: record.keyword, reason: "transaction_block_skip" });
      continue;
    }

    const result = scoreOne(record, cls, ctx);
    scored.push(result);
    trace_lines.push({ keyword: record.keyword, explanation: result.explanation });
  }

  return { scored, trace_lines };
}

function scoreOne(
  record: KeywordMetricRecord,
  cls: ClassificationRecord,
  ctx: ScoringContext,
): KeywordScoreRecord {
  const subscores: SubScoreDetail[] = [];

  // 计算 4 个主成分
  const scale = computeScale(record, ctx, subscores);
  const growth = computeGrowth(record, ctx, subscores);
  const traffic = computeTraffic(record, ctx, subscores);
  const conversion = computeConversion(record, ctx, subscores);
  const blueOcean = computeBlueOcean(record, ctx, subscores);

  // base_kds
  const baseWeights = ctx.weights.base_kds;
  const base_kds =
    baseWeights.scale * scale +
    baseWeights.growth * growth +
    baseWeights.traffic * traffic +
    baseWeights.conversion * conversion;

  // intent_multiplier
  const multiplier = cls.intent_multiplier ?? 1.0;
  const kds = Math.min(100, Math.max(0, base_kds * multiplier));

  // kds_level
  const level = ctx.weights.kds_levels.find((l) => kds >= l.min && kds < l.max) ?? ctx.weights.kds_levels[ctx.weights.kds_levels.length - 1];

  // rank_reason
  const topComponents = [
    { name: "规模", val: scale },
    { name: "增长", val: growth },
    { name: "流量", val: traffic },
    { name: "转化", val: conversion },
  ]
    .filter((c) => c.val >= 60)
    .sort((a, b) => b.val - a.val)
    .slice(0, 2)
    .map((c) => `${c.name} ${c.val.toFixed(0)}`)
    .join(" + ");

  const labelHint = cls.labels.filter((l) => !["category", "unknown"].includes(l)).join("+");
  const multiplierHint = multiplier !== 1.0 ? ` × ${multiplier.toFixed(2)}` : "";
  const rank_reason = `${topComponents || "基础维度偏低"}${labelHint ? ` + ${labelHint}` : ""}${multiplierHint}`;

  const explanation: KeywordExplanation = {
    field_provenance: buildProvenance(record),
    subscores,
    intent_multiplier: multiplier !== 1.0 ? { labels_seen: cls.labels, rule_id: cls.intent_rule_id ?? "default", value: multiplier } : undefined,
    kds_level: level.code,
    rank_reason,
  };

  return {
    ...record,
    ...cls,
    scores: { scale, growth, traffic, conversion, base_kds, kds, blue_ocean: blueOcean },
    explanation,
  };
}

// ============ 主成分计算（含百分位排名 pctRank） ============

function computeScale(record: KeywordMetricRecord, ctx: ScoringContext, subscores: SubScoreDetail[]): number {
  const w = ctx.weights.scale_score;
  const sp = getField(record, w.search_popularity_aliases || ["search_popularity"]);
  const pb = record.pay_buyers;

  if (sp != null && pb != null) {
    const spRank = pctRank(sp, ctx.allRecords, w.search_popularity_aliases || ["search_popularity"]);
    const pbRank = pctRank(pb, ctx.allRecords, ["pay_buyers"]);
    const result = w.primary.search_popularity * spRank + w.primary.pay_buyers * pbRank;
    subscores.push({
      name: "scale",
      formula: `${w.primary.search_popularity} × pctRank(search_popularity) + ${w.primary.pay_buyers} × pctRank(pay_buyers)`,
      inputs: [
        { var: "pctRank(search_popularity)", value: spRank },
        { var: "pctRank(pay_buyers)", value: pbRank },
      ],
      result: result * 100,
    });
    return result * 100;
  }

  // fallback_no_pay_buyers
  if (sp != null && record.click_rate != null && w.fallback_no_pay_buyers) {
    const spRank = pctRank(sp, ctx.allRecords, w.search_popularity_aliases || ["search_popularity"]);
    const crRank = pctRank(record.click_rate, ctx.allRecords, ["click_rate"]);
    const result = w.fallback_no_pay_buyers.search_popularity * spRank + w.fallback_no_pay_buyers.click_rate * crRank;
    subscores.push({
      name: "scale",
      formula: `fallback_no_pay_buyers: ${w.fallback_no_pay_buyers.search_popularity} × pctRank(sp) + ${w.fallback_no_pay_buyers.click_rate} × pctRank(cr)`,
      result: result * 100,
      fallback_chain: ["no_pay_buyers"],
    });
    return result * 100;
  }

  // 完全缺失，返回 50
  subscores.push({ name: "scale", result: 50, fallback_chain: ["no_search_popularity_neutral_50"] });
  return 50;
}

function computeGrowth(record: KeywordMetricRecord, ctx: ScoringContext, subscores: SubScoreDetail[]): number {
  const w = ctx.weights.growth_score;
  const mom = record.search_popularity_mom;
  const yoy = record.search_popularity_yoy;
  const slope = record.trend_slope;
  const pbGrowth = record.pay_buyers_mom;

  if (mom != null && yoy != null) {
    const momNorm = normalize(mom, -1, 3);
    const yoyNorm = normalize(yoy, -1, 3);
    const slopeNorm = slope != null ? normalize(slope, -0.5, 0.5) : 0.5;
    const pbNorm = pbGrowth != null ? normalize(pbGrowth, -1, 3) : 0.5;
    const result =
      (w.primary.mom ?? 0.4) * momNorm +
      (w.primary.yoy ?? 0.3) * yoyNorm +
      (w.primary.trend_slope ?? 0.2) * slopeNorm +
      (w.primary.pay_buyer_growth ?? 0.1) * pbNorm;
    subscores.push({
      name: "growth",
      formula: `${w.primary.mom} × norm(mom) + ${w.primary.yoy} × norm(yoy) + ...`,
      inputs: [
        { var: "norm(mom)", value: momNorm },
        { var: "norm(yoy)", value: yoyNorm },
      ],
      result: result * 100,
    });
    return result * 100;
  }

  // fallback_only_search_growth_rate
  if (record.search_growth_rate != null && w.fallback_only_search_growth_rate) {
    const result = pctRank(record.search_growth_rate, ctx.allRecords, ["search_growth_rate"]);
    subscores.push({
      name: "growth",
      formula: "fallback_only_search_growth_rate",
      inputs: [{ var: "pctRank(search_growth_rate)", value: result }],
      result: result * 100,
      fallback_chain: ["no_mom_no_yoy_use_search_growth_rate"],
    });
    return result * 100;
  }

  // fallback_only_mom
  if (mom != null && w.fallback_only_mom) {
    const norm = pctRank(mom, ctx.allRecords, ["search_popularity_mom"]);
    subscores.push({
      name: "growth",
      formula: "fallback_only_mom",
      inputs: [{ var: "pctRank(search_popularity_mom)", value: norm }],
      result: norm * 100,
      fallback_chain: ["no_yoy_use_mom_only"],
    });
    return norm * 100;
  }

  // fallback_neutral
  subscores.push({ name: "growth", result: w.fallback_neutral, fallback_chain: ["no_growth_data_neutral_50"] });
  return w.fallback_neutral;
}

function computeTraffic(record: KeywordMetricRecord, ctx: ScoringContext, subscores: SubScoreDetail[]): number {
  const w = ctx.weights.traffic_score;
  const cr = record.click_rate;
  const sv = record.search_visitors;
  const tmall = record.tmall_click_share;

  if (cr != null && (sv != null || tmall != null)) {
    const crRank = pctRank(cr, ctx.allRecords, ["click_rate"]);
    const svRank = sv != null ? pctRank(sv, ctx.allRecords, ["search_visitors"]) : 0.5;
    const tmallRank = tmall != null ? pctRank(tmall, ctx.allRecords, ["tmall_click_share"]) : 0.5;
    const result =
      (w.primary.click_rate ?? 0.6) * crRank +
      (w.primary.search_visitors ?? 0.25) * svRank +
      (w.primary.tmall_click_share ?? 0.15) * tmallRank;
    subscores.push({
      name: "traffic",
      formula: `${w.primary.click_rate} × pctRank(cr) + ...`,
      inputs: [{ var: "pctRank(click_rate)", value: crRank }],
      result: result * 100,
    });
    return result * 100;
  }

  // fallback_keyword_only
  if (cr != null && record.search_popularity != null && w.fallback_keyword_only) {
    const crRank = pctRank(cr, ctx.allRecords, ["click_rate"]);
    const spRank = pctRank(record.search_popularity, ctx.allRecords, ["search_popularity"]);
    const result = w.fallback_keyword_only.click_rate * crRank + w.fallback_keyword_only.search_popularity * spRank;
    subscores.push({
      name: "traffic",
      formula: "fallback_keyword_only",
      result: result * 100,
      fallback_chain: ["no_search_visitors_no_tmall_share"],
    });
    return result * 100;
  }

  // fallback_no_click_rate
  subscores.push({ name: "traffic", result: w.fallback_no_click_rate, fallback_chain: ["no_click_rate_neutral_50"] });
  return w.fallback_no_click_rate;
}

function computeConversion(record: KeywordMetricRecord, ctx: ScoringContext, subscores: SubScoreDetail[]): number {
  const w = ctx.weights.conversion_score;
  const pr = record.pay_rate;
  const pb = record.pay_buyers;
  const cvr = record.conversion_rate;

  if (pr != null && pb != null && cvr != null) {
    const prRank = pctRank(pr, ctx.allRecords, ["pay_rate"]);
    const pbRank = pctRank(pb, ctx.allRecords, ["pay_buyers"]);
    const cvrRank = pctRank(cvr, ctx.allRecords, ["conversion_rate"]);
    const result =
      (w.primary.pay_rate ?? 0.5) * prRank +
      (w.primary.pay_buyers ?? 0.3) * pbRank +
      (w.primary.conversion_rate ?? 0.2) * cvrRank;
    subscores.push({
      name: "conversion",
      formula: `${w.primary.pay_rate} × pctRank(pr) + ${w.primary.pay_buyers} × pctRank(pb) + ...`,
      inputs: [
        { var: "pctRank(pay_rate)", value: prRank },
        { var: "pctRank(pay_buyers)", value: pbRank },
      ],
      result: result * 100,
    });
    return result * 100;
  }

  // fallback_no_conversion_rate
  if (pr != null && pb != null && w.fallback_no_conversion_rate) {
    const prRank = pctRank(pr, ctx.allRecords, ["pay_rate"]);
    const pbRank = pctRank(pb, ctx.allRecords, ["pay_buyers"]);
    const result = w.fallback_no_conversion_rate.pay_rate * prRank + w.fallback_no_conversion_rate.pay_buyers * pbRank;
    subscores.push({
      name: "conversion",
      formula: "fallback_no_conversion_rate",
      result: result * 100,
      fallback_chain: ["no_conversion_rate"],
    });
    return result * 100;
  }

  // fallback_only_pay_rate
  if (pr != null && w.fallback_only_pay_rate) {
    const prRank = pctRank(pr, ctx.allRecords, ["pay_rate"]);
    subscores.push({
      name: "conversion",
      formula: "fallback_only_pay_rate",
      result: prRank * 100,
      fallback_chain: ["no_pay_buyers_only_pay_rate"],
    });
    return prRank * 100;
  }

  // fallback_neutral
  subscores.push({ name: "conversion", result: w.fallback_neutral, fallback_chain: ["no_conversion_data_neutral_50"] });
  return w.fallback_neutral;
}

function computeBlueOcean(record: KeywordMetricRecord, ctx: ScoringContext, subscores: SubScoreDetail[]): number | undefined {
  const w = ctx.weights.blue_ocean_score?.weights;
  if (!w) return undefined;

  const ratio = record.demand_supply_ratio;
  const buyers = record.pay_buyers;
  const mom = record.search_popularity_mom;
  const payRate = record.pay_rate;
  if (ratio == null && buyers == null && mom == null && payRate == null) {
    return undefined;
  }

  const ratioRank = ratio != null ? pctRank(ratio, ctx.allRecords, ["demand_supply_ratio"]) : 0.5;
  const buyersRank = buyers != null ? pctRank(buyers, ctx.allRecords, ["pay_buyers"]) : 0.5;
  const momRank = mom != null ? pctRank(mom, ctx.allRecords, ["search_popularity_mom"]) : 0.5;
  const payRateRank = payRate != null ? pctRank(payRate, ctx.allRecords, ["pay_rate"]) : 0.5;
  const result =
    (w.demand_supply_ratio ?? 0) * ratioRank +
    (w.pay_buyers ?? 0) * buyersRank +
    (w.search_popularity_mom ?? 0) * momRank +
    (w.pay_rate ?? 0) * payRateRank;
  subscores.push({
    name: "blue_ocean",
    formula: `${w.demand_supply_ratio} × pctRank(demand_supply_ratio) + ${w.pay_buyers} × pctRank(pay_buyers) + ${w.search_popularity_mom} × pctRank(search_popularity_mom) + ${w.pay_rate} × pctRank(pay_rate)`,
    inputs: [
      { var: "pctRank(demand_supply_ratio)", value: ratioRank },
      { var: "pctRank(pay_buyers)", value: buyersRank },
      { var: "pctRank(search_popularity_mom)", value: momRank },
      { var: "pctRank(pay_rate)", value: payRateRank },
    ],
    result: result * 100,
  });
  return result * 100;
}

// ============ 辅助函数 ============

function getField(record: KeywordMetricRecord, aliases: string[]): number | undefined {
  for (const a of aliases) {
    const val = (record as Record<string, unknown>)[a];
    if (typeof val === "number") return val;
  }
  return undefined;
}

function pctRank(value: number, allRecords: KeywordMetricRecord[], fields: string[]): number {
  const values: number[] = [];
  for (const r of allRecords) {
    for (const f of fields) {
      const v = (r as Record<string, unknown>)[f];
      if (typeof v === "number") {
        values.push(v);
        break;
      }
    }
  }
  if (values.length === 0) return 0.5;
  const sorted = values.sort((a, b) => a - b);
  const rank = sorted.filter((v) => v < value).length;
  return rank / sorted.length;
}

function normalize(value: number, min: number, max: number): number {
  if (value <= min) return 0;
  if (value >= max) return 1;
  return (value - min) / (max - min);
}

function buildProvenance(record: KeywordMetricRecord): Record<string, { value: number | string; source_api: string; raw_field: string }> {
  // 简化：只记录核心字段，source 取 record.source[0]
  const prov: Record<string, { value: number | string; source_api: string; raw_field: string }> = {};
  const source = record.source?.[0] ?? "unknown";
  if (record.search_popularity != null) prov.search_popularity = { value: record.search_popularity, source_api: source, raw_field: "search_popularity" };
  if (record.pay_buyers != null) prov.pay_buyers = { value: record.pay_buyers, source_api: source, raw_field: "pay_buyers" };
  if (record.click_rate != null) prov.click_rate = { value: record.click_rate, source_api: source, raw_field: "click_rate" };
  if (record.pay_rate != null) prov.pay_rate = { value: record.pay_rate, source_api: source, raw_field: "pay_rate" };
  return prov;
}
