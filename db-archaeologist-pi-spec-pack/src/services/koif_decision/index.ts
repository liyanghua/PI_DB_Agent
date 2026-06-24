// koif_decision/index.ts: Phase 3 占位实现
// 行为：完整校验入参 → 校验 router_run 存在性 → 一律返 decision_layer_phase3_stub
// 真实决策算法（预算/出价/ROI）等 PVS capability 落地后再实质化（Phase 3.5+）。
// 详见 docs/19_KOIF_DECISION_LAYER_SPEC.md §5.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../lib/io.js";
import {
  DECISION_KIND_VALUES,
  LEGACY_DECISION_KIND_ALIAS,
  normalizeDecisionKind,
  type ProposeKoifDecisionInput,
  type ProposeKoifDecisionOutput,
} from "./types.js";

const ROUTER_RUNS_ROOT = "registry/koif_routes";
const PHASE_3_5_HINT_LINES = [
  "Phase 3 仅提供 KOIF 客观评分（KDS/TMS/CPS）+ 中性 ranking actions（来自 propose_koif_strategy）",
  "决策性输出（如付费投放预算、出价区间、ROI 阈值）预计 Phase 3.5 解锁，依赖 PVS（Paid Value Score）落地",
];

export async function proposeKoifDecision(
  input: ProposeKoifDecisionInput,
): Promise<ProposeKoifDecisionOutput> {
  const routerRunId = (input?.router_run_id ?? "").trim();
  if (!routerRunId) {
    return {
      kind: "koif_decision_error",
      error: "router_run_id_required",
      message: "router_run_id 必填：决策层只读 router_run 产物。",
      hints: [
        "先调 propose_koif_strategy 拿到 router_run_id",
        "再调 propose_koif_decision 传入 router_run_id",
      ],
    };
  }

  const normalizedKind = normalizeDecisionKind(input?.decision_kind ?? "");
  if (!normalizedKind) {
    return {
      kind: "koif_decision_error",
      error: "decision_kind_unsupported",
      message: `decision_kind=${input?.decision_kind ?? "(empty)"} 不在合法枚举内（含 alias）。`,
      hints: [
        `合法枚举：${DECISION_KIND_VALUES.join(", ")}`,
        `兼容别名：${Object.keys(LEGACY_DECISION_KIND_ALIAS).join(", ")} → keyword.<kind>`,
        "Phase 3 内所有 decision_kind 都返 decision_layer_phase3_stub，但需要先合法",
      ],
      router_run_id: routerRunId,
    };
  }
  const decisionKind = normalizedKind;

  const routerDir = join(ROOT, ROUTER_RUNS_ROOT, routerRunId);
  if (!existsSync(routerDir)) {
    return {
      kind: "koif_decision_error",
      error: "router_run_not_found",
      message: `router_run_id=${routerRunId} 对应目录不存在。`,
      hints: [
        "确认 propose_koif_strategy 已成功执行并落产物",
        `预期路径：${ROUTER_RUNS_ROOT}/${routerRunId}/`,
      ],
      router_run_id: routerRunId,
    };
  }

  const metaPath = join(routerDir, "router_meta.json");
  if (!existsSync(metaPath)) {
    return {
      kind: "koif_decision_error",
      error: "router_run_corrupted",
      message: `router_run_id=${routerRunId} 缺少 router_meta.json。`,
      hints: ["重跑 propose_koif_strategy 重生 router_run"],
      router_run_id: routerRunId,
    };
  }

  return {
    kind: "koif_decision_error",
    error: "decision_layer_phase3_stub",
    message:
      "决策层（含预算/ROI/出价/跑量周期）尚未实质化，等待 PVS capability 落地后开放。",
    hints: [
      ...PHASE_3_5_HINT_LINES,
      `当前 router_run_id=${routerRunId} 已通过完整性校验，可作为 Phase 3.5 决策层的输入快照保留`,
      `decision_kind=${decisionKind} 将在 Phase 3.5+ 解锁`,
    ],
    router_run_id: routerRunId,
  };
}

export type {
  ProposeKoifDecisionInput,
  ProposeKoifDecisionOutput,
} from "./types.js";