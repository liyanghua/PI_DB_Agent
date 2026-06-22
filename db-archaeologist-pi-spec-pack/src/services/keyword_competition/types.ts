// src/services/keyword_competition/types.ts
// CPS capability 类型定义；结构对齐 keyword_demand/types.ts，仅含 CPS 相关结构。
// 详见 docs/20 §2 / §7.1。

import type {
  CategoryTaxonomy,
  KeywordFieldMapping,
  KeywordStrategiesConfig,
  KeywordAnalysisPacksConfig,
  PullReportSummary,
  KeywordSourceAudit,
  ResolutionInfo,
} from "../keyword_demand/types.js";

export type {
  CategoryTaxonomy,
  KeywordFieldMapping,
  KeywordStrategiesConfig,
  KeywordAnalysisPacksConfig,
  PullReportSummary,
  KeywordSourceAudit,
  ResolutionInfo,
};

// ============ 配置 ============

export interface CpsWeights {
  version: number;
  formula_id: string;
  base_cps: {
    competition_index: number;
    market_avg_bid: number;
  };
  market_avg_bid_normalize: {
    log_base: number;
    cap_cny: number;
  };
  competition_index_fallback: string[];
  market_avg_bid_fallback: string[];
  cps_levels: Array<{
    min: number;
    max: number;
    code: string;
    cn_name: string;
  }>;
  solo_subscore_policy: {
    enabled: boolean;
    fallback_codes: string[];
  };
}

// ============ 运行时数据 ============

export type CpcSource = "paid" | "fallback" | "missing";

export type AggregationKind = "category_broadcast" | "keyword_native";

/**
 * Stage A 输出：商品级 raw 按 tertiary_category 聚合后的类目级标量。
 * Stage C 把这些字段广播到该类目下所有 record 的 competition_index / brand_concentration。
 */
export interface CategoryLevelMetrics {
  tertiary_category: string;
  competition_index?: number;
  brand_concentration?: number;
  distinct_shop_count?: number;
  source_api: string;
  raw_row_count: number;
}

/**
 * Stage B 输出：投流域 raw 按 kw_name 聚合后的关键词级标量。
 */
export interface KeywordLevelMetrics {
  keyword: string;
  avg_cpc_cny?: number;
  weighted_cost_per_clk?: number;
  source_api: string;
  raw_row_count: number;
}

export interface CompetitionMetricRecord {
  keyword: string;
  category_id?: string;
  tertiary_category?: string;
  business_date?: string;
  // CPS 子分数原料字段
  competition_index?: number;
  brand_concentration?: number;
  competitor_count?: number;
  distinct_shop_count?: number;
  avg_cpc_cny?: number;
  weighted_cost_per_clk?: number;
  market_avg_bid?: number;
  ad_keyword_ratio?: number;
  // CPC 来源标记：paid（投流域命中）/ fallback（备份字段命中）/ missing（无任何 CPC 信号）
  cpc_source: CpcSource;
  // 字段级 source_api：每个原料字段最终来自哪个 api（normalize Stage A/B/Z 写入；
  // baseline_v1 优先用此覆盖 record.source[0]，避免 provenance 错配到 priority 高的非贡献源）。
  field_source_api?: Record<string, string>;
  // 元信息
  source?: string[];
  raw_count?: number;
}

export interface CpsSubScoreDetail {
  name: "competition_index" | "market_avg_bid";
  formula?: string;
  raw_value?: number;
  normalized_value: number;
  fallback_chain: string[];
  source_api?: string;
  raw_field?: string;
}

export interface CpsExplanation {
  field_provenance: Record<
    string,
    {
      value: number | string;
      source_api: string;
      raw_field: string;
      aggregation_kind?: AggregationKind;
    }
  >;
  subscores: CpsSubScoreDetail[];
  formula: string;
  cps_level: string;
  fallback_chain: string[];
  rank_reason: string;
}

export interface CompetitionScoreRecord extends CompetitionMetricRecord {
  cps: number;
  subscores: {
    competition_index: number;
    market_avg_bid: number;
  };
  explanation: CpsExplanation;
}

export interface CpsRankResult {
  top_overall: CompetitionScoreRecord[];
  top_by_bucket: Record<string, CompetitionScoreRecord[]>;
}

// ============ Normalize 报告（轻量） ============

export interface CpsNormalizeReport {
  source_coverage: Record<string, string>;
  field_coverage: Record<string, number>;
  merge_winners: Array<{
    keyword: string;
    field: string;
    winner_source: string;
    all_sources: string[];
  }>;
}

// ============ Run meta ============

export interface CpsRunMeta {
  run_id: string;
  strategy: string;
  capability: "keyword_competition";
  analysis_pack_id?: string;
  analysis_pack_name?: string;
  requested_category: string;
  analysis_category: string;
  version: string;
  config_hash: string;
  weights_hash: string;
  fixture_hash?: string;
  category: string;
  category_id: string;
  started_at: string;
  ended_at?: string;
  elapsed_ms?: number;
  stage_timings?: Record<string, number>;
  live_probe?: boolean;
  date_range?: { start_date: string; end_date: string };
  resolution?: ResolutionInfo;
  pull_report?: PullReportSummary;
  diagnostic?: {
    kind: "live_no_competition_data";
    effective_apis: number;
    total_keywords: number;
    reason: string;
  };
}