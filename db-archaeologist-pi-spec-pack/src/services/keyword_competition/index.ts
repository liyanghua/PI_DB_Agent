// src/services/keyword_competition/index.ts
// CPS capability 编排器（§7 8-stage S0~S7）。
// Phase 3 Batch 2：双源 LIVE 路径接通（投流域 + 竞争域）+ 三阶段 normalize 广播。

import { join } from "node:path";
import { readJson, readYaml, ROOT } from "../../lib/io.js";
import type {
  CategoryTaxonomy,
  CpsRunMeta,
  CpsWeights,
  KeywordAnalysisPacksConfig,
  KeywordFieldMapping,
  KeywordStrategiesConfig,
  PullReportSummary,
  ResolutionInfo,
} from "./types.js";
import { resolveCategoryContextForCps, resolveKeywordUniverse, type CategoryContext } from "./resolve.js";
import {
  livePullCpsMetrics,
  defaultDateRange,
  type DateRange,
} from "./live_pull.js";
import { normalizeCompetitionMetrics } from "./normalize.js";
import { scoreCpsRecords } from "./score.js";
import { rankCpsScored } from "./rank.js";
import { buildCpsBusinessReport, buildCpsRunSummary, type BuildCpsReportInput } from "./report.js";
import {
  buildCpsRunId,
  finalizeCpsRun,
  hashCpsConfig,
  initCpsRun,
  writeCpsCategoryMetrics,
  writeCpsKeywordCpc,
  writeCpsLiveProbeResults,
  writeCpsNormalizeReport,
  writeCpsPullReport,
  writeCpsRunInput,
  writeCpsRunSummary,
  writeCpsReportMd,
  writeCpsScoreTrace,
  writeCpsScores,
  writeCpsTop,
} from "./trace.js";

export interface AnalyzeKeywordCompetitionInput {
  category: string;
  category_id?: string;
  strategy?: string;
  live?: boolean;
  top_n?: number;
  per_bucket_top?: number;
  date_range?: { start_date: string; end_date: string };
  demand_keywords?: string[];
  seed_keywords?: string[];
}

export interface AnalyzeKeywordCompetitionOutput {
  run_id: string;
  run_dir: string;
  category: string;
  category_id: string;
  resolution: ResolutionInfo["kind"];
  cps_records_count: number;
  top_overall: unknown[];
  top_by_bucket: Record<string, unknown[]>;
  summary_path: string;
  report_path: string;
  pull_report?: PullReportSummary;
  keyword_universe_source?: string;
}

export interface AnalyzeKeywordCompetitionError {
  error: string;
  details?: string;
  missing_params?: Record<string, string>;
  pull_report?: PullReportSummary;
}

const DEFAULT_STRATEGY = "cps_baseline_v1";

