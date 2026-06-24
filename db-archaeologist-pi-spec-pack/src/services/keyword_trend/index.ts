// index.ts: keyword_trend 编排器（S1 resolve → S2 pull → S3 normalize → S4 compute TMS → S5 落盘）
// 复用 keyword_demand 的 resolve / live_pull / shape / normalize，只在 S4 切换到 TMS 计算

import { join } from "node:path";
import { readJson, readYaml, ROOT, writeJson, writeText } from "../../lib/io.js";
import type {
  CategoryTaxonomy,
  KeywordFieldMapping,
} from "../keyword_demand/types.js";
import { resolveCategoryV2 } from "../keyword_demand/resolve.js";
import { livePullKeywordMetrics, type DateRange } from "../keyword_demand/live_pull.js";
import { shapeRawByApi } from "../keyword_demand/shape.js";
import { normalizeKeywordMetrics } from "../keyword_demand/normalize.js";
import type { TmsWeights, TrendResult, TrendRunMeta, TrendRecord } from "./types.js";
import { computeTrendRecord } from "./compute_tms.js";
import { buildTrendRunId, finalizeTrendRun, hashConfig, initTrendRun } from "./trace.js";

export interface AnalyzeKeywordTrendInput {
  category: string;
  category_id?: string;
  live?: boolean;
  date_range?: { start_date: string; end_date: string };
  top_n?: number;
}

export interface AnalyzeKeywordTrendOutput extends TrendResult {
  run_dir: string;
}

export interface AnalyzeKeywordTrendError {
  error: string;
  details?: string;
  pull_report?: unknown;
}

