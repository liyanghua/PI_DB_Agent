// list_keyword_runs: 列出已落盘的 run，便于会话回看 / 选两 run 做 compare。

import { getRunMeta, getRunSummary, listRuns } from "../services/keyword_demand/trace.js";
import type { RunMeta } from "../services/keyword_demand/types.js";

export interface ListKeywordRunsToolInput {
  limit?: number;
  category?: string;
  strategy?: string;
  run_id?: string; // 若指定则返回该 run 的 meta + summary 摘要
}

export interface ListKeywordRunsToolOutput {
  kind: "keyword_runs_list" | "keyword_run_detail";
  total?: number;
  runs?: Array<Pick<RunMeta, "run_id" | "strategy" | "category" | "category_id" | "started_at" | "elapsed_ms">>;
  detail?: { meta: RunMeta; summary_md?: string } | null;
}

export function listKeywordRunsTool(args: ListKeywordRunsToolInput = {}): ListKeywordRunsToolOutput {
  if (args.run_id) {
    const meta = getRunMeta(args.run_id);
    if (!meta) {
      return { kind: "keyword_run_detail", detail: null };
    }
    const summary = getRunSummary(args.run_id) ?? undefined;
    return { kind: "keyword_run_detail", detail: { meta, summary_md: summary } };
  }

  const runs = listRuns({ limit: args.limit ?? 20, category: args.category, strategy: args.strategy });
  return {
    kind: "keyword_runs_list",
    total: runs.length,
    runs: runs.map((r) => ({
      run_id: r.run_id,
      strategy: r.strategy,
      category: r.category,
      category_id: r.category_id,
      started_at: r.started_at,
      elapsed_ms: r.elapsed_ms,
    })),
  };
}