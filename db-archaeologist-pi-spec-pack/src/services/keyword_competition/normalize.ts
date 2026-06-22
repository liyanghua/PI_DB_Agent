// src/services/keyword_competition/normalize.ts
// CPS 数据归一化与合并 — Phase 3 Batch 2 双源三阶段。
//
// Stage A: 商品级 raw → 类目级聚合（aggregation.output_level=category）
// Stage B: 投流级 raw → 关键词级聚合（aggregation.output_level=keyword）
// Stage C: 关键词记录构造 + 类目广播 + cpc_source 标记
// Stage Z (兼容): 旧 fixture 无 aggregation 块的 api 走 keyword 级原始合并，并入 Stage C
//
// 详见 docs/20 §7.2 / docs/18 §3.2.2。

import type {
  CategoryLevelMetrics,
  CompetitionMetricRecord,
  CpsNormalizeReport,
  KeywordFieldMapping,
  KeywordLevelMetrics,
} from "./types.js";

interface RawByApi {
  [api: string]: Array<Record<string, unknown>>;
}

export interface NormalizeOptions {
  keywordUniverse?: string[];
  tertiaryCategoryHint?: string;
}

const CPS_KEYWORD_FIELD_DEFAULT = "keyword";

const CPS_NUMERIC_FIELDS: Array<keyof CompetitionMetricRecord> = [
  "competition_index",
  "brand_concentration",
  "competitor_count",
  "distinct_shop_count",
  "avg_cpc_cny",
  "weighted_cost_per_clk",
  "market_avg_bid",
  "ad_keyword_ratio",
];

const CPS_TEXT_FIELDS: Array<keyof CompetitionMetricRecord> = [
  "category_id",
  "tertiary_category",
  "business_date",
];

/**
 * Phase 3 Batch 2 双源 normalize 入口。
 * - rawByApi：每个 api 的原始行（商品级 / 投流级 / 旧 keyword 级混在一起）
 * - mapping：用 aggregation 块给 Stage A/B 解释聚合规则
 * - options.keywordUniverse：外部传入的待评分关键词清单（demand pack 输出）
 * - options.tertiaryCategoryHint：当前 run 的三级类目（用于 Stage C 类目广播）
 */
