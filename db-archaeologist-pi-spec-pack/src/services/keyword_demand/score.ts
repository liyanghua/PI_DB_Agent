// score.ts: 策略调度入口（§S5）
// 负责把 records + classifications 喂给具体 strategy
// 目前 baseline_v1 是唯一可用实现；semantic_v2 / llm_voc_v3 抛 not_implemented

import type {
  ClassificationRecord,
  KdsWeights,
  KeywordMetricRecord,
  KeywordScoreRecord,
} from "./types.js";
import { scoreWithBaseline } from "./strategies/baseline_v1.js";
import { scoreWithSemanticV2 } from "./strategies/semantic_v2_stub.js";
import { scoreWithLlmVocV3 } from "./strategies/llm_voc_v3_stub.js";

export interface ScoreOutput {
  scored: KeywordScoreRecord[];
  trace_lines: object[];
}

/**
 * 按 strategy 名分发到具体实现。
 */
export function scoreRecords(
  records: KeywordMetricRecord[],
  classifications: ClassificationRecord[],
  weights: KdsWeights,
  strategy: string,
): ScoreOutput {
  switch (strategy) {
    case "baseline_v1":
      return scoreWithBaseline(records, classifications, weights);
    case "semantic_v2":
      return scoreWithSemanticV2(records, classifications, weights);
    case "llm_voc_v3":
      return scoreWithLlmVocV3(records, classifications, weights);
    default:
      throw new Error(`unknown strategy: ${strategy}`);
  }
}