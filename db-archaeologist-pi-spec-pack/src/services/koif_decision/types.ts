// koif_decision/types.ts: KOIF Decision Layer 契约（Phase 3 仅占位）
// 详见 docs/19_KOIF_DECISION_LAYER_SPEC.md

export type DecisionKind =
  | "paid_test_plan"
  | "sku_supply_plan"
  | "content_calendar"
  | "defensive_paid_plan"
  | "category_entry_plan";

export const DECISION_KIND_VALUES: ReadonlyArray<DecisionKind> = [
  "paid_test_plan",
  "sku_supply_plan",
  "content_calendar",
  "defensive_paid_plan",
  "category_entry_plan",
];

export interface DecisionBudgetHint {
  daily_budget_cny?: number;
  duration_days?: number;
}

export interface ProposeKoifDecisionInput {
  router_run_id: string;
  decision_kind: string;
  budget_hint?: DecisionBudgetHint;
  risk_tolerance?: "low" | "medium" | "high";
  notes?: string;
}

// Phase 3 唯一成功路径暂未实现；此处仅给出 Phase 3.5+ 形态作为契约文档
export interface DecisionAction {
  action_kind: string;
  keywords: string[];
  budget_cny?: number;
  duration_days?: number;
  bid_range?: [number, number];
  kpi_targets?: {
    roi_min?: number;
    ctr_min?: number;
  };
  rationale: string;
}

export interface DecisionPlan {
  kind: DecisionKind;
  actions: DecisionAction[];
}

export interface ProposeKoifDecisionSuccess {
  kind: "koif_decision_run";
  decision_run_id: string;
  router_run_id: string;
  decision_kind: DecisionKind;
  decision_plan: DecisionPlan;
  risk_notes: string[];
  assumption_log: string[];
  decision_report_path: string;
  decision_meta_path: string;
  warnings: string[];
}

export type DecisionErrorCode =
  | "decision_layer_phase3_stub"
  | "router_run_not_found"
  | "router_run_corrupted"
  | "router_run_id_required"
  | "decision_kind_unsupported"
  | "decision_kind_unavailable"
  | "decision_score_insufficient";

export interface ProposeKoifDecisionError {
  kind: "koif_decision_error";
  error: DecisionErrorCode;
  message: string;
  hints: string[];
  router_run_id?: string;
}

export type ProposeKoifDecisionOutput =
  | ProposeKoifDecisionSuccess
  | ProposeKoifDecisionError;