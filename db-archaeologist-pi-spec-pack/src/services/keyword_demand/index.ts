// index.ts: 关键词需求分析编排器（§6 执行流 S0~S7）
// 输入：{ category, category_id?, strategy?, live?, date_range?, top_n?, ... }
// 输出：{ run_id, run_dir, top_overall, ... } | { error, missing_params }

import { join } from "node:path";
import { readJson, readYaml, ROOT, writeJson } from "../../lib/io.js";
import type {
  CategoryTaxonomy,
  KeywordAnalysisPacksConfig,
  KdsWeights,
  KeywordFieldMapping,
  KeywordSourceAudit,
  KeywordStrategiesConfig,
  KeywordTaxonomy,
  PullReportSummary,
  ResolutionInfo,
  RunMeta,
} from "./types.js";
import { resolveCategoryV2, type CategoryContext } from "./resolve.js";
import { livePullKeywordMetrics, defaultDateRange, type DateRange, type PullReport } from "./live_pull.js";
import { shapeRawByApi } from "./shape.js";
import { buildSourceAudit } from "./source_audit.js";
import { normalizeKeywordMetrics } from "./normalize.js";
import { classifyKeywords } from "./classify.js";
import { scoreRecords } from "./score.js";
import { rankScored, type RankOptions } from "./rank.js";
import { buildBusinessReport, buildRunSummary, type BuildReportInput } from "./report.js";
import {
  buildRunId,
  finalizeRun,
  hashConfig,
  initRun,
  writeClassifyTrace,
  writeCategoryTopKeywords,
  writeKeywordScores,
  writeNormalizeReport,
  writeReportMd,
  writeRunInput,
  writeRunSummary,
  writeScoreTrace,
  writeDiagnosticOnly,
  type DiagnosticBundle,
} from "./trace.js";

export interface AnalyzeKeywordDemandInput {
  category: string;
  category_id?: string;
  strategy?: string;
  live?: boolean;
  top_n?: number;
  per_demand_type_top?: number;
  date_range?: { start_date: string; end_date: string };
}

export interface AnalyzeKeywordDemandOutput {
  run_id: string;
  run_dir: string;
  category: string;
  category_id: string;
  resolution: ResolutionInfo["kind"];
  top_overall: unknown[];
  top_by_type: Record<string, unknown[]>;
  top_by_blue_ocean?: unknown[];
  summary_path: string;
  report_path: string;
  pull_report?: PullReportSummary;
  source_audit?: KeywordSourceAudit;
}

export interface AnalyzeKeywordDemandError {
  error: string;
  missing_params?: Record<string, string>;
  details?: string;
  pull_report?: PullReportSummary;
  source_audit?: KeywordSourceAudit;
  diagnostic_dir?: string;
  diagnostic_run_id?: string;
}

