// strategies/semantic_v2_stub.ts: 同义词归并 + 聚类（占位）
// 接口齐全，但实现抛 not_implemented；为后续 §10 算法升级预留。

import type {
  ClassificationRecord,
  KdsWeights,
  KeywordMetricRecord,
  KeywordScoreRecord,
} from "../types.js";

export function scoreWithSemanticV2(
  _records: KeywordMetricRecord[],
  _classifications: ClassificationRecord[],
  _weights: KdsWeights,
): { scored: KeywordScoreRecord[]; trace_lines: object[] } {
  throw new Error("semantic_v2 not_implemented: 留作后续算法升级。可在 keyword_strategies.yaml 启用 enabled=true 并实现本函数。");
}