export function normalizeCompetitionMetrics(
  rawByApi: RawByApi,
  mapping?: KeywordFieldMapping,
  options: NormalizeOptions = {},
): {
  records: CompetitionMetricRecord[];
  report: CpsNormalizeReport;
  category_metrics: Record<string, CategoryLevelMetrics>;
  keyword_metrics: Record<string, KeywordLevelMetrics>;
} {
  const apiNames = Object.keys(rawByApi).filter(
    (k) => Array.isArray(rawByApi[k]) && rawByApi[k].length > 0,
  );

  const sourceCoverage: Record<string, string> = {};
  for (const apiName of apiNames) {
    sourceCoverage[apiName] = `${rawByApi[apiName].length}/${rawByApi[apiName].length}`;
  }

  const categoryMetrics: Record<string, CategoryLevelMetrics> = {};
  const keywordMetrics: Record<string, KeywordLevelMetrics> = {};

  // Stage A + Stage B：扫过所有有 aggregation 块的 api
  for (const apiName of apiNames) {
    const apiCfg = mapping?.apis?.[apiName];
    const agg = apiCfg?.aggregation;
    if (!agg || !agg.output_level) continue;
    const rows = rawByApi[apiName];
    if (agg.output_level === "category") {
      runCategoryAggregation(apiName, agg, rows, categoryMetrics);
    } else if (agg.output_level === "keyword") {
      runKeywordAggregation(apiName, agg, rows, keywordMetrics);
    }
  }

  // Stage Z（兼容）：无 aggregation 块的 api 走旧 keyword 级合并
  const legacyKwMap = new Map<string, Partial<CompetitionMetricRecord>>();
  const mergeTrace: Array<{ keyword: string; field: string; winner: string; all: string[] }> = [];

  const priorityIndex = (api: string): number => {
    const idx = mapping?.merge_order_priority?.indexOf(api) ?? -1;
    return idx >= 0 ? idx : 999;
  };

  for (const apiName of apiNames) {
    const apiCfg = mapping?.apis?.[apiName];
    if (apiCfg?.aggregation?.output_level) continue;
    const records = rawByApi[apiName];
    const keywordField = apiCfg?.keyword_field ?? CPS_KEYWORD_FIELD_DEFAULT;
    const fieldMap = apiCfg?.field_map ?? {};

    for (const raw of records) {
      const keyword = String(raw[keywordField] ?? raw.keyword ?? "").trim();
      if (!keyword) continue;
      if (!legacyKwMap.has(keyword)) legacyKwMap.set(keyword, { keyword, source: [] });
      const merged = legacyKwMap.get(keyword)!;
      if (!merged.source!.includes(apiName)) merged.source!.push(apiName);

      for (const target of CPS_NUMERIC_FIELDS) {
        const sourceField = fieldMap[target as string] ?? (target as string);
        const v = raw[sourceField];
        if (v == null) continue;
        const num = typeof v === "number" ? v : parseFloat(String(v));
        if (!Number.isFinite(num)) continue;

        const existing = (merged as Record<string, unknown>)[target];
        if (existing == null) {
          (merged as Record<string, unknown>)[target] = num;
          mergeTrace.push({ keyword, field: target as string, winner: apiName, all: [apiName] });
        } else {
          const cur = priorityIndex(apiName);
          const trace = mergeTrace.find((t) => t.keyword === keyword && t.field === target);
          const prev = trace ? priorityIndex(trace.winner) : 999;
          if (cur < prev) {
            (merged as Record<string, unknown>)[target] = num;
            if (trace) {
              trace.winner = apiName;
              if (!trace.all.includes(apiName)) trace.all.push(apiName);
            }
          } else if (trace && !trace.all.includes(apiName)) {
            trace.all.push(apiName);
          }
        }
      }

      for (const target of CPS_TEXT_FIELDS) {
        if ((merged as Record<string, unknown>)[target] != null) continue;
        const sourceField = fieldMap[target as string] ?? (target as string);
        const v = raw[sourceField];
        if (v != null && String(v).trim() !== "") {
          (merged as Record<string, unknown>)[target] = String(v);
        }
      }
    }
  }

  // Stage C：构造关键词记录 + 广播 + cpc_source 标记
  const universe = new Set<string>();
  for (const k of options.keywordUniverse ?? []) {
    if (k && k.trim()) universe.add(k.trim());
  }
  for (const k of Object.keys(keywordMetrics)) universe.add(k);
  for (const k of legacyKwMap.keys()) universe.add(k);

  const records: CompetitionMetricRecord[] = [];

  for (const keyword of universe) {
    const legacy = legacyKwMap.get(keyword) as CompetitionMetricRecord | undefined;
    const kwAgg = keywordMetrics[keyword];

    const tertiary =
      legacy?.tertiary_category ??
      options.tertiaryCategoryHint ??
      Object.keys(categoryMetrics)[0];

    const catAgg = tertiary ? categoryMetrics[tertiary] : undefined;

    const sourceList: string[] = [];
    for (const s of legacy?.source ?? []) sourceList.push(s);
    if (kwAgg && !sourceList.includes(kwAgg.source_api)) sourceList.push(kwAgg.source_api);
    if (catAgg && !sourceList.includes(catAgg.source_api)) sourceList.push(catAgg.source_api);

    let cpcSource: CompetitionMetricRecord["cpc_source"];
    if (kwAgg && typeof kwAgg.avg_cpc_cny === "number") {
      cpcSource = "paid";
    } else if (legacy && typeof legacy.avg_cpc_cny === "number") {
      cpcSource = "fallback";
    } else {
      cpcSource = "missing";
    }

    const record: CompetitionMetricRecord = {
      keyword,
      tertiary_category: tertiary,
      category_id: legacy?.category_id,
      business_date: legacy?.business_date,
      cpc_source: cpcSource,
      source: sourceList,
      field_source_api: {},
    };

    // Stage A 类目广播（覆盖式注入；旧 fixture 字段在没有类目聚合时保留）
    if (catAgg) {
      if (typeof catAgg.distinct_shop_count === "number") {
        record.distinct_shop_count = catAgg.distinct_shop_count;
        record.field_source_api!.distinct_shop_count = catAgg.source_api;
      }
      if (typeof catAgg.competition_index === "number") {
        record.competition_index = catAgg.competition_index;
        record.field_source_api!.competition_index = catAgg.source_api;
        record.field_source_api!.brand_concentration = catAgg.source_api;
      }
      if (typeof catAgg.brand_concentration === "number") {
        record.brand_concentration = catAgg.brand_concentration;
        record.field_source_api!.brand_concentration = catAgg.source_api;
      }
    }

    // Stage Z 兼容字段补位（仅在类目聚合未提供时）
    if (legacy) {
      const legacySrc = legacy.source?.[0];
      if (record.competition_index == null && typeof legacy.competition_index === "number") {
        record.competition_index = legacy.competition_index;
        if (legacySrc) record.field_source_api!.competition_index = legacySrc;
      }
      if (record.brand_concentration == null && typeof legacy.brand_concentration === "number") {
        record.brand_concentration = legacy.brand_concentration;
        if (legacySrc) record.field_source_api!.brand_concentration = legacySrc;
      }
      if (typeof legacy.competitor_count === "number") {
        record.competitor_count = legacy.competitor_count;
        if (legacySrc) record.field_source_api!.competitor_count = legacySrc;
      }
      if (typeof legacy.market_avg_bid === "number") {
        record.market_avg_bid = legacy.market_avg_bid;
        if (legacySrc) record.field_source_api!.market_avg_bid = legacySrc;
      }
      if (typeof legacy.ad_keyword_ratio === "number") {
        record.ad_keyword_ratio = legacy.ad_keyword_ratio;
        if (legacySrc) record.field_source_api!.ad_keyword_ratio = legacySrc;
      }
    }

    // Stage B 投流域 CPC 注入（关键词级原生）
    if (kwAgg) {
      if (typeof kwAgg.avg_cpc_cny === "number") {
        record.avg_cpc_cny = kwAgg.avg_cpc_cny;
        record.field_source_api!.avg_cpc_cny = kwAgg.source_api;
      }
      if (typeof kwAgg.weighted_cost_per_clk === "number") {
        record.weighted_cost_per_clk = kwAgg.weighted_cost_per_clk;
        record.field_source_api!.weighted_cost_per_clk = kwAgg.source_api;
      }
    } else if (legacy && typeof legacy.avg_cpc_cny === "number") {
      record.avg_cpc_cny = legacy.avg_cpc_cny;
      const legacySrc = legacy.source?.[0];
      if (legacySrc) record.field_source_api!.avg_cpc_cny = legacySrc;
    }

    records.push(record);
  }

  const fieldCoverage: Record<string, number> = {};
  for (const f of CPS_NUMERIC_FIELDS) {
    const c = records.filter((r) => (r as Record<string, unknown>)[f] != null).length;
    fieldCoverage[f as string] = records.length > 0 ? c / records.length : 0;
  }

  const mergeWinners = mergeTrace.slice(0, 50).map((t) => ({
    keyword: t.keyword,
    field: t.field,
    winner_source: t.winner,
    all_sources: t.all,
  }));

  return {
    records,
    report: {
      source_coverage: sourceCoverage,
      field_coverage: fieldCoverage,
      merge_winners: mergeWinners,
    },
    category_metrics: categoryMetrics,
    keyword_metrics: keywordMetrics,
  };
}

