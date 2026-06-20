// analyze_keyword_trend tool — pi/web 入口，调用 keyword_trend.analyzeKeywordTrend

import { analyzeKeywordTrend, type AnalyzeKeywordTrendInput } from "../services/keyword_trend/index.js";

export interface AnalyzeKeywordTrendToolInput {
  category: string;
  category_id?: string;
  live?: boolean;
  top_n?: number;
  date_range?: { start_date: string; end_date: string };
}

export interface AnalyzeKeywordTrendToolOutput {
  run_id: string;
  run_dir: string;
  category: string;
  category_id: string;
  top_rising: Array<{
    keyword: string;
    tms: number;
    trend_label: string;
    rank_reason: string;
  }>;
  top_falling: Array<{
    keyword: string;
    tms: number;
    trend_label: string;
    rank_reason: string;
  }>;
  summary_path: string;
}

export async function analyzeKeywordTrendTool(
  input: AnalyzeKeywordTrendToolInput,
): Promise<AnalyzeKeywordTrendToolOutput | { error: string; details?: string }> {
  const result = await analyzeKeywordTrend(input as AnalyzeKeywordTrendInput);

  if ("error" in result) {
    return { error: result.error, details: result.details };
  }

  return {
    run_id: result.meta.run_id,
    run_dir: result.run_dir,
    category: result.meta.category,
    category_id: result.meta.category_id,
    top_rising: result.top_rising.slice(0, 10).map((r) => ({
      keyword: r.keyword,
      tms: r.scores.tms,
      trend_label: r.trend_label,
      rank_reason: r.explanation.rank_reason,
    })),
    top_falling: result.top_falling.slice(0, 5).map((r) => ({
      keyword: r.keyword,
      tms: r.scores.tms,
      trend_label: r.trend_label,
      rank_reason: r.explanation.rank_reason,
    })),
    summary_path: `${result.run_dir}/trend_summary.md`,
  };
}