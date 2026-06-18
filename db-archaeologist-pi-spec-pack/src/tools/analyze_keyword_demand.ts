// analyze_keyword_demand: 关键词需求分析顶层工具（pi 入口）
// 包装 src/services/keyword_demand/index.ts 的 analyzeKeywordDemand。
// 输出形态对齐 pi tool：成功返回 run_id/run_dir/top_overall/top_by_type/summary_path/report_path；
// 失败返回 { kind, error, missing_params? } 让 agent 走 missing_params 分支。

import { analyzeKeywordDemand } from "../services/keyword_demand/index.js";
import type {
  AnalyzeKeywordDemandInput,
  AnalyzeKeywordDemandOutput,
  AnalyzeKeywordDemandError,
} from "../services/keyword_demand/index.js";

export type AnalyzeKeywordDemandToolInput = AnalyzeKeywordDemandInput & {
  run_id_hint?: string;
};

export type AnalyzeKeywordDemandToolOutput =
  | (AnalyzeKeywordDemandOutput & { kind: "keyword_demand_run" })
  | (AnalyzeKeywordDemandError & { kind: "keyword_demand_error" });

export async function analyzeKeywordDemandTool(
  args: AnalyzeKeywordDemandToolInput,
): Promise<AnalyzeKeywordDemandToolOutput> {
  if (!args || typeof args.category !== "string" || args.category.trim() === "") {
    return {
      kind: "keyword_demand_error",
      error: "missing_params",
      missing_params: { category: "需要提供品类名（例如：入户地垫）" },
    };
  }

  const result = await analyzeKeywordDemand({
    category: args.category.trim(),
    strategy: args.strategy,
    live: args.live,
    top_n: args.top_n,
    per_demand_type_top: args.per_demand_type_top,
    date_range: args.date_range,
  });

  if ("error" in result) {
    return { kind: "keyword_demand_error", ...result };
  }
  return { kind: "keyword_demand_run", ...result };
}