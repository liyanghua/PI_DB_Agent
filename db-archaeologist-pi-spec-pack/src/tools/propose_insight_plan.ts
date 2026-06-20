// Thin wrapper: validate input, delegate to insight_planner service.
import { proposeInsightPlan as svc, listTemplates } from "../services/insight_planner.js";
import type { ProposeInsightPlanInput, InsightPlan } from "../services/insight_planner.js";

export type { ProposeInsightPlanInput, InsightPlan };

export function proposeInsightPlan(args: ProposeInsightPlanInput): InsightPlan {
  if (!args || typeof args.topic !== "string" || args.topic.trim() === "") {
    throw new Error("propose_insight_plan: topic is required");
  }
  if (args.candidate_limit !== undefined) {
    const n = args.candidate_limit;
    if (typeof n !== "number" || n < 3 || n > 30) {
      throw new Error("propose_insight_plan: candidate_limit out of range (3..30)");
    }
  }
  return svc(args);
}

export function listInsightTemplates() {
  return listTemplates().map(({ key, tpl }) => ({
    key,
    cn_name: tpl.cn_name,
    keywords: tpl.keywords ?? [],
    required_dimensions: tpl.required_dimensions,
    required_metrics: tpl.required_metrics,
    preferred_domains: tpl.preferred_domains ?? [],
    output_grain: tpl.output_grain,
    scenarios: tpl.scenarios ?? [],
  }));
}