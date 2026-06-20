// actions.ts: S6 — 应用 koif_action_templates.yaml，按命中 strategy 渲染 next_actions[]

import type {
  ActionTemplatesConfig,
  NextAction,
  ScoreVectorEntry,
  StrategyRouteHit,
} from "./types.js";

export interface RenderActionsInput {
  score_vector: ScoreVectorEntry[];
  strategy_routes: StrategyRouteHit[];
  templates: ActionTemplatesConfig;
  // strategy_id → action_id[] 映射（来自 route_rules.actions）
  rule_actions: Record<string, string[]>;
}

export interface RenderActionsOutput {
  next_actions: NextAction[];
}

export function renderNextActions(input: RenderActionsInput): RenderActionsOutput {
  const out: NextAction[] = [];
  const seen = new Set<string>();

  // strategy_id → 触发的 action_id（按规则配置）
  const triggered_by_action: Record<string, string[]> = {};
  for (const route of input.strategy_routes) {
    const acts = input.rule_actions[route.strategy_id] ?? [];
    for (const a of acts) {
      if (!triggered_by_action[a]) triggered_by_action[a] = [];
      triggered_by_action[a].push(route.strategy_id);
    }
  }

  for (const [action_id, triggers] of Object.entries(triggered_by_action)) {
    const tpl = input.templates[action_id];
    if (!tpl) continue;
    if (seen.has(action_id)) continue;
    seen.add(action_id);

    const keywords = pickKeywords(input.score_vector, tpl);
    if (keywords.length === 0) continue;

    const reason = renderReasonTemplate(tpl.reason_template, keywords, input.score_vector);

    out.push({
      action_id,
      template_id: tpl.template_id,
      cn_name: tpl.cn_name,
      estimated_effort: tpl.estimated_effort,
      triggered_by: triggers,
      keywords,
      reason,
    });
  }

  return { next_actions: out };
}

function pickKeywords(
  vec: ScoreVectorEntry[],
  tpl: ActionTemplatesConfig[string],
): string[] {
  const picker = tpl.keyword_picker;
  let pool = [...vec];

  if (picker.source === "keyword_demand") {
    pool = pool.filter((e) => e.scores.kds !== undefined);
    if (picker.filter?.min_kds !== undefined) pool = pool.filter((e) => (e.scores.kds ?? 0) >= picker.filter!.min_kds!);
    pool.sort((a, b) => (b.scores.kds ?? 0) - (a.scores.kds ?? 0));
  } else if (picker.source === "keyword_trend") {
    pool = pool.filter((e) => e.scores.tms !== undefined);
    if (picker.bucket === "rising") pool = pool.filter((e) => e.trend_label === "rising");
    if (picker.filter?.min_tms !== undefined) pool = pool.filter((e) => (e.scores.tms ?? 0) >= picker.filter!.min_tms!);
    pool.sort((a, b) => (b.scores.tms ?? 0) - (a.scores.tms ?? 0));
  } else if (picker.source === "intersection") {
    pool = pool.filter((e) => e.scores.kds !== undefined && e.scores.tms !== undefined);
    const f = picker.filters ?? {};
    if (f.min_kds !== undefined) pool = pool.filter((e) => (e.scores.kds ?? 0) >= f.min_kds!);
    if (f.min_tms !== undefined) pool = pool.filter((e) => (e.scores.tms ?? 0) >= f.min_tms!);
    // 几何平均排序
    pool.sort((a, b) => geomScore(b) - geomScore(a));
  }

  return pool.slice(0, picker.top_n).map((e) => e.keyword);
}

function geomScore(e: ScoreVectorEntry): number {
  const k = e.scores.kds ?? 0;
  const t = e.scores.tms ?? 0;
  return Math.sqrt(k * t);
}

function renderReasonTemplate(template: string, keywords: string[], vec: ScoreVectorEntry[]): string {
  const join = keywords.slice(0, 5).join("、");

  // 计算 mom_avg（用于 content_topic 模板）
  const filtered = vec.filter((e) => keywords.includes(e.keyword) && e.scores.tms !== undefined);
  const moms = filtered.map((e) => e.scores.tms ?? 0);
  const momAvg = moms.length > 0 ? moms.reduce((a, b) => a + b, 0) / moms.length / 100 : 0;

  return template
    .replace(/\{keywords_join\}/g, join)
    .replace(/\{mom_avg:?[^}]*\}/g, `${(momAvg * 100).toFixed(1)}%`)
    .trim();
}