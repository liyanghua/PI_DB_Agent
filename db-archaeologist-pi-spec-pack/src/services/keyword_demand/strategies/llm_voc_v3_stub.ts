// strategies/llm_voc_v3_stub.ts: LLM VoC（评论/问大家）补证（占位）

import type {
  ClassificationRecord,
  KdsWeights,
  KeywordMetricRecord,
  KeywordScoreRecord,
} from "../types.js";

export function scoreWithLlmVocV3(
  _records: KeywordMetricRecord[],
  _classifications: ClassificationRecord[],
  _weights: KdsWeights,
): { scored: KeywordScoreRecord[]; trace_lines: object[] } {
  throw new Error("llm_voc_v3 not_implemented: 留作后续算法升级，需要打通评论/问大家文本侧补证。");
}