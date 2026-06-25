// tests/invariants.test.ts — Phase 3 Core Lock 不变量守护
// 1) mapping_schema_lint：keyword_field_mapping.yaml 的 aggregation 节点结构 + DSL 合法性
// 2) pull_status_exhaustiveness：PullStatus 枚举 ↔ source_audit STATUS_CN 1:1 对齐
//
// 两条都是硬性失败：违例直接 throw，rebuild_all 与 PR pipeline 都会 fail。
// 详见 docs/20 §7 / docs/18 §7 / Phase 3 plan §8。

import test from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readYaml } from "../src/lib/io.js";
import type { KeywordFieldMapping } from "../src/services/keyword_demand/types.js";

const ROOT = process.cwd();

// 与 src/services/keyword_competition/normalize.ts evaluateFormula 一一对齐
const DSL_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "weighted_avg", re: /^weighted_avg\(\s*[\w]+\s*,\s*weight\s*=\s*[\w]+\s*\)\s*$/ },
  {
    name: "top_n_share",
    re: /^top_n_share\(\s*[\w]+\s*,\s*n\s*=\s*\d+\s*(?:,\s*weighted_by\s*=\s*[\w]+\s*)?\)\s*$/,
  },
  {
    name: "log10_distinct_count",
    re: /^log10\(\s*distinct_count\(\s*[\w]+\s*\)\s*[+\-]\s*\d+(?:\.\d+)?\s*\)\s*\*\s*\d+(?:\.\d+)?\s*$/,
  },
  {
    name: "log10_field",
    re: /^log10\(\s*[\w]+\s*[+\-]\s*\d+(?:\.\d+)?\s*\)\s*\*\s*\d+(?:\.\d+)?\s*$/,
  },
  { name: "distinct_count", re: /^distinct_count\(\s*[\w]+\s*\)\s*$/ },
  { name: "top3_brand_share_alias", re: /^top3_brand_share$/ },
];

const VALID_OUTPUT_LEVELS = new Set(["keyword", "category"]);
const REQUIRED_AGG_FIELDS = ["group_by", "output_level"] as const;

const CATEGORY_AGGREGATION_API_WHITELIST = new Set<string>([
  "data_competition_pattern_analysis",
  "data_competition_pattern_analysis_v3",
  "data_agent_competition_pattern_analysis_v3",
]);

