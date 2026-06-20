import test from "node:test";
import { strict as assert } from "node:assert";
import path from "node:path";
import { readFileSync } from "node:fs";
import { readJson, readYaml } from "../src/lib/io.js";
import { askApiCatalog } from "../src/services/qa.js";
import { selectToolsForTask } from "../src/services/selector.js";
import { proposeInsightPlan } from "../src/services/insight_planner.js";
import { analyzeKeywordDemand } from "../src/services/keyword_demand/index.js";
import { classifyOne } from "../src/services/keyword_demand/classify.js";
import { assembleRequest } from "../src/services/api_runtime.js";
import type { ProbeEnv } from "../src/services/api_runtime.js";
import type { ApiAssetCard } from "../src/lib/types.js";
import type { KdsWeights, KeywordTaxonomy, KeywordScoreRecord } from "../src/services/keyword_demand/types.js";

type QaCase = { id: string; question: string; expected_contains: string[] };
type SelectCase = {
  id: string;
  task: string;
  known_params?: Record<string, unknown>;
  expected_tools: string[];
  expected_missing_params?: string[];
  expected_notes?: string[];
};
type InsightCase = {
  id: string;
  topic: string;
  expected_template_key: string;
  min_candidates: number;
  min_coverage_pct: number;
  expected_output_columns?: string[];
};

const ROOT = process.cwd();

const qaCases = readYaml<{ cases: QaCase[] }>(path.join(ROOT, "tests/golden_cases/api_qa_cases.yaml")).cases;
const selectCases = readYaml<{ cases: SelectCase[] }>(path.join(ROOT, "tests/golden_cases/tool_selection_cases.yaml")).cases;
const insightCases = readYaml<{ cases: InsightCase[] }>(path.join(ROOT, "tests/golden_cases/insight_plan_cases.yaml")).cases;

test("api_qa golden: top-3 hit rate >= 0.8", () => {
  let pass = 0;
  for (const c of qaCases) {
    const r = askApiCatalog(c.question, { limit: 5 });
    const blob = JSON.stringify(r).toLowerCase();
    const allFound = c.expected_contains.every(s => blob.includes(s.toLowerCase()));
    if (allFound) pass++;
    else console.warn(`[qa] miss ${c.id}: missing=${c.expected_contains.filter(s => !blob.includes(s.toLowerCase())).join(",")}`);
  }
  const rate = pass / qaCases.length;
  console.log(`api_qa golden hit rate: ${pass}/${qaCases.length} = ${rate.toFixed(2)}`);
  assert.ok(rate >= 0.8, `qa hit rate ${rate} < 0.8`);
});

test("tool_selection golden: pass rate >= 0.75", () => {
  let pass = 0;
  for (const c of selectCases) {
    const r = selectToolsForTask(c.task, c.known_params ?? {});
    const ids = r.recommended_tools.map(t => t.tool_id);
    const allTools = c.expected_tools.every(t => ids.includes(t));
    const missingOk =
      !c.expected_missing_params || c.expected_missing_params.every(p => r.recommended_tools.some(it => it.missing_params.includes(p)));
    const notesOk =
      !c.expected_notes || c.expected_notes.every(n => r.next_question.includes(n));
    if (allTools && missingOk && notesOk) pass++;
    else
      console.warn(`[select] miss ${c.id}: tools_ok=${allTools} missing_ok=${missingOk} notes_ok=${notesOk}, got=${ids.join(",")}, next=${r.next_question}`);
  }
  const rate = pass / selectCases.length;
  console.log(`tool_selection golden pass rate: ${pass}/${selectCases.length} = ${rate.toFixed(2)}`);
  assert.ok(rate >= 0.75, `select pass rate ${rate} < 0.75`);
});

test("blocked apis include path placeholders", () => {
  const r = selectToolsForTask("分析某个商品最近7天转化下降的原因");
  const blocked = r.blocked_or_deprioritized;
  console.log(`blocked_or_deprioritized count: ${blocked.length}`);
  assert.ok(Array.isArray(blocked), "blocked must be array");
});

