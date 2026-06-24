// route.ts: S5 — 应用 koif_route_rules.yaml，按条件命中 strategy_routes[]
// 条件 DSL：字符串数组 ["kds >= 70", "tms >= 75"]，全部满足才算命中

import type { RouteRulesConfig, ScoreVectorEntry, StrategyRouteHit } from "./types.js";

export interface ApplyRouteRulesInput {
  score_vector: ScoreVectorEntry[];
  rules: RouteRulesConfig;
}

export interface ApplyRouteRulesOutput {
  strategy_routes: StrategyRouteHit[];
}

interface ParsedCondition {
  metric: string;
  op: ">=" | "<=" | ">" | "<" | "==";
  threshold: number;
  raw: string;
}

function parseCondition(raw: string): ParsedCondition | null {
  const m = raw.match(/^\s*([a-z][a-z0-9_]*)\s*(>=|<=|>|<|==)\s*(-?[\d.]+)\s*$/i);
  if (!m) return null;
  return {
    metric: m[1].toLowerCase(),
    op: m[2] as ParsedCondition["op"],
    threshold: Number(m[3]),
    raw,
  };
}

function evalCondition(entry: ScoreVectorEntry, cond: ParsedCondition): boolean {
  const v = entry.scores[cond.metric];
  if (v === undefined || v === null || Number.isNaN(v)) return false;
  switch (cond.op) {
    case ">=": return v >= cond.threshold;
    case "<=": return v <= cond.threshold;
    case ">": return v > cond.threshold;
    case "<": return v < cond.threshold;
    case "==": return v === cond.threshold;
  }
}

function renderReason(template: string, entry: ScoreVectorEntry): string {
  return template.replace(/\{([a-z][a-z0-9_]*)(?::[^}]+)?\}/gi, (_, metric: string) => {
    const v = entry.scores[metric.toLowerCase()];
    return v !== undefined ? String(Math.round(v * 10) / 10) : "—";
  }).trim();
}

export function applyRouteRules(input: ApplyRouteRulesInput): ApplyRouteRulesOutput {
  const totalKw = input.score_vector.length;
  const out: StrategyRouteHit[] = [];

  for (const [strategy_id, rule] of Object.entries(input.rules)) {
    const conds = rule.conditions.map(parseCondition).filter((c): c is ParsedCondition => c !== null);
    if (conds.length === 0) continue;

    const hits = input.score_vector.filter((e) => conds.every((c) => evalCondition(e, c)));
    if (hits.length === 0) continue;

    // 取首个命中关键词渲染 reason（代表性示例）
    const sample = [...hits].sort((a, b) => {
      const av = a.scores[conds[0].metric] ?? 0;
      const bv = b.scores[conds[0].metric] ?? 0;
      return bv - av;
    })[0];

    out.push({
      strategy_id,
      cn_name: rule.cn_name,
      priority: rule.priority,
      hit_keywords: hits.slice(0, 20).map((h) => h.keyword),
      hit_count: hits.length,
      total_keywords: totalKw,
      confidence: totalKw > 0 ? Math.round((hits.length / totalKw) * 1000) / 1000 : 0,
      reason: renderReason(rule.reason_template, sample),
    });
  }

  // 排序：priority 升序（数字越小越高优），同 priority 按 hit_count 降序
  out.sort((a, b) => (a.priority - b.priority) || (b.hit_count - a.hit_count));
  return { strategy_routes: out };
}