test("invariant: keyword_field_mapping aggregation schema 合法（mapping_schema_lint）", () => {
  const mapping = readYaml<KeywordFieldMapping>(
    path.join(ROOT, "registry/business_field_mapping/keyword.yaml"),
  );

  const violations: string[] = [];

  for (const [apiId, cfg] of Object.entries(mapping.apis ?? {})) {
    const agg = cfg?.aggregation;
    if (!agg) continue;

    for (const f of REQUIRED_AGG_FIELDS) {
      if (!(agg as Record<string, unknown>)[f]) {
        violations.push(`[${apiId}] aggregation.${f} 缺失`);
      }
    }

    if (agg.output_level && !VALID_OUTPUT_LEVELS.has(agg.output_level)) {
      violations.push(
        `[${apiId}] aggregation.output_level=${agg.output_level} 不在 {keyword, category}`,
      );
    }

    if (agg.output_level === "keyword" && !agg.keyword_field) {
      violations.push(
        `[${apiId}] aggregation.output_level=keyword 必须显式声明 keyword_field`,
      );
    }

    if (agg.output_level === "category") {
      if (!CATEGORY_AGGREGATION_API_WHITELIST.has(apiId)) {
        violations.push(
          `[${apiId}] aggregation.output_level=category 但不在 CATEGORY_AGGREGATION_API_WHITELIST`,
        );
      }
      if (!agg.broadcast_to) {
        violations.push(
          `[${apiId}] aggregation.output_level=category 必须声明 broadcast_to（即广播粒度）`,
        );
      }
    }

    for (const [canonical, derivation] of Object.entries(agg.derivations ?? {})) {
      if (!derivation?.formula || typeof derivation.formula !== "string") {
        violations.push(`[${apiId}.${canonical}] derivation.formula 必填且为字符串`);
        continue;
      }
      const f = derivation.formula.trim();
      const matched = DSL_PATTERNS.find(p => p.re.test(f));
      if (!matched) {
        violations.push(
          `[${apiId}.${canonical}] formula "${f}" 不匹配任何受限 DSL 模式（见 docs/18 §3.2.2）`,
        );
      }
      if (derivation.clip) {
        if (!Array.isArray(derivation.clip) || derivation.clip.length !== 2) {
          violations.push(`[${apiId}.${canonical}] clip 必须是 [min, max] 二元组`);
        } else if (derivation.clip[0] >= derivation.clip[1]) {
          violations.push(
            `[${apiId}.${canonical}] clip[${derivation.clip[0]}, ${derivation.clip[1]}] 上下界不合法`,
          );
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error("mapping_schema_lint violations:");
    for (const v of violations) console.error("  - " + v);
  }
  assert.equal(violations.length, 0, `mapping_schema_lint 失败 ${violations.length} 条`);
  console.log(
    `mapping_schema_lint OK: ${
      Object.keys(mapping.apis ?? {}).filter(k => mapping.apis[k]?.aggregation).length
    } 个 api 的 aggregation 块通过校验`,
  );
});

test("invariant: PullStatus 枚举与 source_audit STATUS_CN 1:1 对齐（pull_status_exhaustiveness）", () => {
  const livePullSrc = readFileSync(
    path.join(ROOT, "src/services/keyword_demand/live_pull.ts"),
    "utf-8",
  );
  const auditSrc = readFileSync(
    path.join(ROOT, "src/services/keyword_demand/source_audit.ts"),
    "utf-8",
  );

  const enumBlockMatch = livePullSrc.match(
    /export type PullStatus =\s*([\s\S]*?);/,
  );
  assert.ok(enumBlockMatch, "未找到 PullStatus 类型定义块");
  const enumBlock = enumBlockMatch![1];
  const enumValues = Array.from(enumBlock.matchAll(/"([a-z_]+)"/g)).map(m => m[1]);
  assert.ok(enumValues.length >= 5, `PullStatus 枚举数量异常: ${enumValues.length}`);

  const statusCnBlockMatch = auditSrc.match(
    /const STATUS_CN: Record<string, string>\s*=\s*\{([\s\S]*?)\};/,
  );
  assert.ok(statusCnBlockMatch, "未找到 STATUS_CN 定义块");
  const cnBlock = statusCnBlockMatch![1];
  const cnKeys = Array.from(cnBlock.matchAll(/^\s*([a-z_]+)\s*:/gm)).map(m => m[1]);

  const enumSet = new Set(enumValues);
  const cnSet = new Set(cnKeys);

  const missingInCn = enumValues.filter(v => !cnSet.has(v));
  const extraInCn = cnKeys.filter(k => !enumSet.has(k));

  if (missingInCn.length > 0) {
    console.error("STATUS_CN 缺失映射:", missingInCn.join(", "));
  }
  if (extraInCn.length > 0) {
    console.error("STATUS_CN 多余映射:", extraInCn.join(", "));
  }

  assert.equal(missingInCn.length, 0, `STATUS_CN 缺失 ${missingInCn.length} 个 PullStatus`);
  assert.equal(extraInCn.length, 0, `STATUS_CN 多余 ${extraInCn.length} 个未在 PullStatus 内的 key`);
  console.log(
    `pull_status_exhaustiveness OK: ${enumValues.length} 个 PullStatus 值 ↔ ${cnKeys.length} 个 STATUS_CN key 完全对齐`,
  );
});

test("invariant: keyword_field_mapping.response_root 与 card.response_schema.root 一致性（受控豁免）", () => {
  // 已知豁免登记表：drift 已在 docs/21 §3.3 登记，运行时由 live_pull 的
  // response_root_override 透传 mapping 值修复（符合 docs/09 §5.4：overlay 不得改 response_schema）。
  // 豁免要求 mapping_root + card_root 双值精确匹配；任一值漂移或出现新 drift 即硬性失败。
  const KNOWN_ROOT_DRIFT_ALLOWLIST = new Map<string, { mapping_root: string; card_root: string }>([
    [
      "data_cust_ads_ad_flow_plan_goods_keyword_7d",
      { mapping_root: "data.result[]", card_root: "data" },
    ],
  ]);

  const mapping = readYaml<KeywordFieldMapping>(
    path.join(ROOT, "registry/business_field_mapping/keyword.yaml"),
  );
  const cardsRaw = readFileSync(
    path.join(ROOT, "registry/derived/api_asset_cards.json"),
    "utf-8",
  );
  const cards = JSON.parse(cardsRaw) as { cards: Array<{ api_id: string; response_schema?: { root?: string } }> };
  const cardRootByApi = new Map<string, string | undefined>();
  for (const c of cards.cards ?? []) {
    cardRootByApi.set(c.api_id, c.response_schema?.root);
  }

  const exempted: Array<{ api_id: string; mapping_root: string; card_root: string }> = [];
  const unexpected: Array<{ api_id: string; mapping_root: string; card_root: string | undefined }> = [];
  for (const [apiId, cfg] of Object.entries(mapping.apis ?? {})) {
    if (cfg?.enabled === false) continue;
    const mappingRoot = cfg?.response_root;
    if (!mappingRoot) continue;
    const cardRoot = cardRootByApi.get(apiId);
    if (!cardRoot || cardRoot === mappingRoot) continue;
    const allow = KNOWN_ROOT_DRIFT_ALLOWLIST.get(apiId);
    if (allow && allow.mapping_root === mappingRoot && allow.card_root === cardRoot) {
      exempted.push({ api_id: apiId, mapping_root: mappingRoot, card_root: cardRoot });
    } else {
      unexpected.push({ api_id: apiId, mapping_root: mappingRoot, card_root: cardRoot });
    }
  }

  if (unexpected.length > 0) {
    for (const d of unexpected) {
      console.error(`  - 未登记 drift: ${d.api_id}: mapping.response_root="${d.mapping_root}" vs card.response_schema.root="${d.card_root}"`);
    }
  }
  assert.equal(
    unexpected.length,
    0,
    `mapping_card_root_consistency: ${unexpected.length} 个未登记的 root drift（请真机核对后改 mapping 或在 docs/21 §3.3 + allowlist 登记）`,
  );

  for (const d of exempted) {
    console.warn(`mapping_card_root_consistency 受控豁免: ${d.api_id} mapping="${d.mapping_root}" vs card="${d.card_root}"（docs/21 §3.3 已登记，运行时 response_root_override 透传）`);
  }
  console.log(`mapping_card_root_consistency OK: 0 个未登记 drift，${exempted.length} 个受控豁免`);
});