// ============ Stage A：商品级 → 类目级聚合 ============

function runCategoryAggregation(
  apiName: string,
  agg: NonNullable<KeywordFieldMapping["apis"][string]["aggregation"]>,
  rows: Array<Record<string, unknown>>,
  out: Record<string, CategoryLevelMetrics>,
): void {
  const groupBy = agg.group_by ?? "tertiary_category";
  const buckets = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const key = String(row[groupBy] ?? "").trim();
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(row);
  }

  for (const [tertiary, bucket] of buckets) {
    const metrics: CategoryLevelMetrics = {
      tertiary_category: tertiary,
      source_api: apiName,
      raw_row_count: bucket.length,
    };
    for (const [canonical, derivation] of Object.entries(agg.derivations ?? {})) {
      const v = evaluateFormula(derivation.formula, bucket);
      if (v == null || !Number.isFinite(v)) continue;
      const clipped = derivation.clip ? clamp(v, derivation.clip[0], derivation.clip[1]) : v;
      (metrics as Record<string, unknown>)[canonical] = clipped;
    }
    out[tertiary] = metrics;
  }
}

// ============ Stage B：投流级 → 关键词级聚合 ============

function runKeywordAggregation(
  apiName: string,
  agg: NonNullable<KeywordFieldMapping["apis"][string]["aggregation"]>,
  rows: Array<Record<string, unknown>>,
  out: Record<string, KeywordLevelMetrics>,
): void {
  const kwField = agg.keyword_field ?? agg.group_by ?? "kw_name";
  const buckets = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const key = String(row[kwField] ?? "").trim();
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(row);
  }

  for (const [keyword, bucket] of buckets) {
    const metrics: KeywordLevelMetrics = {
      keyword,
      source_api: apiName,
      raw_row_count: bucket.length,
    };
    for (const [canonical, derivation] of Object.entries(agg.derivations ?? {})) {
      const v = evaluateFormula(derivation.formula, bucket);
      if (v == null || !Number.isFinite(v)) continue;
      const clipped = derivation.clip ? clamp(v, derivation.clip[0], derivation.clip[1]) : v;
      (metrics as Record<string, unknown>)[canonical] = clipped;
    }
    out[keyword] = metrics;
  }
}

