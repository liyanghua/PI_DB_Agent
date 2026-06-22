// src/services/keyword_competition/strategies/weighted_v2_stub.ts
// Phase 3.5+ 占位：当前直接复用 baseline_v1 + 注入 warning。
// 详见 docs/20 §6.2。

import type {
  CompetitionMetricRecord,
  CompetitionScoreRecord,
  CpsWeights,
} from "../types.js";
import { scoreWithCpsBaseline } from "./baseline_v1.js";

export function scoreWithCpsWeightedV2(
  records: CompetitionMetricRecord[],
  weights: CpsWeights,
): { scored: CompetitionScoreRecord[]; trace_lines: object[]; warning: string } {
  const r = scoreWithCpsBaseline(records, weights);
  return {
    scored: r.scored,
    trace_lines: r.trace_lines,
    warning: "strategy_v2_not_implemented：返回 baseline_v1 同结果",
  };
}