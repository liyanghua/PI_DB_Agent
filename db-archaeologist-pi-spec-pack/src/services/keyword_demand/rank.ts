// rank.ts: 排序输出（§S6）
// 输入：scored: KeywordScoreRecord[]
// 输出：top_overall / top_by_type / top_by_metric / top_by_blue_ocean

import type { KeywordScoreRecord, RankResult } from "./types.js";

export interface RankOptions {
  top_n?: number;
  per_demand_type_top?: number;
  per_metric_top?: number;
  blue_ocean_top?: number;
  excluded_labels?: string[];
}

const DEFAULTS: Required<RankOptions> = {
  top_n: 20,
  per_demand_type_top: 10,
  per_metric_top: 10,
  blue_ocean_top: 10,
  excluded_labels: ["transaction_block"],
};

export function rankScored(scored: KeywordScoreRecord[], opts?: RankOptions): RankResult {
  const o = { ...DEFAULTS, ...opts };

  // 业务硬过滤（对应 spec §9.2 Reject + 进入 Opportunity 的前置条件）
  const intentLabels = ["function", "spec", "style", "material", "season", "target_user", "population", "blue_ocean"];
  const eligible = scored.filter((r) => {
    // 1. 含 transaction_block / 自定义排除标签
    if (r.labels.some((l) => o.excluded_labels.includes(l))) return false;
    // 2. 必须含至少一个"具体诉求"标签（功能/规格/风格/季节/人群/材质）
    //    这条同时拦掉了"纯品类词"和"品类+场景"型品类词
    const hasIntent = r.labels.some((l) => intentLabels.includes(l));
    if (!hasIntent) return false;
    // 3. 痛点词若无具体诉求标签，归到"反馈词"而非"需求词"
    //    （此条已在 hasIntent 中天然涵盖）
    return true;
  });
  const top_overall = [...eligible].sort((a, b) => b.scores.kds - a.scores.kds).slice(0, o.top_n);

  // 按 demand type 分桶
  const top_by_type: Record<string, KeywordScoreRecord[]> = {};
  const demandTypes = ["function", "scene", "spec", "style", "blue_ocean", "target_user", "material", "population", "pain", "season", "channel", "brand"];
  for (const t of demandTypes) {
    const subset = eligible.filter((r) => r.labels.includes(t));
    if (subset.length === 0) continue;
    top_by_type[t] = [...subset].sort((a, b) => b.scores.kds - a.scores.kds).slice(0, o.per_demand_type_top);
  }

  // 按 metric 分桶（突出某单维度强项）
  const top_by_metric: Record<string, KeywordScoreRecord[]> = {
    scale: [...eligible].sort((a, b) => b.scores.scale - a.scores.scale).slice(0, o.per_metric_top),
    growth: [...eligible].sort((a, b) => b.scores.growth - a.scores.growth).slice(0, o.per_metric_top),
    traffic: [...eligible].sort((a, b) => b.scores.traffic - a.scores.traffic).slice(0, o.per_metric_top),
    conversion: [...eligible].sort((a, b) => b.scores.conversion - a.scores.conversion).slice(0, o.per_metric_top),
  };

  // 蓝海榜：demand_supply_ratio 高 + search_popularity_mom 高
  const blueOceanCandidates = eligible.filter(
    (r) => (r.demand_supply_ratio ?? 0) >= 1.5 || (r.search_popularity_mom ?? 0) >= 0.2,
  );
  const top_by_blue_ocean = blueOceanCandidates
    .sort((a, b) => {
      const aScore = (a.demand_supply_ratio ?? 0) * 50 + (a.search_popularity_mom ?? 0) * 50;
      const bScore = (b.demand_supply_ratio ?? 0) * 50 + (b.search_popularity_mom ?? 0) * 50;
      return bScore - aScore;
    })
    .slice(0, o.blue_ocean_top);

  return { top_overall, top_by_type, top_by_metric, top_by_blue_ocean };
}