// 最近 3 个完整自然月（见 docs/13 §2.5 / docs/18 §3.4）
// 例：2026-03-15 → 2025-12-01 ~ 2026-02-28
export function defaultTrendDateRange(now: Date = new Date()): DateRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed: 当月
  const startUtc = new Date(Date.UTC(y, m - 3, 1));
  const endUtc = new Date(Date.UTC(y, m, 0));
  return { start_date: ymd(startUtc), end_date: ymd(endUtc) };
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${dd}`;
}

export async function analyzeKeywordTrend(
  input: AnalyzeKeywordTrendInput,
): Promise<AnalyzeKeywordTrendOutput | AnalyzeKeywordTrendError> {
  const startedAt = new Date().toISOString();

  // S0: 加载配置
  const categoryTaxonomy = readYaml<CategoryTaxonomy>(join(ROOT, "registry/category_taxonomy.yaml"));
  const fieldMapping = readYaml<KeywordFieldMapping>(join(ROOT, "registry/business_field_mapping/keyword.yaml"));
  const weights = readYaml<TmsWeights>(join(ROOT, "registry/keyword_trend_weights.yaml"));

  const live = input.live ?? false;
  const requestedCategory = input.category.trim();
  const dateRange: DateRange = input.date_range ?? defaultTrendDateRange();

  // S1: resolve category（复用 keyword_demand）
  const resolved = await resolveCategoryV2({
    category_name: input.category,
    category_id: input.category_id,
    live,
    taxonomy: categoryTaxonomy,
    field_mapping: fieldMapping,
  });
  if (!resolved.ok) {
    return { error: resolved.error, details: resolved.details };
  }
  const ctx = resolved.ctx;

  // S2: pull（live 走真实接口；mock 读 fixtures/keyword_trend_mock，缺失时回落 keyword_demand 同名 fixture）
  let rawByApi: Record<string, Array<Record<string, unknown>>>;
  let pullReport: unknown | undefined;

  if (live) {
    const pulled = await livePullKeywordMetrics({ ctx, date_range: dateRange, field_mapping: fieldMapping });
    const shaped = shapeRawByApi(pulled.probe_results);
    rawByApi = shaped.rawByApi;
    pullReport = {
      date_range: dateRange,
      per_api: Object.fromEntries(Object.entries(pulled.report.per_api).map(([k, v]) => [k, v])),
      effective_apis: pulled.report.effective_apis,
      total_keywords: pulled.report.total_keywords,
    };

    const totalShapedKw = Object.values(rawByApi).reduce((acc, arr) => acc + arr.length, 0);
    if (totalShapedKw < 5) {
      return {
        error: "live_no_keyword_data",
        details: `live 模式下 ${pulled.report.effective_apis} 个接口可用，但归并后关键词总数 ${totalShapedKw} < 5`,
        pull_report: pullReport,
      };
    }
  } else {
    // mock 模式：先试 keyword_trend_mock，回落 keyword_demand_mock
    const trendFixturePath = join(ROOT, `fixtures/keyword_trend_mock/category_${ctx.category_name}.json`);
    const demandFixturePath = join(ROOT, `fixtures/keyword_demand_mock/category_${ctx.category_name}.json`);
    try {
      const fixture = readJson<{ raw_by_api: Record<string, Array<Record<string, unknown>>> }>(trendFixturePath);
      rawByApi = fixture.raw_by_api;
    } catch {
      try {
        const fixture = readJson<{ raw_by_api: Record<string, Array<Record<string, unknown>>> }>(demandFixturePath);
        rawByApi = fixture.raw_by_api;
      } catch (err) {
        return {
          error: "fixture_not_found",
          details: `mock fixture 路径 ${trendFixturePath} 和 ${demandFixturePath} 均不存在: ${String(err)}`,
        };
      }
    }
  }

  // S3: normalize（复用 keyword_demand）
  const { records } = normalizeKeywordMetrics(rawByApi, fieldMapping);
  if (records.length === 0) {
    return { error: "no_keywords_after_normalize", details: "归一化后关键词数量为 0" };
  }

  // S4: compute TMS
  const trendRecords: TrendRecord[] = records.map((r) => computeTrendRecord(r, weights));
  trendRecords.sort((a, b) => b.scores.tms - a.scores.tms);

  const topN = input.top_n ?? 20;
  const top_rising = trendRecords.filter((r) => r.trend_label === "rising").slice(0, topN);
  const top_falling = [...trendRecords]
    .sort((a, b) => a.scores.tms - b.scores.tms)
    .filter((r) => r.trend_label === "falling")
    .slice(0, topN);

  // S5: build run_id & meta
  const weightsHash = hashConfig([weights]);
  const configHash = hashConfig([weightsHash, ctx.category_id ?? "no_cat", dateRange]);
  const runId = buildTrendRunId("tms_v1", ctx.category_id ?? "partial", configHash);

  const meta: TrendRunMeta = {
    run_id: runId,
    capability: "keyword_trend",
    score_domain: "trend",
    koif_aggregatable: true,
    category: ctx.category_name,
    category_id: ctx.category_id ?? "partial",
    requested_category: requestedCategory,
    weights_hash: weightsHash,
    config_hash: configHash,
    started_at: startedAt,
    live_probe: live,
    date_range: live ? dateRange : undefined,
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
    pull_report: pullReport,
    total_keywords: trendRecords.length,
    rising_count: trendRecords.filter((r) => r.trend_label === "rising").length,
    stable_count: trendRecords.filter((r) => r.trend_label === "stable").length,
    falling_count: trendRecords.filter((r) => r.trend_label === "falling").length,
  };

  const runDir = initTrendRun(meta);
  writeJson(join(runDir, "trend_result.json"), { meta, records: trendRecords, top_rising, top_falling });
  writeText(join(runDir, "trend_summary.md"), buildTrendSummary(meta, top_rising, top_falling));
  meta.ended_at = new Date().toISOString();
  finalizeTrendRun(runDir, meta);

  return { meta, records: trendRecords, top_rising, top_falling, run_dir: runDir };
}

function buildTrendSummary(meta: TrendRunMeta, rising: TrendRecord[], falling: TrendRecord[]): string {
  const lines: string[] = [];
  lines.push(`# 关键词趋势分析 · ${meta.category}（${meta.category_id}）`);
  lines.push("");
  lines.push(`run_id: ${meta.run_id}`);
  lines.push(`关键词总数：${meta.total_keywords}（上升 ${meta.rising_count} · 平稳 ${meta.stable_count} · 下降 ${meta.falling_count}）`);
  lines.push("");
  lines.push("## 上升 TOP");
  for (const r of rising.slice(0, 10)) {
    lines.push(`- ${r.keyword} · TMS ${r.scores.tms} · ${r.explanation.rank_reason}`);
  }
  lines.push("");
  lines.push("## 下降 TOP");
  for (const r of falling.slice(0, 5)) {
    lines.push(`- ${r.keyword} · TMS ${r.scores.tms} · ${r.explanation.rank_reason}`);
  }
  return lines.join("\n");
}