// Lifecycle推进规则 (按 docs/04_API_ASSET_CARD_SPEC.md §4):
// - raw         : 解析前
// - draft       : parse 失败或乱码 / 路径重复
// - candidate   : 默认起点；返回示例空 OR 返回字段说明空 → 最多停在 candidate
// - verified    : 质量分 ≥ 0.75 且无降级触发器
// - agent_ready : verified 且 entity/metric mapping 已建立
// - blocked     : 路径含 {api-id} 占位符未解析；或显式人工 block
// - deprecated  : 显式标记

import type { ApiAssetCard, LifecycleStatus } from "../lib/types.js";

export type LifecycleInput = {
  parse_failure?: boolean;
  duplicate_path?: boolean;
  garbled?: boolean;
  manual_block?: boolean;
  manual_deprecated?: boolean;
};

const VERIFIED_THRESHOLD = 0.75;

export function decideLifecycle(card: ApiAssetCard, ctx: LifecycleInput = {}): {
  status: LifecycleStatus;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (ctx.manual_deprecated) return { status: "deprecated", reasons: ["manual_deprecated"] };
  if (ctx.manual_block) return { status: "blocked", reasons: ["manual_block"] };

  const placeholder = /\{[^}]+\}/.test(card.path);
  if (placeholder) {
    reasons.push("path_placeholder");
    return { status: "blocked", reasons };
  }

  if (ctx.parse_failure) {
    reasons.push("parse_failure");
    return { status: "draft", reasons };
  }
  if (ctx.garbled) {
    reasons.push("garbled_response_example");
    return { status: "draft", reasons };
  }
  if (ctx.duplicate_path) {
    reasons.push("duplicate_path");
    return { status: "draft", reasons };
  }

  const example = card.response_schema?.example;
  const fields = card.response_schema?.fields ?? [];
  const exampleEmpty = example === null || example === undefined;
  const fieldsEmpty = fields.length === 0;

  if (exampleEmpty) reasons.push("empty_response_example");
  if (fieldsEmpty) reasons.push("missing_response_fields");

  if (exampleEmpty || fieldsEmpty) return { status: "candidate", reasons };

  if (card.quality_score < VERIFIED_THRESHOLD) {
    reasons.push(`quality_below_${VERIFIED_THRESHOLD}`);
    return { status: "candidate", reasons };
  }

  const hasEntity = (card.entity_mapping?.length ?? 0) > 0;
  const hasMetric = (card.metric_mapping?.length ?? 0) > 0;
  if (hasEntity && hasMetric) {
    reasons.push("entity_metric_mapped");
    return { status: "agent_ready", reasons };
  }

  reasons.push("verified_baseline");
  return { status: "verified", reasons };
}