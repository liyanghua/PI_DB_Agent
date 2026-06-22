// src/services/keyword_competition/resolve.ts
// CPS S1 — 类目归一 + 关键词清单解析
//
// resolveCategoryContextForCps：薄包装 demand 的 resolveCategoryV2，统一 CPS 域出错语义。
// resolveKeywordUniverse：合并 demand pack 输出的关键词清单（如有）+ 投流域 kw_name 并集 +
//   外部传入的 keyword_seed。三者全空时 universe=[]，由 normalize Stage C 走 cpc_source=missing 路径。
//
// 详见 docs/20 §7.1 关键词清单来源约定。

import { resolveCategoryV2, type CategoryContext } from "../keyword_demand/resolve.js";
import { collectPaidKeywordUniverse } from "./live_pull.js";
import type { KeywordFieldMapping } from "./types.js";

export type { CategoryContext };

export interface ResolveCpsCategoryInput {
  category_name: string;
  category_id?: string;
  live: boolean;
  taxonomy: Parameters<typeof resolveCategoryV2>[0]["taxonomy"];
  field_mapping: KeywordFieldMapping;
}

export type ResolveCpsCategoryResult =
  | { ok: true; ctx: CategoryContext }
  | { ok: false; error: string; details: string };

export async function resolveCategoryContextForCps(
  input: ResolveCpsCategoryInput,
): Promise<ResolveCpsCategoryResult> {
  const r = await resolveCategoryV2({
    category_name: input.category_name,
    category_id: input.category_id,
    live: input.live,
    taxonomy: input.taxonomy,
    field_mapping: input.field_mapping,
  });
  if (!r.ok) return { ok: false, error: r.error, details: r.details };
  return { ok: true, ctx: r.ctx };
}

export interface ResolveKeywordUniverseInput {
  paid_raw_by_api?: Record<string, Array<Record<string, unknown>>>;
  competition_mapping?: KeywordFieldMapping;
  demand_keywords?: string[];
  seed_keywords?: string[];
  fixture_universe?: string[];
  tertiary_category?: string;
}

export interface ResolveKeywordUniverseResult {
  universe: string[];
  source: "demand_pack" | "paid_kw_name" | "fixture" | "seed" | "merged" | "empty";
  trace: {
    demand_count: number;
    paid_count: number;
    fixture_count: number;
    seed_count: number;
    merged_count: number;
  };
}

/**
 * 合并关键词清单：demand_keywords 优先 → 投流域 kw_name 并集 → fixture_universe → seed。
 * 任一来源命中即视为命中；最终去重保序。
 */
export function resolveKeywordUniverse(
  input: ResolveKeywordUniverseInput,
): ResolveKeywordUniverseResult {
  const demand = dedupeNonEmpty(input.demand_keywords ?? []);
  const seed = dedupeNonEmpty(input.seed_keywords ?? []);
  const fixture = dedupeNonEmpty(input.fixture_universe ?? []);
  const paid = input.paid_raw_by_api && input.competition_mapping
    ? collectPaidKeywordUniverse(input.paid_raw_by_api, input.competition_mapping, {
        tertiaryCategory: input.tertiary_category,
      })
    : [];

  if (demand.length > 0) {
    return {
      universe: demand,
      source: "demand_pack",
      trace: {
        demand_count: demand.length,
        paid_count: paid.length,
        fixture_count: fixture.length,
        seed_count: seed.length,
        merged_count: demand.length,
      },
    };
  }

  const merged: string[] = [];
  const seen = new Set<string>();
  const push = (arr: string[]) => {
    for (const k of arr) {
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(k);
    }
  };
  push(demand);
  push(paid);
  push(fixture);
  push(seed);

  let source: ResolveKeywordUniverseResult["source"] = "empty";
  const sources = [
    demand.length > 0 ? "demand_pack" : null,
    paid.length > 0 ? "paid_kw_name" : null,
    fixture.length > 0 ? "fixture" : null,
    seed.length > 0 ? "seed" : null,
  ].filter(Boolean) as string[];
  if (sources.length === 1) source = sources[0] as ResolveKeywordUniverseResult["source"];
  else if (sources.length > 1) source = "merged";

  return {
    universe: merged,
    source,
    trace: {
      demand_count: demand.length,
      paid_count: paid.length,
      fixture_count: fixture.length,
      seed_count: seed.length,
      merged_count: merged.length,
    },
  };
}

function dedupeNonEmpty(arr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const s = (v ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}