export async function analyzeKeywordCompetition(
  input: AnalyzeKeywordCompetitionInput,
): Promise<AnalyzeKeywordCompetitionOutput | AnalyzeKeywordCompetitionError> {
  const startedAt = new Date().toISOString();
  const stageTimings: Record<string, number> = {};

  // ========== S0: 加载配置 ==========
  const t0 = Date.now();
  const categoryTaxonomy = readYaml<CategoryTaxonomy>(join(ROOT, "registry/category_taxonomy.yaml"));
  const strategiesConfig = readYaml<KeywordStrategiesConfig>(join(ROOT, "registry/keyword_strategies.yaml"));
  const packsConfig = readJson<KeywordAnalysisPacksConfig>(join(ROOT, "registry/keyword_analysis_packs.json"));
  const fieldMapping = readYaml<KeywordFieldMapping>(join(ROOT, "registry/keyword_field_mapping.yaml"));

  const strategyName = input.strategy ?? DEFAULT_STRATEGY;
  const strategyDef = strategiesConfig.strategies[strategyName];
  if (!strategyDef) {
    return { error: "strategy_not_found", details: `策略 ${strategyName} 未在 keyword_strategies.yaml 注册` };
  }
  if (!strategyDef.enabled) {
    return { error: "strategy_disabled", details: `策略 ${strategyName} 当前 enabled=false` };
  }
  const weightsPath = (strategyDef as { weights_ref?: string }).weights_ref;
  if (!weightsPath) {
    return { error: "strategy_misconfigured", details: `策略 ${strategyName} 缺 weights_ref` };
  }
  const weights = readYaml<CpsWeights>(join(ROOT, weightsPath));
  const packDef = packsConfig.packs[packsConfig.default_pack_id];

  const t1 = Date.now();
  stageTimings.load_config = t1 - t0;

  // ========== S1: resolve_category ==========
  const live = input.live ?? false;
  const requestedCategory = input.category.trim();
  const resolved = await resolveCategoryContextForCps({
    category_name: input.category,
    category_id: input.category_id,
    live,
    taxonomy: categoryTaxonomy,
    field_mapping: fieldMapping,
  });
  if (!resolved.ok) {
    return {
      error: resolved.error,
      missing_params: { category_id: "无法从类目名解析到 category_id" },
      details: resolved.details,
    };
  }
  const ctx: CategoryContext = resolved.ctx;
  const t2 = Date.now();
  stageTimings.resolve = t2 - t1;

  // ========== S2: pull（双源 LIVE 或 fixture） ==========
  const dateRange: DateRange = input.date_range ?? defaultDateRange();
  let rawByApi: Record<string, Array<Record<string, unknown>>>;
  let pullReportSummary: PullReportSummary | undefined;
  let fixtureUniverse: string[] = [];
  let liveProbeBundle: unknown;

  if (live) {
    const pulled = await livePullCpsMetrics({
      ctx,
      date_range: dateRange,
      field_mapping: fieldMapping,
    });
    rawByApi = pulled.raw_by_api;
    liveProbeBundle = {
      probe_results: pulled.probe_results,
      pull_report: pulled.pull_report,
      shape_report: pulled.shape_report,
    };
    pullReportSummary = {
      date_range: dateRange,
      per_api: Object.fromEntries(
        Object.entries(pulled.pull_report.per_api).map(([k, v]) => [
          k,
          {
            status: v.status,
            total: v.total,
            http: v.http,
            note: v.note,
            error: v.error,
            elapsed_ms: v.elapsed_ms,
            hint: v.hint,
            code: v.code,
            msg: v.msg,
            data_kind: v.data_kind,
            top_keys: v.top_keys,
            data_keys: v.data_keys,
          },
        ]),
      ),
      effective_apis: pulled.pull_report.effective_apis,
      total_keywords: pulled.pull_report.total_keywords,
      shape: pulled.shape_report.per_api,
    };
  } else {
    const fixturePath = join(ROOT, `fixtures/keyword_competition_mock/category_${ctx.category_name}.json`);
    try {
      const fx = readJson<{
        raw_by_api: Record<string, Array<Record<string, unknown>>>;
        keyword_universe?: string[];
      }>(fixturePath);
      rawByApi = fx.raw_by_api;
      fixtureUniverse = Array.isArray(fx.keyword_universe) ? fx.keyword_universe : [];
    } catch (err) {
      return {
        error: "fixture_not_found",
        details: `mock fixture 路径 ${fixturePath} 不存在: ${String((err as Error)?.message ?? err)}`,
      };
    }
  }
  const t3 = Date.now();
  stageTimings.pull = t3 - t2;

  // ========== S2.5: 关键词清单解析（demand pack ∪ 投流域 kw_name ∪ fixture ∪ seed） ==========
  const universe = resolveKeywordUniverse({
    paid_raw_by_api: rawByApi,
    competition_mapping: fieldMapping,
    demand_keywords: input.demand_keywords,
    seed_keywords: input.seed_keywords,
    fixture_universe: fixtureUniverse,
    tertiary_category: ctx.tertiary_category,
  });

  // ========== S3: normalize（三阶段 A/B/C + 类目广播） ==========
  const { records, report: normalizeReport, category_metrics, keyword_metrics } =
    normalizeCompetitionMetrics(rawByApi, fieldMapping, {
      keywordUniverse: universe.universe,
      tertiaryCategoryHint: ctx.tertiary_category,
    });
  const t4 = Date.now();
  stageTimings.normalize = t4 - t3;

  if (records.length === 0) {
    return {
      error: "no_keywords_after_normalize",
      details: "归一化后关键词数量为 0",
      pull_report: pullReportSummary,
    };
  }

  // ========== S4: classify（CPS 由 score 阶段直接出 bucket，本阶段空跑） ==========
  // CPS bucket 在 rank 阶段按 weights.cps_levels 分档，本阶段保留位以对齐 8-stage 结构。

  // ========== S5: score ==========
  const { scored, trace_lines: scoreTrace, warning } = scoreCpsRecords(records, weights, strategyName);
  const t6 = Date.now();
  stageTimings.score = t6 - t4;

  // ========== S6: rank ==========
  const rank = rankCpsScored(scored, weights, {
    top_n: input.top_n ?? 20,
    per_bucket_top: input.per_bucket_top ?? 10,
  });
  const t7 = Date.now();
  stageTimings.rank = t7 - t6;

  // ========== S0b: build run_id & meta ==========
  const fixtureHash = hashCpsConfig([rawByApi]);
  const weightsHash = hashCpsConfig([weights]);
  const configHash = hashCpsConfig([
    weightsHash,
    fixtureHash,
    ctx.category_id ?? "no_cat_id",
    input.date_range,
    requestedCategory,
    ctx.category_name,
    strategyName,
  ]);
  const effectiveCategoryId = ctx.category_id ?? "partial";
  const runId = buildCpsRunId(strategyName, effectiveCategoryId, configHash);

  const resolutionInfo: ResolutionInfo = {
    kind: ctx.resolution,
    matched_category_id: ctx.category_id,
    matched_category_name: ctx.category_name,
    mock_fixture_fallback: ctx.mock_fixture_fallback,
    auto_resolve: ctx.auto_resolve_trace
      ? {
          api_id: ctx.auto_resolve_trace.api_id,
          status: ctx.auto_resolve_trace.status,
          total_returned: ctx.auto_resolve_trace.total_returned,
          elapsed_ms: ctx.auto_resolve_trace.elapsed_ms,
          candidates: ctx.auto_resolve_trace.candidates,
          reason: ctx.auto_resolve_trace.reason,
        }
      : undefined,
  };

  const meta: CpsRunMeta = {
    run_id: runId,
    strategy: strategyName,
    capability: "keyword_competition",
    analysis_pack_id: packDef?.pack_id,
    analysis_pack_name: packDef?.cn_name,
    requested_category: requestedCategory,
    analysis_category: ctx.category_name,
    version: "1.0",
    config_hash: configHash,
    weights_hash: weightsHash,
    fixture_hash: live ? undefined : fixtureHash,
    category: ctx.category_name,
    category_id: effectiveCategoryId,
    started_at: startedAt,
    live_probe: live,
    date_range: dateRange,
    resolution: resolutionInfo,
    pull_report: pullReportSummary,
  };
  const runDir = initCpsRun(meta);
  writeCpsRunInput(runDir, { ...input, keyword_universe: universe });
  writeCpsNormalizeReport(runDir, normalizeReport);
  writeCpsCategoryMetrics(runDir, category_metrics);
  writeCpsKeywordCpc(runDir, keyword_metrics);
  if (pullReportSummary) writeCpsPullReport(runDir, pullReportSummary);
  if (liveProbeBundle) writeCpsLiveProbeResults(runDir, liveProbeBundle);
  writeCpsScoreTrace(runDir, warning ? [...scoreTrace, { warning }] : scoreTrace);
  writeCpsScores(runDir, scored);
  writeCpsTop(runDir, rank);

  // ========== S7: report ==========
  const reportInput: BuildCpsReportInput = { meta, rank, scored, normalize_report: normalizeReport };
  writeCpsReportMd(runDir, buildCpsBusinessReport(reportInput));
  writeCpsRunSummary(runDir, buildCpsRunSummary(reportInput));
  const t8 = Date.now();
  stageTimings.report = t8 - t7;

  meta.ended_at = new Date().toISOString();
  meta.elapsed_ms = t8 - t0;
  meta.stage_timings = stageTimings;
  finalizeCpsRun(runDir, meta);

  return {
    run_id: runId,
    run_dir: runDir,
    category: ctx.category_name,
    category_id: effectiveCategoryId,
    resolution: ctx.resolution,
    cps_records_count: scored.length,
    top_overall: rank.top_overall.slice(0, 10),
    top_by_bucket: Object.fromEntries(
      Object.entries(rank.top_by_bucket).map(([k, v]) => [k, v.slice(0, 5)]),
    ),
    summary_path: join(runDir, "run_summary.md"),
    report_path: join(runDir, "cps_report.md"),
    pull_report: pullReportSummary,
    keyword_universe_source: universe.source,
  };
}

// 兼容导出（其他模块/工具用）
export { listCpsRuns, getCpsRunMeta, getCpsRunSummary, getCpsRunFile, CPS_RUNS_ROOT_PATH } from "./trace.js";