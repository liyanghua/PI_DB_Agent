// resolve.ts: S1 — 归一 category，直接复用 keyword_demand.resolveCategoryV2

import { join } from "node:path";
import { readYaml, ROOT } from "../../lib/io.js";
import type { CategoryTaxonomy, KeywordFieldMapping } from "../keyword_demand/types.js";
import { resolveCategoryV2 } from "../keyword_demand/resolve.js";
import type { ResolvedCategory } from "./types.js";

export interface ResolveRouterCategoryInput {
  category: string;
  category_id?: string;
  live: boolean;
}

export type ResolveRouterCategoryResult =
  | { ok: true; ctx: ResolvedCategory }
  | { ok: false; error: string; details?: string };

export async function resolveRouterCategory(
  input: ResolveRouterCategoryInput,
): Promise<ResolveRouterCategoryResult> {
  const taxonomy = readYaml<CategoryTaxonomy>(join(ROOT, "registry/category_taxonomy.yaml"));
  const fieldMapping = readYaml<KeywordFieldMapping>(join(ROOT, "registry/keyword_field_mapping.yaml"));

  const r = await resolveCategoryV2({
    category_name: input.category,
    category_id: input.category_id,
    live: input.live,
    taxonomy,
    field_mapping: fieldMapping,
  });

  if (!r.ok) {
    return { ok: false, error: r.error, details: r.details };
  }
  return { ok: true, ctx: r.ctx };
}