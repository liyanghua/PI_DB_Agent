// koif_router types — Router 元工具类型定义
// 依据：docs/15 §2 工具契约 + docs/17 §2 模块责任

import type { CategoryContext } from "../keyword_demand/resolve.js";

// ============ Router 配置（YAML） ============

export interface RouteRule {
  cn_name: string;
  priority: number;
  conditions: string[]; // ["kds >= 70", "tms >= 75"]
  actions: string[]; // 触发的 action template id
  reason_template: string;
}

export interface RouteRulesConfig {
  [strategy_id: string]: RouteRule;
}

export interface ActionTemplate {
  template_id: string;
  cn_name: string;
  estimated_effort: "low" | "medium" | "high";
  keyword_picker: {
    source: "keyword_demand" | "keyword_trend" | "intersection" | string;
    field?: string;
    bucket?: string;
    order?: "desc" | "asc";
    top_n: number;
    filter?: Record<string, number>;
    filters?: Record<string, number>;
  };
  reason_template: string;
}

export interface ActionTemplatesConfig {
  [action_id: string]: ActionTemplate;
}

// ============ Router 输入输出 ============

export type SubjectKind =
  | "keyword"
  | "item"
  | "shop"
  | "creative"
  | "category"
  | "content";

export const SUBJECT_KIND_VALUES: ReadonlyArray<SubjectKind> = [
  "keyword", "item", "shop", "creative", "category", "content",
];

export const SUBJECT_KIND_PHASE1_IMPLEMENTED: ReadonlyArray<SubjectKind> = ["keyword"];

// Phase 1: keyword 主体仍是 "kds" | "tms" | "cps"；保留枚举语义，
// 仅放宽到 string 用于扩展（Router 评分 metric 名由 capability_map 注册表权威定义）。
export type CapabilityCode = string;
export const KEYWORD_CAPABILITY_CODES: ReadonlyArray<"kds" | "tms" | "cps"> = ["kds", "tms", "cps"];

export interface ProposeKoifStrategyInput {
  subject_kind?: SubjectKind;
  category: string;
  category_id?: string;
  capabilities?: CapabilityCode[];
  live?: boolean;
  top_n?: number;
}

export interface CapabilityRunRef {
  capability: CapabilityCode;
  run_id: string;
  run_dir: string;
  status: "ok" | "unavailable";
  reason?: string;
}

export interface ScoreVectorEntry {
  subject_kind: SubjectKind;
  subject_id: string;
  subject_label?: string;
  keyword: string;
  category: string;
  scores: Record<string, number>;
  available_scores: string[];
  trend_label?: "rising" | "stable" | "falling";
  kds_level?: string;
  cps_bucket?: "strong" | "medium" | "weak";
  cpc_source?: "paid" | "fallback" | "missing";
  rank_reason?: string;
}

export interface StrategyRouteHit {
  strategy_id: string;
  cn_name: string;
  priority: number;
  hit_keywords: string[];
  hit_count: number;
  total_keywords: number;
  confidence: number;
  reason: string;
}

export interface NextAction {
  action_id: string;
  template_id: string;
  cn_name: string;
  estimated_effort: "low" | "medium" | "high";
  triggered_by: string[]; // strategy_id 列表
  keywords: string[];
  reason: string;
}

export interface RouterRunMeta {
  router_run_id: string;
  router_version: string; // "v1.0-kds-tms"
  category: string;
  category_id: string;
  requested_category: string;
  requested_capabilities: CapabilityCode[];
  capability_runs: CapabilityRunRef[];
  rules_hash: string;
  templates_hash: string;
  started_at: string;
  ended_at?: string;
  live_probe?: boolean;
}

export interface ProposeKoifStrategyOutput {
  router_run_id: string;
  router_run_dir: string;
  category: string;
  category_id: string;
  strategy_routes: StrategyRouteHit[];
  next_actions: NextAction[];
  score_vector_top: ScoreVectorEntry[];
  capability_runs: CapabilityRunRef[];
  report_path: string;
}

export interface ProposeKoifStrategyError {
  error: string;
  details?: string;
  capability_runs?: CapabilityRunRef[];
}

// ============ Resolve 复用契约 ============

export type ResolvedCategory = CategoryContext;