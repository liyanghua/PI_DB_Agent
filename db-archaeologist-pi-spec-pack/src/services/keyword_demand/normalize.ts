// normalize.ts: 多源关键词数据归一化与合并（§S3）
// 输入：rawByApi（6 个 API 原始响应）+ mapping（字段映射表）
// 输出：KeywordMetricRecord[] + NormalizeReport（字段覆盖率、降级触发、merge 决胜）

import type { KeywordMetricRecord, KeywordFieldMapping, NormalizeReport } from "./types.js";

interface RawRecord {
  [key: string]: unknown;
}

interface RawByApi {
  [apiName: string]: RawRecord[];
}

/**
 * 归一化与合并。按 keyword 分组，优先级高的 API 字段优先采纳。
 */
export function normalizeKeywordMetrics(
  rawByApi: RawByApi,
  mapping: KeywordFieldMapping,
): { records: KeywordMetricRecord[]; report: NormalizeReport } {
  const apiNames = Object.keys(rawByApi).filter((k) => Array.isArray(rawByApi[k]) && rawByApi[k].length > 0);
  
  // 按 keyword 合并
  const kwMap = new Map<string, Partial<KeywordMetricRecord>>();
  const mergeTrace: Array<{ keyword: string; field: string; winner: string; all: string[] }> = [];
  const sourceCoverage: Record<string, string> = {};

  for (const apiName of apiNames) {
    const apiConfig = mapping.apis[apiName];
    if (!apiConfig) continue;

    const records = rawByApi[apiName];
    sourceCoverage[apiName] = `${records.length}/${records.length}`;

    for (const raw of records) {
      const keyword = String(raw[apiConfig.keyword_field] || "").trim();
      if (!keyword) continue;

      if (!kwMap.has(keyword)) {
        kwMap.set(keyword, { keyword, source: [] });
      }

      const merged = kwMap.get(keyword)!;
      if (!merged.source!.includes(apiName)) {
        merged.source!.push(apiName);
      }

      // 按 field_map 映射字段
      for (const [targetField, sourceField] of Object.entries(apiConfig.field_map || {})) {
        const rawValue = raw[sourceField];
        if (rawValue == null) continue;

        // 转数字（如果可能）
        let normalizedValue: number | string | undefined;
        if (typeof rawValue === "number") {
          normalizedValue = rawValue;
        } else if (typeof rawValue === "string") {
          const parsed = parseFloat(rawValue);
          normalizedValue = isNaN(parsed) ? rawValue : parsed;
        } else {
          normalizedValue = rawValue as number | string;
        }

        // 合并策略：如果目标字段已存在，比较 priority；不存在则直接写入
        const existing = (merged as Record<string, unknown>)[targetField];
        if (existing == null) {
          (merged as Record<string, unknown>)[targetField] = normalizedValue;
          mergeTrace.push({ keyword, field: targetField, winner: apiName, all: [apiName] });
        } else {
          // 已有值，看 priority（按 mapping.merge_order_priority 顺序，越靠前 priority 越高）
          const currentPriority = mapping.merge_order_priority?.indexOf(apiName) ?? 999;
          const existingSource = mergeTrace.find((t) => t.keyword === keyword && t.field === targetField);
          const existingPriority = existingSource
            ? mapping.merge_order_priority?.indexOf(existingSource.winner) ?? 999
            : 999;

          if (currentPriority < existingPriority) {
            (merged as Record<string, unknown>)[targetField] = normalizedValue;
            if (existingSource) {
              existingSource.winner = apiName;
              if (!existingSource.all.includes(apiName)) existingSource.all.push(apiName);
            }
          } else if (existingSource && !existingSource.all.includes(apiName)) {
            existingSource.all.push(apiName);
          }
        }
      }

      // 拷贝元字段（category_id / tertiary_category / statist_date / business_date）
      if (raw.category_id && !merged.category_id) merged.category_id = String(raw.category_id);
      if (raw.tertiary_category && !merged.tertiary_category) merged.tertiary_category = String(raw.tertiary_category);
      if (raw.statist_date && !merged.statist_date) merged.statist_date = String(raw.statist_date);
      if (raw.business_date && !merged.business_date) merged.business_date = String(raw.business_date);
    }
  }

  const records = Array.from(kwMap.values()) as KeywordMetricRecord[];

  // 统计字段覆盖率（每个 metric 字段在多少关键词中非空）
  const metricKeys = mapping.keyword_metric_record_keys?.metrics || [];
  const fieldCoverage: Record<string, number> = {};
  for (const field of metricKeys) {
    const count = records.filter((r) => (r as Record<string, unknown>)[field] != null).length;
    fieldCoverage[field] = records.length > 0 ? count / records.length : 0;
  }

  // sample merge_winners（取前 50）
  const mergeWinners = mergeTrace.slice(0, 50).map((t) => ({
    keyword: t.keyword,
    field: t.field,
    winner_source: t.winner,
    all_sources: t.all,
  }));

  const report: NormalizeReport = {
    source_coverage: sourceCoverage,
    field_coverage: fieldCoverage,
    merge_winners: mergeWinners,
    degradations: [], // 降级触发在 score 阶段标记
  };

  return { records, report };
}