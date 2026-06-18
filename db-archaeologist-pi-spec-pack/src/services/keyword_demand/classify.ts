// classify.ts: 关键词标签命中（§S4 / spec §5）
// 规则：substring 命中，多 label 允许；正向诉求标签需通过否定前缀守卫。
// 输出：ClassificationRecord[]

import type {
  ClassificationRecord,
  KdsWeights,
  KeywordMetricRecord,
  KeywordTaxonomy,
} from "./types.js";

// 正向诉求标签：命中 term 前若紧贴否定字符且组合不在该 label 显式 terms 中，则丢弃该命中
const POSITIVE_INTENT_LABELS = new Set([
  "function",
  "spec",
  "style",
  "material",
  "season",
  "population",
  "target_user",
  "blue_ocean",
]);

const NEGATION_PREFIXES = ["不", "难", "易", "没", "无"];

/**
 * 给一组 records 打标签。
 */
export function classifyKeywords(
  records: KeywordMetricRecord[],
  taxonomy: KeywordTaxonomy,
  weights: KdsWeights,
): ClassificationRecord[] {
  return records.map((r) => classifyOne(r.keyword, taxonomy, weights));
}

export function classifyOne(
  keyword: string,
  taxonomy: KeywordTaxonomy,
  weights: KdsWeights,
): ClassificationRecord {
  const labels: string[] = [];
  const matched: Record<string, string[]> = {};

  for (const [labelName, labelDef] of Object.entries(taxonomy.labels)) {
    const termSet = new Set(labelDef.terms);
    const isPositiveIntent = POSITIVE_INTENT_LABELS.has(labelName);
    const hits = labelDef.terms.filter((term) => {
      const idx = keyword.indexOf(term);
      if (idx < 0) return false;
      if (!isPositiveIntent) return true;
      // 否定前缀守卫：term 前紧贴否定字 + (否定字+term) 不是该 label 自己的显式 term
      if (idx === 0) return true;
      const prevChar = keyword[idx - 1];
      if (!NEGATION_PREFIXES.includes(prevChar)) return true;
      const negated = prevChar + term;
      if (termSet.has(negated)) return true;
      return false;
    });
    if (hits.length > 0) {
      labels.push(labelName);
      matched[labelName] = hits;
    }
  }

  // 应用 intent_multiplier 规则
  const { rule, multiplier } = pickIntentMultiplier(labels, weights);

  return {
    keyword,
    labels,
    matched_terms: matched,
    intent_rule_id: rule,
    intent_multiplier: multiplier,
  };
}

/**
 * 选择第一个匹配的 intent_multiplier 规则。
 * 规则按 yaml 中声明顺序匹配（when_all 严格优先）；
 * transaction_block 单独处理（skip_kds 通过 score 模块识别）；
 * 无任何匹配时返回 category_only_default。
 */
export function pickIntentMultiplier(
  labels: string[],
  weights: KdsWeights,
): { rule: string; multiplier: number } {
  const labelSet = new Set(labels);

  // transaction_block 单独标记，由 score 模块决定是否 skip_kds
  if (labelSet.has("transaction_block")) {
    return { rule: "transaction_block", multiplier: 0 };
  }

  for (const rule of weights.intent_multiplier.rules) {
    if (rule.when_all) {
      if (rule.when_all.every((l) => labelSet.has(l))) {
        return { rule: rule.id, multiplier: rule.value };
      }
    } else if (rule.when_any) {
      if (rule.when_any.some((l) => labelSet.has(l))) {
        return { rule: rule.id, multiplier: rule.value };
      }
    }
  }

  // 仅有 category 或 unknown 时走 category_only_default
  if (labelSet.size === 0 || (labelSet.size === 1 && labelSet.has("category"))) {
    return { rule: "category_only_default", multiplier: weights.intent_multiplier.category_only_default };
  }

  // 默认 1.0
  return { rule: "default", multiplier: 1.0 };
}