// index.ts: KOIF Router 编排器（S1 resolve → S2 invoke → S3+S4 aggregate → S5 route → S6 actions → S7 write）

import { join } from "node:path";
import { readYaml, ROOT } from "../../lib/io.js";
import type {
  ActionTemplatesConfig,
  CapabilityCode,
  ProposeKoifStrategyError,
  ProposeKoifStrategyInput,
  ProposeKoifStrategyOutput,
  RouteRulesConfig,
  RouterRunMeta,
} from "./types.js";
import { resolveRouterCategory } from "./resolve.js";
import { invokeCapabilities } from "./invoke.js";
import { aggregateScoreVector } from "./aggregate.js";
import { applyRouteRules } from "./route.js";
import { renderNextActions } from "./actions.js";
import { buildRouterRunId, hashRouterConfig, writeRouterRun } from "./write.js";

const ROUTER_VERSION = "v1.0-kds-tms";

export async function proposeKoifStrategy(
  input: ProposeKoifStrategyInput,
): Promise<ProposeKoifStrategyOutput | ProposeKoifStrategyError> {
  const startedAt = new Date().toISOString();
  const requestedCategory = input.category.trim();
  const live = input.live ?? false;
  const capabilities: CapabilityCode[] = input.capabilities ?? ["kds", "tms"];

  // S0: 加载配置
  const rules = readYaml<RouteRulesConfig>(join(ROOT, "registry/koif_route_rules.yaml"));
  const templates = readYaml<ActionTemplatesConfig>(join(ROOT, "registry/koif_action_templates.yaml"));

  // S1: resolve category
  const resolved = await resolveRouterCategory({
    category: input.category,
    category_id: input.category_id,
    live,
  });
  if (!resolved.ok) {
    return { error: resolved.error, details: resolved.details };
  }
  const ctx = resolved.ctx;

  // S2: invoke capabilities
  const { capability_runs } = await invokeCapabilities({
    category: ctx.category_name,
    category_id: ctx.category_id,
    capabilities,
    live,
    top_n: input.top_n,
  });

  const okRuns = capability_runs.filter((r) => r.status === "ok");
  if (okRuns.length === 0) {
    return {
      error: "koif_no_capabilities_available",
      details: capability_runs.map((r) => `${r.capability}: ${r.reason ?? "unavailable"}`).join("; "),
      capability_runs,
    };
  }

  // S3+S4: aggregate score vector
  const { score_vector, available_capabilities } = aggregateScoreVector({
    category: ctx.category_name,
    capability_runs,
  });

  if (score_vector.length === 0) {
    return {
      error: "koif_score_aggregation_failed",
      details: `所有 capability 都未产生可用关键词分数；available=[${available_capabilities.join(",")}]`,
      capability_runs,
    };
  }

  // S5: apply route rules
  const { strategy_routes } = applyRouteRules({ score_vector, rules });

  // S6: render next actions
  const rule_actions: Record<string, string[]> = {};
  for (const [sid, rule] of Object.entries(rules)) {
    rule_actions[sid] = rule.actions ?? [];
  }
  const { next_actions } = renderNextActions({
    score_vector,
    strategy_routes,
    templates,
    rule_actions,
  });

  // S7: build meta + write
  const rulesHash = hashRouterConfig([rules]);
  const templatesHash = hashRouterConfig([templates]);
  const configHash = hashRouterConfig([
    rulesHash,
    templatesHash,
    capabilities,
    ctx.category_id ?? "no_cat",
    capability_runs.map((r) => r.run_id).join(","),
  ]);
  const routerRunId = buildRouterRunId(ctx.category_id ?? "partial", configHash);

  const meta: RouterRunMeta = {
    router_run_id: routerRunId,
    router_version: ROUTER_VERSION,
    category: ctx.category_name,
    category_id: ctx.category_id ?? "partial",
    requested_category: requestedCategory,
    requested_capabilities: capabilities,
    capability_runs,
    rules_hash: rulesHash,
    templates_hash: templatesHash,
    started_at: startedAt,
    live_probe: live,
  };

  const reportMd = buildRouterReport(meta, score_vector, strategy_routes, next_actions);
  const dir = writeRouterRun({
    meta: { ...meta, ended_at: new Date().toISOString() },
    score_vector,
    strategy_routes,
    next_actions,
    report_md: reportMd,
  });

  // 截 TOP score_vector 返回（避免 LLM prompt 膨胀）
  const top_n = input.top_n ?? 10;
  const score_vector_top = [...score_vector]
    .sort((a, b) => {
      const ak = a.scores.kds ?? 0;
      const bk = b.scores.kds ?? 0;
      const at = a.scores.tms ?? 0;
      const bt = b.scores.tms ?? 0;
      return Math.sqrt(bk * bt) - Math.sqrt(ak * at);
    })
    .slice(0, top_n);

  return {
    router_run_id: routerRunId,
    router_run_dir: dir,
    category: ctx.category_name,
    category_id: ctx.category_id ?? "partial",
    strategy_routes,
    next_actions,
    score_vector_top,
    capability_runs,
    report_path: join(dir, "router_report.md"),
  };
}

function buildRouterReport(
  meta: RouterRunMeta,
  vec: import("./types.js").ScoreVectorEntry[],
  routes: import("./types.js").StrategyRouteHit[],
  actions: import("./types.js").NextAction[],
): string {
  const lines: string[] = [];
  lines.push(`# KOIF 经营策略报告 · ${meta.category}`);
  lines.push("");
  lines.push(`router_run_id：${meta.router_run_id}`);
  lines.push(`分析包：keyword_analysis_pack（KDS + TMS）`);
  lines.push(`触发能力：${meta.requested_capabilities.join(" + ")}`);
  lines.push("");

  lines.push("## 数据底座");
  lines.push(`- 关键词总数：${vec.length}`);
  for (const r of meta.capability_runs) {
    lines.push(`- ${r.capability}: ${r.status === "ok" ? r.run_id : "未启用（" + (r.reason ?? "n/a") + "）"}`);
  }
  lines.push("");

  lines.push("## 策略路由");
  if (routes.length === 0) {
    lines.push("- 无显著策略命中（所有路由规则未触发）");
  } else {
    for (const r of routes) {
      lines.push(`### ${r.cn_name}（${r.strategy_id}）`);
      lines.push(`- 命中关键词：${r.hit_count} / ${r.total_keywords}（覆盖率 ${(r.confidence * 100).toFixed(1)}%）`);
      lines.push(`- TOP 词：${r.hit_keywords.slice(0, 5).join("、") || "—"}`);
      lines.push(`- 判断依据：${r.reason}`);
      lines.push("");
    }
  }

  lines.push("## 行动建议");
  if (actions.length === 0) {
    lines.push("- 暂无行动建议（路由未命中或筛选后关键词为空）");
  } else {
    for (const a of actions) {
      lines.push(`### ${a.cn_name}（${a.action_id}）`);
      lines.push(`- 工作量评估：${a.estimated_effort}`);
      lines.push(`- 触发策略：${a.triggered_by.join(" / ")}`);
      lines.push(`- 关键词：${a.keywords.join("、")}`);
      lines.push(`- 建议：${a.reason}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}