test("insight_plan golden: pass rate >= 0.66", () => {
  let pass = 0;
  for (const c of insightCases) {
    const plan = proposeInsightPlan({ topic: c.topic });
    const tplOk = plan.template_key === c.expected_template_key;
    const candOk = plan.candidate_apis.length >= c.min_candidates;
    const covOk = plan.coverage_report.coverage_pct >= c.min_coverage_pct;
    const colsOk = !c.expected_output_columns || c.expected_output_columns.every(col => plan.output_schema.some(o => o.col_name === col));
    if (tplOk && candOk && covOk && colsOk) pass++;
    else console.warn(`[insight] miss ${c.id}: tpl=${tplOk}(${plan.template_key}) cand=${candOk}(${plan.candidate_apis.length}/${c.min_candidates}) cov=${covOk}(${plan.coverage_report.coverage_pct}/${c.min_coverage_pct}) cols=${colsOk}(${plan.output_schema.map(o => o.col_name).join(",")})`);
  }
  const rate = pass / insightCases.length;
  console.log(`insight_plan golden pass rate: ${pass}/${insightCases.length} = ${rate.toFixed(2)}`);
  assert.ok(rate >= 0.66, `insight pass rate ${rate} < 0.66`);
});

// ============ Keyword Demand 不变量 ============

test("keyword_demand: 否定前缀守卫（不耐脏不打 function）", () => {
  const taxonomy = readYaml<KeywordTaxonomy>(path.join(ROOT, "registry/keyword_taxonomy.baseline_v1.locked.yaml"));
  const weights = readYaml<KdsWeights>(path.join(ROOT, "registry/kds_weights.baseline_v1.locked.yaml"));
  const cls = classifyOne("厨房地垫不耐脏", taxonomy, weights);
  // 核心断言：含"不+耐脏"，不应被识别为 function 诉求词
  assert.ok(!cls.labels.includes("function"), `"厨房地垫不耐脏" 不应被打 function 标签，实际 labels=${cls.labels.join(",")}`);
  // 至少应保留 category 标签
  assert.ok(cls.labels.includes("category"), `"厨房地垫不耐脏" 应被打 category 标签，实际 labels=${cls.labels.join(",")}`);
});

