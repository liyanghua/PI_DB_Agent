// get_koif_route tool — 读取 router run 详情

import { getRouterRun } from "../services/koif_router/write.js";

export interface GetKoifRouteInput {
  router_run_id: string;
}

export interface GetKoifRouteOutput {
  router_run_id: string;
  category: string;
  category_id: string;
  router_version: string;
  strategy_routes: Array<{
    strategy_id: string;
    cn_name: string;
    hit_count: number;
    confidence: number;
    hit_keywords: string[];
    reason: string;
  }>;
  next_actions: Array<{
    action_id: string;
    cn_name: string;
    estimated_effort: string;
    keywords: string[];
    reason: string;
  }>;
  score_vector_sample: Array<{
    keyword: string;
    kds?: number;
    tms?: number;
    trend_label?: string;
    available_scores: string[];
  }>;
  report_md: string;
}

export function getKoifRouteTool(input: GetKoifRouteInput): GetKoifRouteOutput | { error: string } {
  const run = getRouterRun(input.router_run_id);
  if (!run) {
    return { error: `router_run_not_found: ${input.router_run_id}` };
  }

  return {
    router_run_id: run.meta.router_run_id,
    category: run.meta.category,
    category_id: run.meta.category_id,
    router_version: run.meta.router_version,
    strategy_routes: run.strategy_routes.map((r) => ({
      strategy_id: r.strategy_id,
      cn_name: r.cn_name,
      hit_count: r.hit_count,
      confidence: r.confidence,
      hit_keywords: r.hit_keywords,
      reason: r.reason,
    })),
    next_actions: run.next_actions.map((a) => ({
      action_id: a.action_id,
      cn_name: a.cn_name,
      estimated_effort: a.estimated_effort,
      keywords: a.keywords,
      reason: a.reason,
    })),
    score_vector_sample: run.score_vector.slice(0, 20).map((e) => ({
      keyword: e.keyword,
      kds: e.scores.kds,
      tms: e.scores.tms,
      trend_label: e.trend_label,
      available_scores: e.available_scores,
    })),
    report_md: run.report_md,
  };
}