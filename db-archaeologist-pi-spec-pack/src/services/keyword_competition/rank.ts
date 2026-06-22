// src/services/keyword_competition/rank.ts
// CPS 排序输出：top_overall（CPS 降序）+ top_by_bucket（弱/中/强）

import type { CompetitionScoreRecord, CpsRankResult, CpsWeights } from "./types.js";

export interface CpsRankOptions {
  top_n?: number;
  per_bucket_top?: number;
}

const DEFAULT_OPTS: Required<CpsRankOptions> = {
  top_n: 20,
  per_bucket_top: 10,
};

export function rankCpsScored(
  scored: CompetitionScoreRecord[],
  weights: CpsWeights,
  opts?: CpsRankOptions,
): CpsRankResult {
  const o = { ...DEFAULT_OPTS, ...opts };

  const top_overall = [...scored].sort((a, b) => b.cps - a.cps).slice(0, o.top_n);

  const top_by_bucket: Record<string, CompetitionScoreRecord[]> = {};
  for (const lv of weights.cps_levels) {
    const subset = scored.filter((r) => r.cps >= lv.min && r.cps < lv.max);
    if (subset.length === 0) continue;
    top_by_bucket[lv.code] = [...subset].sort((a, b) => b.cps - a.cps).slice(0, o.per_bucket_top);
  }

  return { top_overall, top_by_bucket };
}