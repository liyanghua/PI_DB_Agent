// compute_tms.ts: TMS 子分计算 + 合成 + trend_label 判定
// 依据：docs/14 KOIF §5 + docs/17 §1.2

import type { KeywordMetricRecord } from "../keyword_demand/types.js";
import type { TmsWeights, TmsSubScore, TrendRecord } from "./types.js";

/**
 * 桶切分打分：把连续值映射到离散桶
 * bucket key 示例：">=0.5" ">=0.2" ">=0" "<0" "<-0.1"
 */
function bucketScore(
  value: number | undefined | null,
  buckets: Record<string, number>,
  fallback: number,
): { score: number; bucket?: string } {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return { score: fallback };
  }

  // 解析 bucket key 为条件
  const entries = Object.entries(buckets)
    .map(([k, v]) => {
      const m = k.match(/^(>=|<=|>|<)\s*(-?[\d.]+)$/);
      if (!m) return null;
      return { op: m[1], threshold: Number(m[2]), score: v, label: k };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  // 按 threshold 降序排序，从高到低匹配（">=" / ">" 优先匹配大值）
  const sorted = [...entries].sort((a, b) => b.threshold - a.threshold);
  for (const e of sorted) {
    const ok =
      (e.op === ">=" && value >= e.threshold) ||
      (e.op === ">" && value > e.threshold) ||
      (e.op === "<=" && value <= e.threshold) ||
      (e.op === "<" && value < e.threshold);
    if (ok) return { score: e.score, bucket: e.label };
  }

  return { score: fallback };
}

/**
 * 计算单关键词的 TrendRecord
 */
export function computeTrendRecord(
  rec: KeywordMetricRecord,
  weights: TmsWeights,
): TrendRecord {
  const subs: TmsSubScore[] = [];

  // 1) MoM score（优先用 search_popularity_mom，其次 search_value_mom 时序聚合值）
  const momValue =
    typeof rec.search_popularity_mom === "number" && !Number.isNaN(rec.search_popularity_mom)
      ? rec.search_popularity_mom
      : (rec as Record<string, unknown>).search_value_mom as number | undefined;
  const momVar = typeof rec.search_popularity_mom === "number" ? "search_popularity_mom" : "search_value_mom";
  const mom = bucketScore(momValue, weights.mom_score.primary, weights.mom_score.fallback_neutral);
  subs.push({
    name: "mom",
    inputs: [{ var: momVar, value: momValue ?? "—", bucket: mom.bucket }],
    result: mom.score,
  });

  // 2) YoY score（同 MoM，二级回退到 search_value_yoy）
  const yoyValue =
    typeof rec.search_popularity_yoy === "number" && !Number.isNaN(rec.search_popularity_yoy)
      ? rec.search_popularity_yoy
      : (rec as Record<string, unknown>).search_value_yoy as number | undefined;
  const yoyVar = typeof rec.search_popularity_yoy === "number" ? "search_popularity_yoy" : "search_value_yoy";
  const yoy = bucketScore(yoyValue, weights.yoy_score.primary, weights.yoy_score.fallback_neutral);
  subs.push({
    name: "yoy",
    inputs: [{ var: yoyVar, value: yoyValue ?? "—", bucket: yoy.bucket }],
    result: yoy.score,
  });

  // 3) Slope score（二级 fallback: trend_slope → search_growth_rate → neutral）
  let slope: { score: number; bucket?: string };
  let slopeFallback: string[] | undefined;
  if (typeof rec.trend_slope === "number" && !Number.isNaN(rec.trend_slope)) {
    slope = bucketScore(rec.trend_slope, weights.slope_score.primary, weights.slope_score.fallback_neutral);
  } else if (typeof rec.search_growth_rate === "number" && !Number.isNaN(rec.search_growth_rate)) {
    // search_growth_rate 接口返回指数形式（100=持平，306=+206%）；归一化为比率（306/100-1=2.06）
    const growthRatio = rec.search_growth_rate / 100 - 1;
    slope = bucketScore(
      growthRatio,
      weights.slope_score.fallback_only_growth_rate,
      weights.slope_score.fallback_neutral,
    );
    slopeFallback = ["trend_slope_missing", "use_search_growth_rate"];
  } else {
    slope = { score: weights.slope_score.fallback_neutral };
    slopeFallback = ["trend_slope_missing", "search_growth_rate_missing", "neutral_50"];
  }
  subs.push({
    name: "slope",
    inputs: [{ var: "trend_slope", value: rec.trend_slope ?? "—", bucket: slope.bucket }],
    result: slope.score,
    fallback_chain: slopeFallback,
  });

  // 4) Consistency score（按 search_value_trend 字段）
  const trendCode =
    rec.search_value_trend === "rising"
      ? "rising"
      : rec.search_value_trend === "falling"
        ? "falling"
        : rec.search_value_trend === "stable"
          ? "stable"
          : null;
  const consistency = trendCode ? weights.consistency_score[trendCode] : weights.consistency_score.fallback_neutral;
  subs.push({
    name: "consistency",
    inputs: [{ var: "search_value_trend", value: rec.search_value_trend ?? "—" }],
    result: consistency,
  });

  // 合成 TMS
  const w = weights.base_tms;
  const tms = Math.round(w.mom * mom.score + w.yoy * yoy.score + w.slope * slope.score + w.consistency * consistency);

  // 判定 trend_label
  const label = pickTrendLabel(tms, weights);

  // 生成 rank_reason
  const reason = buildReason(mom.score, yoy.score, slope.score, consistency, label);

  return {
    ...rec,
    scores: { mom: mom.score, yoy: yoy.score, slope: slope.score, consistency, tms },
    trend_label: label,
    explanation: { subscores: subs, rank_reason: reason },
  };
}

function pickTrendLabel(tms: number, weights: TmsWeights): "rising" | "stable" | "falling" {
  for (const lvl of weights.trend_labels) {
    if (tms >= lvl.min && tms < lvl.max) return lvl.code;
  }
  return "stable";
}

function buildReason(mom: number, yoy: number, slope: number, consistency: number, label: string): string {
  const parts: string[] = [];
  if (mom >= 80) parts.push("月环比显著上升");
  else if (mom <= 30) parts.push("月环比下滑");
  if (yoy >= 80) parts.push("年同比走强");
  else if (yoy <= 30) parts.push("年同比回落");
  if (slope >= 80) parts.push("趋势斜率陡");
  if (consistency >= 80) parts.push("连续上升");
  return parts.length ? parts.join("，") : `综合趋势 ${label}`;
}