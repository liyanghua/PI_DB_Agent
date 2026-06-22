// src/services/keyword_competition/score.ts
// CPS 策略调度入口：按 strategy 名分发到具体实现。

import type { CompetitionMetricRecord, CompetitionScoreRecord, CpsWeights } from "./types.js";
import { scoreWithCpsBaseline } from "./strategies/baseline_v1.js";
import { scoreWithCpsWeightedV2 } from "./strategies/weighted_v2_stub.js";

export interface CpsScoreOutput {
  scored: CompetitionScoreRecord[];
  trace_lines: object[];
  warning?: string;
}

export function scoreCpsRecords(
  records: CompetitionMetricRecord[],
  weights: CpsWeights,
  strategy: string,
): CpsScoreOutput {
  switch (strategy) {
    case "cps_baseline_v1":
      return scoreWithCpsBaseline(records, weights);
    case "cps_weighted_v2_stub":
      return scoreWithCpsWeightedV2(records, weights);
    default:
      throw new Error(`unknown CPS strategy: ${strategy}`);
  }
}