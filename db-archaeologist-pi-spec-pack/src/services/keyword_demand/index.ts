// index.ts: 关键词需求分析编排器（§6 执行流 S0~S7）
// 输入：{ category, strategy?, live?, top_n?, ... }
// 输出：{ run_id, run_dir, top_overall, ... } | { error, missing_params }

import { join } from "node:path";
import { readJson, readYaml, ROOT } from "../../lib/io.js";
import type {
  CategoryTaxonomy,
  KdsWeights,
  KeywordFieldMapping,
  KeywordStrategiesConfig,
  KeywordTaxonomy,
  NormalizeReport,
  RankResult,
  RunMeta,
} from "./types.js";
import { resolveCategory } from "./resolve.js";
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
} from "./trace.js";

export interface AnalyzeKeywordDemandInput {
  category: string;
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
  top_overall: unknown[];
  top_by_type: Record<string, unknown[]>;
  summary_path: string;
  report_path: string;
}

export interface AnalyzeKeywordDemandError {
  error: string;
  missing_params?: Record<string, string>;
  details?: string;
}

/**
 * 主编排入口
 */
export async function analyzeKeywordDemand(
  input: AnalyzeKeywordDemandInput,
): Promise<AnalyzeKeywordDemandOutput | AnalyzeKeywordDemandError> {
  const startedAt = new Date().toISOString();
  const stageTimings: Record<string, number> = {};

  // ========== S0: 加载配置 ==========
  const t0 = Date.now();
  const categoryTaxonomy = readYaml<CategoryTaxonomy>(join(ROOT, "registry/category_taxonomy.yaml"));
  const strategiesConfig = readYaml<KeywordStrategiesConfig>(join(ROOT, "registry/keyword_strategies.yaml"));
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

  // ========== S1: resolve_category ==========
  const t1 = Date.now();
  stageTimings.resolve = t1 - t0;

  const resolved = resolveCategory(input.category, categoryTaxonomy);
  if (!resolved) {
    return {
      error: "category_not_resolved",
      missing_params: { category_id: "无法从类目名解析到 category_id，请提供准确类目名或 category_id" },
      details: `输入 "${input.category}" 未命中 category_taxonomy.yaml`,
    };
  }

  // ========== S2: pull (mock or live) ==========
  const t2 = Date.now();
  const live = input.live ?? false;
  let rawByApi: Record<string, Array<Record<string, unknown>>>;

  if (live) {
    return { error: "live_probe_not_implemented", details: "LIVE_PROBE=true 暂未实现，需接入 api_runtime.ts probeApiSample × 6 P0" };
  } else {
    // mock fixture
    const fixturePath = join(ROOT, `fixtures/keyword_demand_mock/category_${resolved.category_name}.json`);
    try {
      const fixture = readJson<{ raw_by_api: Record<string, Array<Record<string, unknown>>> }>(fixturePath);
      rawByApi = fixture.raw_by_api;
    } catch (err) {
      return {
        error: "fixture_not_found",
        details: `mock fixture 路径 ${fixturePath} 不存在或解析失败: ${String(err)}`,
      };
    }
  }

  const t3 = Date.now();
  stageTimings.pull = t3 - t2;

  // ========== S3: normalize ==========
  const { records, report: normalizeReport } = normalizeKeywordMetrics(rawByApi, fieldMapping);
  const t4 = Date.now();
  stageTimings.normalize = t4 - t3;

  if (records.length === 0) {
    return { error: "no_keywords_after_normalize", details: "归一化后关键词数量为 0" };
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
  const configHash = hashConfig([weightsHash, taxonomyHash, fixtureHash]);

  const runId = buildRunId(strategyName, resolved.category_id, configHash);

  const meta: RunMeta = {
    run_id: runId,
    strategy: strategyName,
    version: "1.0",
    config_hash: configHash,
    weights_hash: weightsHash,
    taxonomy_hash: taxonomyHash,
    fixture_hash: live ? undefined : fixtureHash,
    category: resolved.category_name,
    category_id: resolved.category_id,
    started_at: startedAt,
    live_probe: live,
  };

  const runDir = initRun(meta);

  // ========== 写入 trace 产物 ==========
  writeRunInput(runDir, input);
  writeNormalizeReport(runDir, normalizeReport);
  writeClassifyTrace(runDir, classifications);
  writeScoreTrace(runDir, scoreTraceLines);
  writeKeywordScores(runDir, scored);
  writeCategoryTopKeywords(runDir, rank);

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

  // ========== finalize meta ==========
  meta.ended_at = new Date().toISOString();
  meta.elapsed_ms = t8 - t0;
  meta.stage_timings = stageTimings;
  finalizeRun(runDir, meta);

  return {
    run_id: runId,
    run_dir: runDir,
    category: resolved.category_name,
    category_id: resolved.category_id,
    top_overall: rank.top_overall.slice(0, 10),
    top_by_type: Object.fromEntries(
      Object.entries(rank.top_by_type).map(([k, v]) => [k, v.slice(0, 3)]),
    ),
    summary_path: join(runDir, "run_summary.md"),
    report_path: join(runDir, "keyword_baseline_report.md"),
  };
}