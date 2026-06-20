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
    category_id: args.category_id?.trim() || undefined,
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

export function summarizeKeywordDemandToolOutput(output: AnalyzeKeywordDemandToolOutput): string {
  if (output.kind === "keyword_demand_error") {
    const lines = [`关键词分析失败：${output.error}`];
    if (output.details) lines.push(output.details);
    if (output.source_audit) lines.push(...renderSourceAuditLines(output.source_audit));
    return lines.join("\n");
  }

  const lines: string[] = [];
  lines.push(`关键词分析完成：${output.category}（${output.category_id}）`);
  lines.push(`run_id=${output.run_id}`);
  if (output.source_audit) lines.push(...renderSourceAuditLines(output.source_audit));
  const top = output.top_overall
    .slice(0, 5)
    .map((x, i) => {
      const r = x as { keyword?: string; scores?: { kds?: number }; explanation?: { rank_reason?: string } };
      const kds = typeof r.scores?.kds === "number" ? r.scores.kds.toFixed(1) : "-";
      return `${i + 1}. ${r.keyword ?? "-"} · KDS ${kds}${r.explanation?.rank_reason ? ` · ${r.explanation.rank_reason}` : ""}`;
    });
  if (top.length) {
    lines.push("");
    lines.push("KDS TOP:");
    lines.push(...top);
  }
  lines.push("");
  lines.push(`summary_path=${output.summary_path}`);
  lines.push(`report_path=${output.report_path}`);
  return lines.join("\n");
}

function renderSourceAuditLines(audit: NonNullable<AnalyzeKeywordDemandToolOutput["source_audit"]>): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push(`候选接口审计：${audit.usable_apis}/${audit.total_candidates} 个接口有可用关键词数据，原始关键词 ${audit.total_keywords} 条。`);
  if (audit.usable_api_ids.length) {
    lines.push(`有数据：${audit.usable_api_ids.join("、")}`);
  }
  if (audit.no_usable_data_api_ids.length) {
    lines.push(`无可用关键词数据：${audit.no_usable_data_api_ids.join("、")}`);
  }
  lines.push("");
  lines.push("| 接口 | 请求 | 状态 | 原始行 | 可用 | 原因 |");
  lines.push("| --- | --- | --- | ---: | --- | --- |");
  for (const row of audit.candidate_apis) {
    const req = `${row.method ?? "?"} ${row.path ?? ""}`.trim();
    const usable = row.has_usable_keyword_data ? "是" : "否";
    const reason = row.reason || row.note || "";
    lines.push(`| ${row.api_id} | ${req} | ${row.status_cn} | ${row.raw_rows} | ${usable} | ${reason || "—"} |`);
  }
  return lines;
}
