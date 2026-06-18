// compare_keyword_runs: 两个 run 的对比（同 category_id 必须）
// 包装 src/services/keyword_demand/compare.ts 的 compareRuns。

import { compareRuns } from "../services/keyword_demand/compare.js";
import type { CompareInput, CompareOutput, CompareError } from "../services/keyword_demand/compare.js";

export type CompareKeywordRunsToolInput = CompareInput;

export type CompareKeywordRunsToolOutput =
  | (CompareOutput & { kind: "keyword_compare_result" })
  | (CompareError & { kind: "keyword_compare_error" });

export async function compareKeywordRunsTool(
  args: CompareKeywordRunsToolInput,
): Promise<CompareKeywordRunsToolOutput> {
  if (!args || typeof args.run_id_a !== "string" || typeof args.run_id_b !== "string") {
    return {
      kind: "keyword_compare_error",
      error: "missing_params",
      details: "需要提供 run_id_a 与 run_id_b（可先 list_keyword_runs 获取）",
    };
  }
  const r = await compareRuns(args);
  if ("error" in r) return { kind: "keyword_compare_error", ...r };
  return { kind: "keyword_compare_result", ...r };
}