// analyze_keyword_competition: 关键词竞争分析顶层工具（pi 入口）
// 包装 src/services/keyword_competition/index.ts 的 analyzeKeywordCompetition。
// 输出对齐 pi tool：成功返回 { kind: "keyword_competition_run", ... }；
// 失败返回 { kind: "keyword_competition_error", ... } 让 agent 走 missing_params 分支。

import { analyzeKeywordCompetition } from "../services/keyword_competition/index.js";
import type {
  AnalyzeKeywordCompetitionInput,
  AnalyzeKeywordCompetitionOutput,
  AnalyzeKeywordCompetitionError,
} from "../services/keyword_competition/index.js";

export type AnalyzeKeywordCompetitionToolInput = AnalyzeKeywordCompetitionInput & {
  run_id_hint?: string;
};

export type AnalyzeKeywordCompetitionToolOutput =
  | (AnalyzeKeywordCompetitionOutput & { kind: "keyword_competition_run" })
  | (AnalyzeKeywordCompetitionError & { kind: "keyword_competition_error" });

export async function analyzeKeywordCompetitionTool(
  args: AnalyzeKeywordCompetitionToolInput,
): Promise<AnalyzeKeywordCompetitionToolOutput> {
  if (!args || typeof args.category !== "string" || args.category.trim() === "") {
    return {
      kind: "keyword_competition_error",
      error: "missing_params",
      missing_params: { category: "需要提供品类名（例如：入户地垫）" },
    };
  }

  const result = await analyzeKeywordCompetition({
    category: args.category.trim(),
    category_id: args.category_id?.trim() || undefined,
    strategy: args.strategy,
    live: args.live,
    top_n: args.top_n,
    per_bucket_top: args.per_bucket_top,
    date_range: args.date_range,
    demand_keywords: args.demand_keywords,
    seed_keywords: args.seed_keywords,
  });

  if ("error" in result) {
    return { kind: "keyword_competition_error", ...result };
  }
  return { kind: "keyword_competition_run", ...result };
}

export function summarizeKeywordCompetitionToolOutput(
  output: AnalyzeKeywordCompetitionToolOutput,
): string {
  if (output.kind === "keyword_competition_error") {
    const lines = [`关键词竞争分析失败：${output.error}`];
    if (output.details) lines.push(output.details);
    if (output.missing_params) {
      lines.push("");
      lines.push("缺失参数：");
      for (const [k, v] of Object.entries(output.missing_params)) {
        lines.push(`- ${k}: ${v}`);
      }
    }
    if (output.pull_report) lines.push(...renderPullReportLines(output.pull_report));
    return lines.join("\n");
  }

  const lines: string[] = [];
  lines.push(`关键词竞争分析完成：${output.category}（${output.category_id}）`);
  lines.push(`run_id=${output.run_id}`);
  if (output.keyword_universe_source) {
    lines.push(`关键词清单来源：${output.keyword_universe_source}`);
  }
  if (output.pull_report) lines.push(...renderPullReportLines(output.pull_report));

  const top = output.top_overall.slice(0, 5).map((x, i) => {
    const r = x as {
      keyword?: string;
      scores?: { cps?: number };
      bucket?: string;
      cpc_source?: string;
      explanation?: { rank_reason?: string };
    };
    const cps = typeof r.scores?.cps === "number" ? r.scores.cps.toFixed(1) : "-";
    const bucket = r.bucket ? ` · ${r.bucket}` : "";
    const cpcSrc = r.cpc_source ? ` · cpc=${r.cpc_source}` : "";
    return `${i + 1}. ${r.keyword ?? "-"} · CPS ${cps}${bucket}${cpcSrc}${
      r.explanation?.rank_reason ? ` · ${r.explanation.rank_reason}` : ""
    }`;
  });
  if (top.length) {
    lines.push("");
    lines.push("CPS TOP:");
    lines.push(...top);
  }
  lines.push("");
  lines.push(`summary_path=${output.summary_path}`);
  lines.push(`report_path=${output.report_path}`);
  return lines.join("\n");
}

function renderPullReportLines(pull: NonNullable<AnalyzeKeywordCompetitionToolOutput["pull_report"]>): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    `数据拉取审计：有效接口 ${pull.effective_apis} 个，原始关键词记录 ${pull.total_keywords} 条，时间窗口 ${pull.date_range.start_date} → ${pull.date_range.end_date}`,
  );
  lines.push("");
  lines.push("| 接口 | 状态 | 行数 | HTTP | 说明 |");
  lines.push("| --- | --- | ---: | --- | --- |");
  for (const [apiId, row] of Object.entries(pull.per_api)) {
    const note = row.note ?? row.error ?? "";
    lines.push(`| ${apiId} | ${row.status} | ${row.total ?? 0} | ${row.http ?? "-"} | ${note || "—"} |`);
  }
  return lines;
}