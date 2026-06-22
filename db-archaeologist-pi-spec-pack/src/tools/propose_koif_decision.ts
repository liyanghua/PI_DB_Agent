// propose_koif_decision: KOIF 决策层元工具（pi 入口）
// Phase 3 占位 — 包装 src/services/koif_decision/index.ts 的 proposeKoifDecision
// 详见 docs/19_KOIF_DECISION_LAYER_SPEC.md

import { proposeKoifDecision } from "../services/koif_decision/index.js";
import type {
  ProposeKoifDecisionInput,
  ProposeKoifDecisionOutput,
} from "../services/koif_decision/index.js";

export type ProposeKoifDecisionToolInput = ProposeKoifDecisionInput;

export type ProposeKoifDecisionToolOutput = ProposeKoifDecisionOutput;

export async function proposeKoifDecisionTool(
  args: ProposeKoifDecisionToolInput,
): Promise<ProposeKoifDecisionToolOutput> {
  return await proposeKoifDecision(args ?? ({} as ProposeKoifDecisionInput));
}

export function summarizeKoifDecisionToolOutput(
  output: ProposeKoifDecisionToolOutput,
): string {
  if (output.kind === "koif_decision_error") {
    const lines = [
      `KOIF 决策层调用未通过：${output.error}`,
      output.message,
    ];
    if (output.router_run_id) lines.push(`router_run_id=${output.router_run_id}`);
    if (output.hints?.length) {
      lines.push("");
      lines.push("提示：");
      for (const h of output.hints) lines.push(`- ${h}`);
    }
    return lines.join("\n");
  }

  // Phase 3.5+ 路径（占位）
  const lines: string[] = [];
  lines.push(`KOIF 决策方案生成：${output.decision_kind}`);
  lines.push(`decision_run_id=${output.decision_run_id}`);
  lines.push(`router_run_id=${output.router_run_id}`);
  lines.push(`决策动作数=${output.decision_plan.actions.length}`);
  if (output.risk_notes.length) {
    lines.push("");
    lines.push("风险提示：");
    for (const r of output.risk_notes) lines.push(`- ${r}`);
  }
  return lines.join("\n");
}