export async function analyzeKeywordDemand(
  input: AnalyzeKeywordDemandInput,
): Promise<AnalyzeKeywordDemandOutput | AnalyzeKeywordDemandError> {
  const startedAt = new Date().toISOString();
  const stageTimings: Record<string, number> = {};

  // ========== S0: 加载配置 ==========
  const t0 = Date.now();
  const categoryTaxonomy = readYaml<CategoryTaxonomy>(join(ROOT, "registry/category_taxonomy.yaml"));
  const strategiesConfig = readYaml<KeywordStrategiesConfig>(join(ROOT, "registry/keyword_strategies.yaml"));
  const packsConfig = readJson<KeywordAnalysisPacksConfig>(join(ROOT, "registry/keyword_analysis_packs.json"));
  const fieldMapping = readYaml<KeywordFieldMapping>(join(ROOT, "registry/keyword_field_mapping.yaml"));

  const strategyName = input.strategy ?? strategiesConfig.default_strategy ?? "baseline_v1";
  const strategyDef = strategiesConfig.strategies[strategyName];
  if (!strategyDef) {
    return { error: "strategy_not_found", details: `策略 ${strategyName} 未在 keyword_strategies.yaml 注册` };
  }
  if (!strategyDef.enabled) {
    return { error: "strategy_disabled", details: `策略 ${strategyName} 当前 enabled=false，不可用` };
  }

  const weights = readYaml<KdsWeights>(join(ROOT, strategyDef.weights_ref));
  const taxonomy = readYaml<KeywordTaxonomy>(join(ROOT, strategyDef.taxonomy_ref));
  const packId = strategyDef.pack_id ?? packsConfig.default_pack_id;
  const packDef = packsConfig.packs[packId] ?? packsConfig.packs[packsConfig.default_pack_id];
  if (!packDef) {
    return { error: "pack_not_found", details: `策略包 ${packId} 未在 keyword_analysis_packs.json 注册` };
  }

  // ========== S1: resolve_category ==========
  const t1 = Date.now();
  stageTimings.load_config = t1 - t0;

  const live = input.live ?? false;
  const requestedCategory = input.category.trim();

  const resolved = await resolveCategoryV2({
    category_name: input.category,
    category_id: input.category_id,
    live,
    taxonomy: categoryTaxonomy,
    field_mapping: fieldMapping,
  });
  if (!resolved.ok) {
    return {
      error: resolved.error,
      missing_params: { category_id: "无法从类目名解析到 category_id，请提供准确类目名或 category_id" },
      details: resolved.details,
    };
  }
  const ctx: CategoryContext = resolved.ctx;
  const t2 = Date.now();
  stageTimings.resolve = t2 - t1;

  // ========== S2: pull (mock or live) ==========
  let rawByApi: Record<string, Array<Record<string, unknown>>>;
  let pullReportSummary: PullReportSummary | undefined;
  let sourceAudit: KeywordSourceAudit | undefined;
  let liveProbeBundle: { probe_results: Record<string, unknown>; pull: PullReport; shape: Record<string, unknown> } | undefined;
  const dateRange: DateRange = input.date_range ?? defaultDateRange();

  if (live) {
    const pulled = await livePullKeywordMetrics({
      ctx,
      date_range: dateRange,
      field_mapping: fieldMapping,
    });
    const shaped = shapeRawByApi(pulled.probe_results);
    rawByApi = shaped.rawByApi;
    pullReportSummary = {
      date_range: dateRange,
      per_api: Object.fromEntries(
        Object.entries(pulled.report.per_api).map(([k, v]) => [k, {
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
        }]),
      ),
      effective_apis: pulled.report.effective_apis,
      total_keywords: pulled.report.total_keywords,
      shape: shaped.report.per_api,
    };
    liveProbeBundle = { probe_results: pulled.probe_results, pull: pulled.report, shape: shaped.report.per_api };
    sourceAudit = buildSourceAudit(pullReportSummary, fieldMapping);

    const totalShapedKw = Object.values(rawByApi).reduce((acc, arr) => acc + arr.length, 0);
    if (totalShapedKw < 5) {
      const diagDetails = `live 模式下 ${pulled.report.effective_apis} 个接口可用，但归并后关键词总数 ${totalShapedKw} < 5。请检查 pull_report.per_api 中各接口状态。`;

      try {
        const diagFixtureHash = "live_failed";
        const diagWeightsHash = hashConfig([weights]);
        const diagTaxonomyHash = hashConfig([taxonomy]);
        const diagConfigHash = hashConfig([
          diagWeightsHash,
          diagTaxonomyHash,
          diagFixtureHash,
          ctx.category_id ?? "no_cat_id",
          dateRange,
        ]);
        const diagRunId = buildRunId(strategyName, ctx.category_id ?? "partial", diagConfigHash);
        const diagMeta: RunMeta = {
          run_id: diagRunId,
          strategy: strategyName,
          analysis_pack_id: packDef.pack_id,
          analysis_pack_name: packDef.cn_name,
          requested_category: requestedCategory,
          analysis_category: ctx.category_name,
          version: "1.0",
          config_hash: diagConfigHash,
          weights_hash: diagWeightsHash,
          taxonomy_hash: diagTaxonomyHash,
          category: ctx.category_name,
          category_id: ctx.category_id ?? "partial",
          started_at: startedAt,
          live_probe: true,
          date_range: dateRange,
          resolution: {
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
          },
          pull_report: pullReportSummary,
          ended_at: new Date().toISOString(),
          diagnostic: {
            kind: "live_no_keyword_data",
            effective_apis: pulled.report.effective_apis,
            total_keywords: totalShapedKw,
            reason: diagDetails,
          },
        };
        const bundle: DiagnosticBundle = {
          meta: diagMeta,
          pull_report: pullReportSummary,
          live_probe_results: liveProbeBundle ?? { probe_results: pulled.probe_results, pull: pulled.report },
          reason: diagDetails,
        };
        const diagDir = writeDiagnosticOnly(diagRunId, bundle);
        return {
          error: "live_no_keyword_data",
          details: diagDetails,
          pull_report: pullReportSummary,
          source_audit: sourceAudit,
          diagnostic_dir: diagDir,
          diagnostic_run_id: diagRunId,
        };
      } catch (err) {
        return {
          error: "live_no_keyword_data",
          details: `${diagDetails}（diagnostic 落盘失败：${String((err as Error)?.message ?? err)}）`,
          pull_report: pullReportSummary,
          source_audit: sourceAudit,
        };
      }
    }
  } else {
    const fixturePath = join(ROOT, `fixtures/keyword_demand_mock/category_${ctx.category_name}.json`);
    try {
      const fixture = readJson<{ raw_by_api: Record<string, Array<Record<string, unknown>>> }>(fixturePath);
      rawByApi = fixture.raw_by_api;
    } catch (err) {
      const fallbackCandidates = categoryTaxonomy.entries
        .map((cat) => {
          const exact = cat.canonical_name === requestedCategory || cat.tertiary_category === requestedCategory;
          const aliasHit = cat.aliases?.some((a) => a === requestedCategory) ?? false;
          const contains = cat.canonical_name.includes(requestedCategory) || requestedCategory.includes(cat.canonical_name);
          const score = exact ? 1 : aliasHit ? 0.95 : contains ? 0.82 : 0.5;
          return {
            category_name: cat.canonical_name,
            category_id: cat.category_id,
            tertiary_category: cat.tertiary_category,
            aliases: cat.aliases,
            score,
            reason: exact ? "exact" : aliasHit ? "alias" : contains ? "contains" : "taxonomy_seed",
          };
        })
        .sort((a, b) => b.score - a.score);
      const selected = fallbackCandidates[0];
      if (!selected) {
        return {
          error: "fixture_not_found",
          details: `mock fixture 路径 ${fixturePath} 不存在，且 taxonomy 中没有可回落类目: ${String(err)}`,
        };
      }
      const fallbackFixturePath = join(ROOT, `fixtures/keyword_demand_mock/category_${selected.category_name}.json`);
      try {
        const fixture = readJson<{ raw_by_api: Record<string, Array<Record<string, unknown>>> }>(fallbackFixturePath);
        rawByApi = fixture.raw_by_api;
        ctx.category_id = selected.category_id;
        ctx.category_name = selected.category_name;
        ctx.tertiary_category = selected.tertiary_category;
        ctx.resolution = "mock_fixture_fallback";
        ctx.mock_fixture_fallback = {
          requested_category_name: requestedCategory,
          selected_category_name: selected.category_name,
          selected_category_id: selected.category_id,
          candidates: fallbackCandidates.slice(0, 5),
          reason: `mock fixture 回落到 ${selected.category_name}`,
        };
      } catch (fallbackErr) {
        return {
          error: "fixture_not_found",
          details: `mock fixture 回落路径 ${fallbackFixturePath} 不存在: ${String(fallbackErr)}`,
        };
      }
    }
  }

  const t3 = Date.now();
  stageTimings.pull = t3 - t2;

  // ========== S3: normalize ==========
  const { records, report: normalizeReport } = normalizeKeywordMetrics(rawByApi, fieldMapping);
  const t4 = Date.now();
  stageTimings.normalize = t4 - t3;

  if (records.length === 0) {
    return {
      error: "no_keywords_after_normalize",
      details: "归一化后关键词数量为 0",
      pull_report: pullReportSummary,
      source_audit: sourceAudit,
    };
  }

  // ========== S4: classify ==========
  const classifications = classifyKeywords(records, taxonomy, weights);
  const t5 = Date.now();
  stageTimings.classify = t5 - t4;

  // ========== S5: score ==========
  const { scored, trace_lines: scoreTraceLines } = scoreRecords(records, classifications, weights, strategyName);
  const t6 = Date.now();
  stageTimings.score = t6 - t5;

  // ========== S6: rank ==========
  const rankOpts: RankOptions = {
    top_n: input.top_n ?? 20,
    per_demand_type_top: input.per_demand_type_top ?? 10,
  };
  const rank = rankScored(scored, rankOpts);
  const t7 = Date.now();
  stageTimings.rank = t7 - t6;

  // ========== S0b: build run_id & meta ==========
  const fixtureHash = live ? "live" : hashConfig([rawByApi]);
  const weightsHash = hashConfig([weights]);
  const taxonomyHash = hashConfig([taxonomy]);
  const configHash = hashConfig([
    weightsHash,
    taxonomyHash,
    fixtureHash,
    ctx.category_id ?? "no_cat_id",
    dateRange,
    packDef.pack_id,
    requestedCategory,
    ctx.category_name,
  ]);

  const effectiveCategoryId = ctx.category_id ?? "partial";
  const runId = buildRunId(strategyName, effectiveCategoryId, configHash);

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

  const meta: RunMeta = {
    run_id: runId,
    strategy: strategyName,
    analysis_pack_id: packDef.pack_id,
    analysis_pack_name: packDef.cn_name,
    requested_category: requestedCategory,
    analysis_category: ctx.category_name,
    version: "1.0",
    config_hash: configHash,
    weights_hash: weightsHash,
    taxonomy_hash: taxonomyHash,
    fixture_hash: live ? undefined : fixtureHash,
    category: ctx.category_name,
    category_id: effectiveCategoryId,
    started_at: startedAt,
    live_probe: live,
    date_range: live ? dateRange : undefined,
    resolution: resolutionInfo,
    pull_report: pullReportSummary,
  };

  const runDir = initRun(meta);

  writeRunInput(runDir, input);
  writeNormalizeReport(runDir, normalizeReport);
  writeClassifyTrace(runDir, classifications);
  writeScoreTrace(runDir, scoreTraceLines);
  writeKeywordScores(runDir, scored);
  writeCategoryTopKeywords(runDir, rank);
  if (liveProbeBundle) {
    writeJson(join(runDir, "live_probe_results.json"), liveProbeBundle);
  }

  // ========== S7: report ==========
  const reportInput: BuildReportInput = {
    meta,
    rank,
    scored,
    normalize_report: normalizeReport,
  };
  const businessReport = buildBusinessReport(reportInput);
  const runSummary = buildRunSummary(reportInput);

  writeReportMd(runDir, businessReport);
  writeRunSummary(runDir, runSummary);

  const t8 = Date.now();
  stageTimings.report = t8 - t7;

  meta.ended_at = new Date().toISOString();
  meta.elapsed_ms = t8 - t0;
  meta.stage_timings = stageTimings;
  finalizeRun(runDir, meta);

  return {
    run_id: runId,
    run_dir: runDir,
    category: ctx.category_name,
    category_id: effectiveCategoryId,
    resolution: ctx.resolution,
    top_overall: rank.top_overall.slice(0, 10),
    top_by_type: Object.fromEntries(
      Object.entries(rank.top_by_type).map(([k, v]) => [k, v.slice(0, 3)]),
    ),
    top_by_blue_ocean: rank.top_by_blue_ocean?.slice(0, 10) ?? [],
    summary_path: join(runDir, "run_summary.md"),
    report_path: join(runDir, "keyword_baseline_report.md"),
    pull_report: pullReportSummary,
    source_audit: sourceAudit,
  };
}