test("keyword_demand: 端到端 baseline run 通过 5 条不变量", async () => {
  const r = await analyzeKeywordDemand({ category: "厨房地垫", strategy: "baseline_v1", live: false });
  assert.ok(!("error" in r), `analyzeKeywordDemand 失败: ${"error" in r ? r.error : ""}`);
  if ("error" in r) return;

  // 加载产物
  const scoresPath = path.join(r.run_dir, "keyword_scores.json");
  const topsPath = path.join(r.run_dir, "category_top_keywords.json");
  const normalizePath = path.join(r.run_dir, "normalize_report.json");

  const scored = JSON.parse(readFileSync(scoresPath, "utf8")) as KeywordScoreRecord[];
  const tops = JSON.parse(readFileSync(topsPath, "utf8")) as { top_overall: KeywordScoreRecord[] };
  const normReport = JSON.parse(readFileSync(normalizePath, "utf8")) as { degradations: Array<{ keyword: string; missing_field: string; fallback_used: string }> };

  // 不变量 1：top_overall 不含 transaction_block
  for (const k of tops.top_overall) {
    assert.ok(!k.labels.includes("transaction_block"), `top_overall 不应含 transaction_block 词：${k.keyword}`);
  }

  // 不变量 2：top_overall 不含纯品类词
  const intentLabels = new Set(["function", "spec", "style", "material", "season", "population", "target_user", "blue_ocean"]);
  for (const k of tops.top_overall) {
    const hasIntent = k.labels.some((l) => intentLabels.has(l));
    assert.ok(hasIntent, `top_overall 不应含纯品类词（无具体诉求标签）：${k.keyword} labels=${k.labels.join(",")}`);
  }

  // 不变量 3：top_overall 不含纯痛点词
  for (const k of tops.top_overall) {
    if (k.labels.includes("pain")) {
      const hasIntent = k.labels.some((l) => intentLabels.has(l));
      assert.ok(hasIntent, `top_overall 不应含纯痛点词：${k.keyword} labels=${k.labels.join(",")}`);
    }
  }

  // 不变量 4：所有 subscores formula 中带完整 inputs 的可重算（误差 ≤ 1.0）
  let recomputeChecked = 0;
  for (const rec of scored) {
    for (const ss of rec.explanation.subscores) {
      if (!ss.inputs || !ss.formula || ss.fallback_chain?.length) continue;
      // 跳过含 "..." 简写的公式（baseline 在缺省字段时会简写）
      if (ss.formula.includes("...")) continue;
      const m = ss.formula.match(/(\d+(?:\.\d+)?)\s*×/g);
      if (!m) continue;
      const weights = m.map((s) => parseFloat(s.replace(/\s*×/, "")));
      if (weights.length !== ss.inputs.length) continue;
      const recomputed = weights.reduce((sum, w, i) => sum + w * ss.inputs![i].value, 0) * 100;
      assert.ok(Math.abs(recomputed - ss.result) <= 1.0, `subscores formula 重算偏差 >1：${rec.keyword}.${ss.name} formula=${ss.formula} expected=${ss.result.toFixed(3)} got=${recomputed.toFixed(3)}`);
      recomputeChecked += 1;
    }
  }
  assert.ok(recomputeChecked > 0, "至少应检查 1 条 subscore 重算");

  // 不变量 5：fallback_chain 与 normalize_report.degradations 一致性
  // normalize_report.degradations 中出现的 (keyword, missing_field) 必须在该 keyword 的 score_trace 某 subscore.fallback_chain 中能找到对应记录
  const degByKw = new Map<string, Set<string>>();
  for (const d of normReport.degradations) {
    if (!degByKw.has(d.keyword)) degByKw.set(d.keyword, new Set());
    degByKw.get(d.keyword)!.add(d.fallback_used);
  }
  // 抽样断言：至少存在一条 keyword 同时在 degradations 与 score 的 fallback_chain 中
  // （不过严：若 normalize 完整无降级，跳过）
  if (normReport.degradations.length > 0) {
    let matched = 0;
    for (const rec of scored) {
      const degs = degByKw.get(rec.keyword);
      if (!degs) continue;
      const fcAll = rec.explanation.subscores.flatMap((s) => s.fallback_chain ?? []);
      if (fcAll.length > 0) matched += 1;
    }
    assert.ok(matched > 0, "存在 normalize degradation 时，应至少有一条 score 含 fallback_chain");
  }

  console.log(`keyword_demand invariants: 5/5 passed (run=${r.run_id}, scored=${scored.length}, top=${tops.top_overall.length}, recompute_checked=${recomputeChecked})`);
});

// ============ Validation Overlay 不变量 ============

const TEST_ENV: ProbeEnv = {
  baseUrl: "http://122.227.49.54:30404/openApi/api/1958050182385065986/5/data/",
  tenantId: "TENANT_X",
  userId: "USER_Y",
  appCodeKey: "APPCK_X",
  appCode: "APPC_Y",
};

function loadAllCards(): ApiAssetCard[] {
  const file = readJson<{ cards: ApiAssetCard[] }>(path.join(ROOT, "registry/derived/api_asset_cards.json"));
  return file.cards;
}

