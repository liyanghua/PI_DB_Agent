// propose_koif_strategy tool — pi/web 入口，调用 koif_router.proposeKoifStrategy

import { proposeKoifStrategy, type ProposeKoifStrategyInput } from "../services/koif_router/index.js";

export type { ProposeKoifStrategyInput } from "../services/koif_router/types.js";

export interface ProposeKoifStrategyToolOutput {
  router_run_id: string;
  category: string;
  category_id: string;
  strategy_routes: Array<{
    strategy_id: string;
    cn_name: string;
    hit_count: number;
    confidence: number;
    hit_keywords: string[];
  }>;
  next_actions: Array<{
    action_id: string;
    cn_name: string;
    estimated_effort: string;
    keywords: string[];
    reason: string;
  }>;
  score_vector_top: Array<{
    keyword: string;
    kds?: number;
    tms?: number;
    trend_label?: string;
  }>;
  capability_runs: Array<{
    capability: string;
    run_id: string;
    status: string;
  }>;
  report_path: string;
}

export async function proposeKoifStrategyTool(
  input: ProposeKoifStrategyInput,
): Promise<ProposeKoifStrategyToolOutput | { error: string; details?: string }> {
  const result = await proposeKoifStrategy(input);

  if ("error" in result) {
    return { error: result.error, details: result.details };
  }

  return {
    router_run_id: result.router_run_id,
    category: result.category,
    category_id: result.category_id,
    strategy_routes: result.strategy_routes.map((r) => ({
      strategy_id: r.strategy_id,
      cn_name: r.cn_name,
      hit_count: r.hit_count,
      confidence: r.confidence,
      hit_keywords: r.hit_keywords.slice(0, 5),
    })),
    next_actions: result.next_actions.map((a) => ({
      action_id: a.action_id,
      cn_name: a.cn_name,
      estimated_effort: a.estimated_effort,
      keywords: a.keywords,
      reason: a.reason,
    })),
    score_vector_top: result.score_vector_top.map((e) => ({
      keyword: e.keyword,
      kds: e.scores.kds,
      tms: e.scores.tms,
      trend_label: e.trend_label,
    })),
    capability_runs: result.capability_runs.map((r) => ({
      capability: r.capability,
      run_id: r.run_id,
      status: r.status,
    })),
    report_path: result.report_path,
  };
}