// ============ DSL 解释器 ============

/**
 * 受限 DSL 解释器；仅支持 docs/18 §3.2.2 操作集，不允许用户自定义嵌套。
 * 已支持模式：
 *   - distinct_count(field)
 *   - log10(distinct_count(field) + 1) * k
 *   - log10(field + 1) * k
 *   - top_n_share(field, n=N, weighted_by=field)
 *   - weighted_avg(field, weight=field)
 */
function evaluateFormula(formula: string, rows: Array<Record<string, unknown>>): number | null {
  const trimmed = formula.trim();

  // weighted_avg(field, weight=field)
  let m = trimmed.match(/^weighted_avg\(\s*([\w]+)\s*,\s*weight\s*=\s*([\w]+)\s*\)\s*$/);
  if (m) {
    const field = m[1];
    const weightField = m[2];
    let num = 0;
    let den = 0;
    for (const row of rows) {
      const v = numOf(row[field]);
      const w = numOf(row[weightField]);
      if (v == null || w == null) continue;
      num += v * w;
      den += w;
    }
    if (den === 0) return null;
    return num / den;
  }

  // top_n_share(field, n=N, weighted_by=field)  / top_n_share(field, n=N)
  m = trimmed.match(
    /^top_n_share\(\s*([\w]+)\s*,\s*n\s*=\s*(\d+)\s*(?:,\s*weighted_by\s*=\s*([\w]+)\s*)?\)\s*$/,
  );
  if (m) {
    const field = m[1];
    const n = parseInt(m[2], 10);
    const weightField = m[3];
    const weights = new Map<string, number>();
    let total = 0;
    for (const row of rows) {
      const k = String(row[field] ?? "").trim();
      if (!k) continue;
      const w = weightField ? (numOf(row[weightField]) ?? 0) : 1;
      weights.set(k, (weights.get(k) ?? 0) + w);
      total += w;
    }
    if (total === 0) return null;
    const sorted = Array.from(weights.values()).sort((a, b) => b - a);
    const topN = sorted.slice(0, n).reduce((a, b) => a + b, 0);
    return topN / total;
  }

  // log10(distinct_count(field) + c) * k
  m = trimmed.match(
    /^log10\(\s*distinct_count\(\s*([\w]+)\s*\)\s*([+\-])\s*(\d+(?:\.\d+)?)\s*\)\s*\*\s*(\d+(?:\.\d+)?)\s*$/,
  );
  if (m) {
    const field = m[1];
    const sign = m[2] === "-" ? -1 : 1;
    const c = parseFloat(m[3]);
    const k = parseFloat(m[4]);
    const seen = new Set<unknown>();
    for (const row of rows) {
      const v = row[field];
      if (v != null && String(v).trim() !== "") seen.add(String(v));
    }
    const count = seen.size + sign * c;
    if (count <= 0) return null;
    return Math.log10(count) * k;
  }

  // distinct_count(field)
  m = trimmed.match(/^distinct_count\(\s*([\w]+)\s*\)\s*$/);
  if (m) {
    const field = m[1];
    const seen = new Set<unknown>();
    for (const row of rows) {
      const v = row[field];
      if (v != null && String(v).trim() !== "") seen.add(String(v));
    }
    return seen.size;
  }

  // log10(field + c) * k
  m = trimmed.match(
    /^log10\(\s*([\w]+)\s*([+\-])\s*(\d+(?:\.\d+)?)\s*\)\s*\*\s*(\d+(?:\.\d+)?)\s*$/,
  );
  if (m) {
    const field = m[1];
    const sign = m[2] === "-" ? -1 : 1;
    const c = parseFloat(m[3]);
    const k = parseFloat(m[4]);
    let sum = 0;
    let n = 0;
    for (const row of rows) {
      const v = numOf(row[field]);
      if (v == null) continue;
      sum += v;
      n += 1;
    }
    if (n === 0) return null;
    const avg = sum / n;
    const expr = avg + sign * c;
    if (expr <= 0) return null;
    return Math.log10(expr) * k;
  }

  return null;
}

function numOf(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}