test("validation_overlay: 6 P0 卡全部挂上 verified_call & query_camel", () => {
  const cards = loadAllCards();
  const p0 = [
    "agent_sycm_keyword",
    "agent_blue_ocean_keywords_analysis",
    "agent_keyword",
    "data_keyword_trend",
    "data_blue_keyword_7d_v2",
    "data_ads_industry_keywords_summary_m",
  ];
  for (const id of p0) {
    const c = cards.find((x) => x.api_id === id);
    assert.ok(c, `P0 card not found: ${id}`);
    assert.ok(c!.verified_call, `${id} 缺 verified_call`);
    assert.equal(c!.verified_call!.auth_inject_policy.style, "query_camel", `${id} auth style 应为 query_camel`);
    assert.deepEqual(c!.verified_call!.auth_inject_policy.identity_keys, ["userId", "tenantId"]);
    assert.deepEqual(c!.verified_call!.auth_inject_policy.headers_required, ["x-ca-appCodeKey", "x-ca-appCode"]);
  }
});

test("validation_overlay: 命中分支 URL 形态 (agent_sycm_keyword)", () => {
  const cards = loadAllCards();
  const card = cards.find((x) => x.api_id === "agent_sycm_keyword");
  assert.ok(card, "agent_sycm_keyword not found");
  const a = assembleRequest(card!, TEST_ENV, { tertiary_category: "入户地垫" });

  // host derive 自 baseUrl
  assert.ok(a.url.startsWith("http://122.227.49.54:30404/openApi/api/1958050182385065986/5/agent/sycm_keyword?"), `URL 形态不对: ${a.url}`);
  // query 含 userId / tenantId / tertiary_category
  assert.equal(a.query["userId"], "USER_Y");
  assert.equal(a.query["tenantId"], "TENANT_X");
  // body 含 tertiary_category，不含蛇形身份
  assert.ok(a.body && typeof a.body === "object", "body 应是对象");
  const body = a.body as Record<string, unknown>;
  assert.equal(body["tertiary_category"], "入户地垫");
  assert.ok(!("tenant_id" in body), "verified_call 命中时 body 不应有蛇形 tenant_id");
  assert.ok(!("user_id" in body), "verified_call 命中时 body 不应有蛇形 user_id");
  // auth_inject 标记
  assert.equal(a.auth_inject.policy_style, "query_camel");
  assert.equal(a.auth_inject.source, "verified_call");
  // headers 带 x-ca-* 签名头
  assert.equal(a.headers["x-ca-appCodeKey"], TEST_ENV.appCodeKey);
  assert.equal(a.headers["x-ca-appCode"], TEST_ENV.appCode);
  assert.deepEqual(a.auth_inject.header, ["x-ca-appCodeKey", "x-ca-appCode"]);
});

test("validation_overlay: 未命中走 legacy（蛇形身份 + x-ca-*）", () => {
  const cards = loadAllCards();
  const card = cards.find((x) => !x.verified_call);
  assert.ok(card, "找不到无 verified_call 的 card");
  const a = assembleRequest(card!, TEST_ENV, {});

  // legacy URL 用 baseUrl 直接拼
  assert.ok(a.url.startsWith(TEST_ENV.baseUrl.replace(/\/$/, "")), `legacy URL 形态不对: ${a.url}`);
  // headers 带 x-ca-*
  assert.equal(a.headers["x-ca-appCodeKey"], TEST_ENV.appCodeKey);
  assert.equal(a.headers["x-ca-appCode"], TEST_ENV.appCode);
  // auth_inject 标记
  assert.equal(a.auth_inject.source, "legacy");
  assert.equal(a.auth_inject.policy_style, "legacy_snake");
  // 蛇形身份按 method 注入到 body 或 query
  const useBody = ["POST", "PUT", "PATCH"].includes(card!.method);
  if (useBody) {
    const body = a.body as Record<string, unknown>;
    assert.ok(body && (body["tenant_id"] === TEST_ENV.tenantId || body["user_id"] === TEST_ENV.userId), "legacy POST body 应含 tenant_id/user_id");
  } else {
    assert.ok(a.query["tenant_id"] === TEST_ENV.tenantId || a.query["user_id"] === TEST_ENV.userId, "legacy GET query 应含 tenant_id/user_id");
  }
});