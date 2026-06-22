// src/services/keyword_competition/live_pull.ts
// CPS S3 — 双源 LIVE 拉取分流（投流域 + 竞争域）
//
// 思路：直接复用 demand 的 livePullKeywordMetrics + shapeRawByApi，但只对
//   mapping 中 score_domain_hint==="competition" 的接口下发探活，避免误调 demand 域。
// normalize.ts 三阶段会按 aggregation.output_level 自行分流（A 商品→类目，B 投流→关键词）。
//
// 输出：
//   rawByApi          —— 与 fixture 同构（每接口 shape 后的行数组）
//   pull_report       —— 复用 demand 的 PullReport 类型
//   keyword_universe  —— 投流域 raw 的 kw_name 并集（Stage C 用，可被 demand 入参覆盖）
//   shape_report      —— 每接口 shape 状态（落 trace 用）
//
// 详见 docs/20 §7.1 / §7.2。

import {
  livePullKeywordMetrics,
  defaultDateRange as demandDefaultDateRange,
  type DateRange,
  type LivePullResult as DemandLivePullResult,
  type PullReport,
} from "../keyword_demand/live_pull.js";
import { shapeRawByApi, type RawRecord, type ShapeReport } from "../keyword_demand/shape.js";
import type { CategoryContext } from "../keyword_demand/resolve.js";
import type { KeywordFieldMapping } from "./types.js";

export type { DateRange };
export const defaultDateRange = demandDefaultDateRange;

export interface CpsLivePullInput {
  ctx: CategoryContext;
  date_range: DateRange;
  field_mapping: KeywordFieldMapping;
  inter_call_delay_ms?: number;
  top_per_api?: number;
}

export interface CpsLivePullResult {
  raw_by_api: Record<string, RawRecord[]>;
  pull_report: PullReport;
  shape_report: ShapeReport;
  keyword_universe: string[];
  competition_mapping: KeywordFieldMapping;
  probe_results: DemandLivePullResult["probe_results"];
}

/**
 * 把完整 mapping 过滤成 CPS 双源子集（仅 score_domain_hint=competition 的接口）。
 * 保留 merge_order_priority 中的相对顺序，丢弃非 CPS 域接口。
 */
export function pickCompetitionMapping(full: KeywordFieldMapping): KeywordFieldMapping {
  const apis: KeywordFieldMapping["apis"] = {};
  for (const [id, cfg] of Object.entries(full.apis)) {
    if (cfg.score_domain_hint === "competition") {
      apis[id] = cfg;
    }
  }
  const order = (full.merge_order_priority ?? Object.keys(full.apis)).filter((id) => id in apis);
  return {
    ...full,
    apis,
    merge_order_priority: order,
  };
}

export async function livePullCpsMetrics(input: CpsLivePullInput): Promise<CpsLivePullResult> {
  const competitionMapping = pickCompetitionMapping(input.field_mapping);

  const pulled = await livePullKeywordMetrics({
    ctx: input.ctx,
    date_range: input.date_range,
    field_mapping: competitionMapping,
    inter_call_delay_ms: input.inter_call_delay_ms,
    top_per_api: input.top_per_api,
  });

  const shaped = shapeRawByApi(pulled.probe_results);

  const universe = collectPaidKeywordUniverse(shaped.rawByApi, competitionMapping, {
    tertiaryCategory: input.ctx.tertiary_category,
  });

  return {
    raw_by_api: shaped.rawByApi,
    pull_report: pulled.report,
    shape_report: shaped.report,
    keyword_universe: universe,
    competition_mapping: competitionMapping,
    probe_results: pulled.probe_results,
  };
}

/**
 * 从投流域 raw 中抽 kw_name 并集，作为 Stage C 的 fallback 关键词清单。
 * 仅扫 aggregation.output_level === "keyword" 的接口（即关键词级原生粒度）。
 */
export function collectPaidKeywordUniverse(
  rawByApi: Record<string, RawRecord[]>,
  mapping: KeywordFieldMapping,
  options: { tertiaryCategory?: string } = {},
): string[] {
  const set = new Set<string>();
  for (const [apiId, rows] of Object.entries(rawByApi)) {
    const cfg = mapping.apis[apiId];
    const agg = cfg?.aggregation;
    if (!agg || agg.output_level !== "keyword") continue;
    const kwField = agg.keyword_field ?? agg.group_by ?? cfg.keyword_field ?? "kw_name";
    for (const row of rows) {
      if (!isPaidRowInCategory(row, options.tertiaryCategory)) continue;
      const v = row[kwField];
      if (v == null) continue;
      const s = String(v).trim();
      if (s && !isPaidPackageKeyword(s)) set.add(s);
    }
  }
  return Array.from(set);
}

function isPaidPackageKeyword(keyword: string): boolean {
  return /^流量智选[-_]/.test(keyword.trim());
}

function isPaidRowInCategory(row: RawRecord, tertiaryCategory?: string): boolean {
  const expected = tertiaryCategory?.trim();
  if (!expected) return true;
  const categoryCandidates = [row.tertiary_category, row.cate_name, row.category_name]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  if (categoryCandidates.length === 0) return true;
  return categoryCandidates.includes(expected);
}