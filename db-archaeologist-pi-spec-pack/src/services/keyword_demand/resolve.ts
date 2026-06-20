// resolve.ts: 类目名 → CategoryContext 解析（§S1）
// 版本：v2
//   v1 入口 resolveCategory(input, taxonomy)：保留，仅 taxonomy 查表，纯同步。
//   v2 入口 resolveCategoryV2()：返回 CategoryContext，命不中时按 user_id / auto_resolve / partial 顺序降级。
// auto_resolve 仅在 live=true 且 KD_AUTO_RESOLVE_CATEGORY !== "false" 时启用。

import type { CategoryTaxonomy, KeywordFieldMapping } from "./types.js";
import { autoResolveCategory, type AutoResolveTrace } from "./auto_resolve.js";

export interface ResolveResult {
  category_id: string;
  category_name: string;
  tertiary_category: string;
}

export type ResolutionKind = "taxonomy" | "user_id" | "auto_resolved" | "partial_no_id" | "mock_fixture_fallback";

export interface CategoryContext {
  category_name: string;
  category_id?: string;
  tertiary_category: string;
  resolution: ResolutionKind;
  auto_resolve_trace?: AutoResolveTrace;
  mock_fixture_fallback?: {
    requested_category_name: string;
    selected_category_name: string;
    selected_category_id: string;
    candidates: Array<{
      category_name: string;
      category_id: string;
      tertiary_category: string;
      aliases?: string[];
      score: number;
      reason: string;
    }>;
    reason?: string;
  };
}

export interface ResolveV2Input {
  category_name: string;
  category_id?: string;
  live: boolean;
  taxonomy: CategoryTaxonomy;
  field_mapping: KeywordFieldMapping;
}

export type ResolveV2Result =
  | { ok: true; ctx: CategoryContext }
  | { ok: false; error: "category_not_resolved"; details: string; trace?: AutoResolveTrace };

function buildMockCandidates(input: string, taxonomy: CategoryTaxonomy) {
  const normalized = input.trim().toLowerCase();
  const candidates = taxonomy.entries
    .map((cat) => {
      const aliasHit = cat.aliases?.some((a) => a.toLowerCase().includes(normalized) || normalized.includes(a.toLowerCase())) ?? false;
      const exactHit = cat.canonical_name.toLowerCase() === normalized || cat.tertiary_category.toLowerCase() === normalized;
      const containsHit =
        cat.canonical_name.toLowerCase().includes(normalized) ||
        cat.tertiary_category.toLowerCase().includes(normalized) ||
        normalized.includes(cat.canonical_name.toLowerCase()) ||
        normalized.includes(cat.tertiary_category.toLowerCase());
      const score = exactHit ? 1 : aliasHit ? 0.94 : containsHit ? 0.78 : 0.45;
      const reason = exactHit ? "exact" : aliasHit ? "alias_contains" : containsHit ? "name_contains" : "taxonomy_seed";
      return {
        category_name: cat.canonical_name,
        category_id: cat.category_id,
        tertiary_category: cat.tertiary_category,
        aliases: cat.aliases,
        score,
        reason,
      };
    })
    .sort((a, b) => b.score - a.score);
  return candidates;
}

export function resolveCategory(input: string, taxonomy: CategoryTaxonomy): ResolveResult | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;

  for (const cat of taxonomy.entries) {
    if (cat.canonical_name.toLowerCase() === normalized) {
      return {
        category_id: cat.category_id,
        category_name: cat.canonical_name,
        tertiary_category: cat.tertiary_category,
      };
    }
    if (cat.tertiary_category.toLowerCase() === normalized) {
      return {
        category_id: cat.category_id,
        category_name: cat.canonical_name,
        tertiary_category: cat.tertiary_category,
      };
    }
    if (cat.aliases?.some((a) => a.toLowerCase() === normalized)) {
      return {
        category_id: cat.category_id,
        category_name: cat.canonical_name,
        tertiary_category: cat.tertiary_category,
      };
    }
  }

  return null;
}

export function getCategoryById(categoryId: string, taxonomy: CategoryTaxonomy): ResolveResult | null {
  const cat = taxonomy.entries.find((c) => c.category_id === categoryId);
  if (!cat) return null;
  return {
    category_id: cat.category_id,
    category_name: cat.canonical_name,
    tertiary_category: cat.tertiary_category,
  };
}

export async function resolveCategoryV2(input: ResolveV2Input): Promise<ResolveV2Result> {
  const name = (input.category_name ?? "").trim();
  if (!name) {
    return { ok: false, error: "category_not_resolved", details: "category 入参为空" };
  }

  const taxonomyHit = resolveCategory(name, input.taxonomy);
  if (taxonomyHit) {
    return {
      ok: true,
      ctx: {
        category_name: taxonomyHit.category_name,
        category_id: taxonomyHit.category_id,
        tertiary_category: taxonomyHit.tertiary_category,
        resolution: "taxonomy",
      },
    };
  }

  const userCategoryId = (input.category_id ?? "").trim();
  if (userCategoryId) {
    return {
      ok: true,
      ctx: {
        category_name: name,
        category_id: userCategoryId,
        tertiary_category: name,
        resolution: "user_id",
      },
    };
  }

  if (!input.live) {
    const candidates = buildMockCandidates(name, input.taxonomy);
    const best = candidates[0];
    if (!best) {
      return {
        ok: false,
        error: "category_not_resolved",
        details: `输入 "${name}" 未命中 category_taxonomy.yaml，且 taxonomy 为空，无法给出 mock 回落。`,
      };
    }
    return {
      ok: true,
      ctx: {
        category_name: best.category_name,
        category_id: best.category_id,
        tertiary_category: best.tertiary_category,
        resolution: "mock_fixture_fallback",
        mock_fixture_fallback: {
          requested_category_name: name,
          selected_category_name: best.category_name,
          selected_category_id: best.category_id,
          candidates: candidates.slice(0, 5),
          reason: `fixture 模式下未命中 taxonomy，回落到最相近的已知类目 ${best.category_name}`,
        },
      },
    };
  }

  const autoEnabled = String(process.env.KD_AUTO_RESOLVE_CATEGORY ?? "true").toLowerCase() !== "false";
  if (!autoEnabled) {
    return {
      ok: true,
      ctx: {
        category_name: name,
        tertiary_category: name,
        resolution: "partial_no_id",
      },
    };
  }

  const auto = await autoResolveCategory(name, input.field_mapping);
  if (auto.category_id) {
    return {
      ok: true,
      ctx: {
        category_name: auto.category_name ?? name,
        category_id: auto.category_id,
        tertiary_category: name,
        resolution: "auto_resolved",
        auto_resolve_trace: auto.trace,
      },
    };
  }

  return {
    ok: true,
    ctx: {
      category_name: name,
      tertiary_category: name,
      resolution: "partial_no_id",
      auto_resolve_trace: auto.trace,
    },
  };
}
