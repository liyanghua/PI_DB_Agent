// keyword_trend types — TMS（趋势强度分）capability
// 复用 keyword_demand 的基础类型：KeywordMetricRecord / CategoryTaxonomy / KeywordFieldMapping / PullReportSummary / ResolutionInfo

import type {
  KeywordMetricRecord,
  PullReportSummary,
  ResolutionInfo,
} from "../keyword_demand/types.js";

// ============ TMS 权重配置 ============

export interface TmsWeights {
  version: number;
  formula_id: string;
  base_tms: {
    mom: number;
    yoy: number;
    slope: number;
    consistency: number;
  };
  mom_score: {
    primary: Record<string, number>;
    fallback_neutral: number;
  };
  yoy_score: {
    primary: Record<string, number>;
    fallback_neutral: number;
  };
  slope_score: {
    primary: Record<string, number>;
    fallback_only_growth_rate: Record<string, number>;
    fallback_neutral: number;
  };
  consistency_score: {
    rising: number;
    stable: number;
    falling: number;
    fallback_neutral: number;
  };
  trend_labels: Array<{
    min: number;
    max: number;
    code: "rising" | "stable" | "falling";
    cn_name: string;
  }>;
}

// ============ TMS 子分详情 ============

export interface TmsSubScore {
  name: "mom" | "yoy" | "slope" | "consistency";
  inputs: Array<{ var: string; value: number | string; bucket?: string }>;
  result: number;
  fallback_chain?: string[];
}

// ============ TrendRecord（单关键词打分结果）============

export interface TrendRecord extends KeywordMetricRecord {
  scores: {
    mom: number;
    yoy: number;
    slope: number;
    consistency: number;
    tms: number;
  };
  trend_label: "rising" | "stable" | "falling";
  explanation: {
    subscores: TmsSubScore[];
    rank_reason: string;
  };
}

// ============ Run 元信息 ============

export interface TrendRunMeta {
  run_id: string;
  capability: "keyword_trend";
  score_domain: "trend";
  koif_aggregatable: true;
  category: string;
  category_id: string;
  requested_category: string;
  weights_hash: string;
  config_hash: string;
  started_at: string;
  ended_at?: string;
  live_probe?: boolean;
  date_range?: { start_date: string; end_date: string };
  resolution?: ResolutionInfo;
  pull_report?: PullReportSummary;
  total_keywords: number;
  rising_count: number;
  stable_count: number;
  falling_count: number;
}

// ============ TrendResult（落盘产物）============

export interface TrendResult {
  meta: TrendRunMeta;
  records: TrendRecord[];
  top_rising: TrendRecord[];
  top_falling: TrendRecord[];
}