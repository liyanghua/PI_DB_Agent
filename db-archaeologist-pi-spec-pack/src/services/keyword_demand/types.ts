// 关键词需求分析 types（§3b/3c）
// 遵循 explanation 下沉到记录、trace 可重算自校、业务报告中文化原则。

// ============ 配置与锁版 ============

export interface KdsWeights {
  version: number;
  formula_id: string;
  base_kds: {
    scale: number;
    growth: number;
    traffic: number;
    conversion: number;
  };
  scale_score: {
    primary: Record<string, number>;
    fallback_no_pay_buyers?: Record<string, number>;
    search_popularity_aliases?: string[];
  };
  growth_score: {
    primary: Record<string, number>;
    fallback_only_search_growth_rate?: Record<string, number>;
    fallback_only_mom?: Record<string, number>;
    fallback_neutral: number;
  };
  traffic_score: {
    primary: Record<string, number>;
    fallback_keyword_only?: Record<string, number>;
    fallback_no_click_rate: number;
  };
  conversion_score: {
    primary: Record<string, number>;
    fallback_no_conversion_rate?: Record<string, number>;
    fallback_only_pay_rate?: Record<string, number>;
    fallback_neutral: number;
  };
  intent_multiplier: {
    rules: Array<{
      id: string;
      when_all?: string[];
      when_any?: string[];
      value: number;
    }>;
    category_only_default: number;
    transaction_block_action: "skip_kds" | "reduce";
  };
  blue_ocean_score?: {
    weights: Record<string, number>;
  };
  kds_levels: Array<{
    min: number;
    max: number;
    code: string;
    cn_name: string;
  }>;
  opportunity_gates: Record<string, unknown>;
}

export interface KeywordTaxonomy {
  version: number;
  match_mode: "substring" | "exact" | "regex";
  labels: Record<
    string,
    {
      desc: string;
      terms: string[];
    }
  >;
}

export interface CategoryTaxonomy {
  version: number;
  default_strategy: string;
  entries: Array<{
    id: string;
    canonical_name: string;
    tertiary_category: string;
    category_id: string;
    aliases?: string[];
    notes?: string;
  }>;
}

export interface KeywordFieldMapping {
  version: number;
  keyword_metric_record_keys?: {
    identity?: string[];
    metrics?: string[];
  };
  apis: Record<
    string,
    {
      priority?: number;
      method?: string;
      path?: string;
      response_root?: string;
      keyword_field: string;
      request_template?: Record<string, unknown>;
      field_map?: Record<string, string>;
      notes?: string;
    }
  >;
  merge_order_priority?: string[];
}

export interface KeywordStrategy {
  name?: string;
  cn_name: string;
  score_module: string;
  weights_ref: string;
  taxonomy_ref: string;
  enabled: boolean;
  is_baseline?: boolean;
  description?: string;
}

export interface KeywordStrategiesConfig {
  version: number;
  default_strategy?: string;
  strategies: Record<string, KeywordStrategy>;
}

// ============ 运行时数据结构 ============

export interface KeywordMetricRecord {
  keyword: string;
  category_id?: string;
  tertiary_category?: string;
  statist_date?: string;
  business_date?: string;
  // 规模维度
  search_popularity?: number;
  search_index?: number;
  search_value?: number;
  pay_buyers?: number;
  pay_buyers_count?: number;
  search_visitors?: number;
  // 增长维度
  search_growth_rate?: number;
  search_popularity_mom?: number;
  search_popularity_yoy?: number;
  pay_buyers_mom?: number;
  pay_buyers_yoy?: number;
  trend_slope?: number;
  search_value_trend?: string;
  // 流量维度
  click_rate?: number;
  tmall_click_share?: number;
  // 转化维度
  pay_rate?: number;
  conversion_rate?: number;
  // 蓝海维度
  demand_supply_ratio?: number;
  requirement_prop?: number;
  relation_strength?: number;
  ocean_category?: string;
  composite_score?: number;
  // 元信息
  source?: string[];
  raw_count?: number;
}

export interface ClassificationRecord {
  keyword: string;
  labels: string[];
  matched_terms: Record<string, string[]>;
  intent_rule_id?: string;
  intent_multiplier?: number;
  conflicts?: string[];
}

export interface FieldProvenance {
  value: number | string;
  source_api: string;
  raw_field: string;
}

export interface SubScoreDetail {
  name: string;
  formula?: string;
  inputs?: Array<{
    var: string;
    rank?: string;
    value: number;
  }>;
  result: number;
  fallback_chain?: string[];
}

export interface KeywordExplanation {
  field_provenance: Record<string, FieldProvenance>;
  subscores: SubScoreDetail[];
  intent_multiplier?: {
    labels_seen: string[];
    rule_id: string;
    value: number;
  };
  kds_level: string;
  rank_reason: string;
}

export interface KeywordScoreRecord extends KeywordMetricRecord, ClassificationRecord {
  scores: {
    scale: number;
    growth: number;
    traffic: number;
    conversion: number;
    base_kds: number;
    kds: number;
    blue_ocean?: number;
  };
  explanation: KeywordExplanation;
}

export interface RankResult {
  top_overall: KeywordScoreRecord[];
  top_by_type: Record<string, KeywordScoreRecord[]>;
  top_by_metric: Record<string, KeywordScoreRecord[]>;
  top_by_blue_ocean?: KeywordScoreRecord[];
}

// ============ Normalize 报告 ============

export interface NormalizeReport {
  source_coverage: Record<string, string>;
  field_coverage: Record<string, number>;
  merge_winners: Array<{
    keyword: string;
    field: string;
    winner_source: string;
    all_sources: string[];
  }>;
  degradations: Array<{
    keyword: string;
    missing_field: string;
    fallback_used: string;
  }>;
}

// ============ Run 元信息 ============

export interface RunMeta {
  run_id: string;
  strategy: string;
  version: string;
  config_hash: string;
  weights_hash: string;
  taxonomy_hash: string;
  fixture_hash?: string;
  category: string;
  category_id: string;
  started_at: string;
  ended_at?: string;
  elapsed_ms?: number;
  stage_timings?: Record<string, number>;
  live_probe?: boolean;
}

// ============ 评测 ============

export interface GoldenAnchor {
  _meta: {
    category: string;
    category_id: string;
    version: string;
    annotator: string;
    date: string;
    notes?: string;
  };
  top_overall_must_include: string[];
  top_overall_must_exclude: string[];
  per_type_anchors: Record<string, string[]>;
}

export interface EvalMetrics {
  precision_at_k: number;
  recall_at_k: number;
  ndcg_at_k: number;
  must_include_hit_rate: number;
  must_exclude_violation_rate: number;
}

// ============ 对比 ============

export interface CompareResult {
  run_a: RunMeta;
  run_b: RunMeta;
  config_diff: Record<string, { a: unknown; b: unknown }>;
  top_k: number;
  overlap_rate: number;
  overlap_keywords: string[];
  ranking_correlation: {
    spearman: number;
    kendall_tau: number;
    ndcg_at_k: number;
  };
  top_movers: {
    rising: Array<{ keyword: string; rank_a: number; rank_b: number; kds_delta: number }>;
    falling: Array<{ keyword: string; rank_a: number; rank_b: number; kds_delta: number }>;
  };
  kds_distribution_diff: Record<string, { a: number; b: number; delta: number }>;
  label_distribution_diff: Record<string, { a: number; b: number; delta: number }>;
  per_metric_overlap: Record<string, number>;
  recommendation: string;
}