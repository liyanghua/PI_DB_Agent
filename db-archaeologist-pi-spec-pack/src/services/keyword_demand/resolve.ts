// resolve.ts: 类目名→category_id 解析（§S1）
// 输入：category_name（用户输入的字符串）
// 输出：{ category_id, category_name, tertiary_category } | null

import type { CategoryTaxonomy } from "./types.js";

export interface ResolveResult {
  category_id: string;
  category_name: string;
  tertiary_category: string;
}

/**
 * 解析类目名到 category_id。
 * 查表逻辑：先 canonical_name 匹配，再 tertiary_category，再 aliases，大小写不敏感。
 */
export function resolveCategory(
  input: string,
  taxonomy: CategoryTaxonomy,
): ResolveResult | null {
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

/**
 * 根据 category_id 反查类目信息（用于 run_meta 构建）
 */
export function getCategoryById(
  categoryId: string,
  taxonomy: CategoryTaxonomy,
): ResolveResult | null {
  const cat = taxonomy.entries.find((c) => c.category_id === categoryId);
  if (!cat) return null;
  return {
    category_id: cat.category_id,
    category_name: cat.canonical_name,
    tertiary_category: cat.tertiary_category,
  };
}