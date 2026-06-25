// quick offline smoke for web modules. Cursor sandbox disallows listen(),
// so we exercise the modules directly without spawning a real http server.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getSnapshot } from "./lib/registry-snapshot.mjs";
import { renderMarkdown, renderDetails, detectDetailsKind } from "./public/render.mjs";

process.env.SPEC_PACK_ROOT = process.env.SPEC_PACK_ROOT || new URL("..", import.meta.url).pathname;

// The shell must remain usable when external CDN scripts are unavailable.
// Tailwind is progressive enhancement here; local CSS owns the critical layout.
const fallbackCss = await readFile(new URL("./public/ui-fallback.css", import.meta.url), "utf8");
for (const page of ["index.html", "insight.html"]) {
  const html = await readFile(new URL(`./public/${page}`, import.meta.url), "utf8");
  const localCssAt = html.indexOf('href="/ui-fallback.css"');
  const tailwindAt = html.indexOf("cdn.tailwindcss.com");
  assert.ok(localCssAt >= 0, `${page} must load local fallback CSS`);
  assert.ok(tailwindAt < 0 || localCssAt < tailwindAt, `${page} must load fallback CSS before Tailwind CDN`);
  assert.match(html, /window\.tailwind\s*=\s*window\.tailwind\s*\|\|\s*\{\}/, `${page} must guard Tailwind config`);
}
assert.match(fallbackCss, /\.flex\s*\{[^}]*display:\s*flex/is, "fallback CSS must define flex");
assert.match(fallbackCss, /\.grid\s*\{[^}]*display:\s*grid/is, "fallback CSS must define grid");
assert.match(fallbackCss, /\.h-full\s*\{[^}]*height:\s*100%/is, "fallback CSS must define full height layout");
assert.match(fallbackCss, /\.bg-white\s*\{[^}]*background/is, "fallback CSS must define core colors");

const snap = await getSnapshot();
console.log("[snapshot]",
  "cards.total =", snap.cards.total,
  "tools.total =", snap.tools.total,
  "blocked =", snap.tools.blocked,
  "byStatus.keys =", Object.keys(snap.cards.byStatus).join(","),
);
assert.ok(snap.cards.total > 0, "cards must load");
assert.ok(snap.tools.total > 0, "tools must load");

const md = renderMarkdown([
  "# Hello",
  "",
  "这是 **DB Archaeologist** 的 *demo*。",
  "",
  "- ask_api_catalog",
  "- list_domain_apis",
  "",
  "| col | val |",
  "| --- | --- |",
  "| a   | 1   |",
  "| b   | 2   |",
  "",
  "![pic](https://example.com/x.png)",
  "",
  "```json",
  '{"a":1}',
  "```",
].join("\n"));
console.log("[md head]", md.slice(0, 240), "…");
assert.ok(md.includes("<h1>Hello</h1>"));
assert.ok(md.includes("<strong>DB Archaeologist</strong>"));
assert.ok(md.includes("<code"));
assert.ok(md.includes("<li>ask_api_catalog</li>"));
assert.ok(md.includes("<table>"));
assert.ok(md.includes("<th>col</th>"));
assert.ok(md.includes("<img"), "image rendered");

// 危险 HTML 应被 sanitize/escape：不能出现真实的 <script 标签
const dirty = renderMarkdown(`<script>alert(1)</script>正文`);
assert.ok(!/<script/i.test(dirty), `live <script> tag must not appear, got: ${dirty}`);
assert.ok(dirty.includes("正文"));

// ─────────────────────────────────────────────
// details 分发
// ─────────────────────────────────────────────
const fakeQa = {
  answer_type: "api_candidates",
  question: "商品诊断有哪些接口？",
  candidates: [
    { api_id: "API0001", name: "商品销量诊断", method: "POST", path: "/api/goods/diagnose", domain: "商品域", lifecycle_status: "agent_ready", quality_score: 0.82, reason: "lex:0.5", risks: [] },
    { api_id: "API0002", name: "商品流量诊断", method: "GET",  path: "/api/goods/traffic",  domain: "商品域", lifecycle_status: "candidate",   quality_score: 0.55, reason: "ngram:0.4", risks: ["missing_response_fields"] },
  ],
  recommended_tools: [{ tool_id: "diagnose_goods", tool_name: "商品诊断", reason: "wraps API0001" }],
  notes: "matched=2",
};
assert.equal(detectDetailsKind(fakeQa), "qa_result");
const qaHtml = renderDetails(fakeQa);
assert.ok(qaHtml.includes("<table"), "QaResult should render <table>");
assert.ok(qaHtml.includes("API0001") || qaHtml.includes("/api/goods/diagnose"));
assert.ok(qaHtml.includes("agent_ready"));
assert.ok(qaHtml.includes("商品诊断"));

const fakePlan = {
  task: "蓝海词挖掘",
  intent: "关键词",
  recommended_tools: [
    { tool_id: "find_blueocean_keywords", call_order: 1, reason: "match", required_params: ["category", "start_date", "end_date"], missing_params: ["category"], source_apis: ["/api/kw/blueocean"], quality_score: 0.7, risks: [] },
  ],
  blocked_or_deprioritized: [{ ref: "API0099", reason: "path_placeholder" }],
  next_question: "请提供 category。",
};
assert.equal(detectDetailsKind(fakePlan), "tool_plan");
const planHtml = renderDetails(fakePlan);
assert.ok(planHtml.includes("tool-plan"), "ToolPlan should use <ol class=tool-plan>");
assert.ok(planHtml.includes("find_blueocean_keywords"));
assert.ok(planHtml.includes("category"));

const fakeCard = {
  api_id: "API0001", name: "商品销量诊断", method: "POST", path: "/api/goods/diagnose",
  module: "商品分析", domain: "商品域", capability: "商品诊断", lifecycle_status: "agent_ready",
  quality_score: 0.82, source_seq: 1,
  request_schema: { query: [{ name: "goods_id", type: "string", required: true, desc: "商品ID" }], body: null, headers: [], path_params: [] },
  response_schema: { root: "data", fields: [{ path: "data.score", name: "score", type: "number", desc: "诊断分" }], example: { data: { score: 78 } } },
};
assert.equal(detectDetailsKind(fakeCard), "api_asset_card");
const cardHtml = renderDetails(fakeCard);
assert.ok(cardHtml.includes("/api/goods/diagnose"));
assert.ok(cardHtml.includes("data.score"));
assert.ok(cardHtml.includes("response example"));

const fakeLineage = {
  root: { type: "Tool", id: "diagnose_goods", label: "商品诊断" },
  steps: [
    { from: "diagnose_goods", to: "API0001", via: "TOOL_WRAPS_API" },
    { from: "API0001", to: "metric.转化率", via: "FIELD_MAPS_TO_METRIC" },
  ],
  text: "# Tool 商品诊断\n- API0001",
};
assert.equal(detectDetailsKind(fakeLineage), "lineage_chain");
const lnHtml = renderDetails(fakeLineage);
assert.ok(lnHtml.includes("TOOL_WRAPS_API"));
assert.ok(lnHtml.includes("metric.转化率") || lnHtml.includes("metric.&#x4E2A;") || lnHtml.includes("metric."));

const fakeDomain = {
  domain: "商品域", count: 2,
  apis: [
    { api_id: "API0001", method: "POST", path: "/api/goods/diagnose", name: "诊断", lifecycle_status: "agent_ready", quality_score: 0.8, capability: "商品诊断", issues: [] },
    { api_id: "API0002", method: "GET",  path: "/api/goods/list",     name: "列表", lifecycle_status: "candidate",   quality_score: 0.5, capability: "商品分析", issues: ["empty_response_example"] },
  ],
};
assert.equal(detectDetailsKind(fakeDomain), "domain_apis");
const domHtml = renderDetails(fakeDomain);
assert.ok(domHtml.includes("/api/goods/diagnose"));
assert.ok(domHtml.includes("empty_response_example"));

const fakeIssues = {
  count: 1,
  issues: [{ api_id: "API0099", method: "POST", path: "/x/{id}", domain: "公共基础域", lifecycle_status: "blocked", issue_type: "path_placeholder", severity: "high", message: "path 包含占位符" }],
  blocked_apis: [{ api_id: "API0099", reasons: ["path_placeholder"] }],
};
assert.equal(detectDetailsKind(fakeIssues), "quality_issues");
const issHtml = renderDetails(fakeIssues);
assert.ok(issHtml.includes("path_placeholder"));
assert.ok(issHtml.includes("blocked"));

// ─────────────────────────────────────────────
// ApiProbeResult: blocked / ok / error
// ─────────────────────────────────────────────
const probeBlockedLive = {
  kind: "api_probe_result",
  api_id: "API0001", method: "POST", path: "/agent/blueocean",
  request: {
    url: "https://example.com/agent/blueocean?requirement_prop=1.5",
    query: { requirement_prop: "1.5" },
    body: { tenant_id: "***", user_id: "***", search_value: "连衣裙" },
    headers_keys: ["x-ca-appCodeKey", "x-ca-appCode", "Content-Type"],
    auth_inject: { header: ["x-ca-appCodeKey", "x-ca-appCode"], body: ["tenant_id", "user_id"], query: [] },
  },
  status: { state: "blocked", reason: "live_probe_disabled" },
};
assert.equal(detectDetailsKind(probeBlockedLive), "api_probe_result");
const probeBlockedHtml = renderDetails(probeBlockedLive);
assert.ok(probeBlockedHtml.includes("LIVE_PROBE"), "blocked-live banner expected");
assert.ok(probeBlockedHtml.includes("x-ca-appCodeKey"));
assert.ok(probeBlockedHtml.includes("***"), "header values must be redacted to ***");
assert.ok(!probeBlockedHtml.includes("real-secret-value"));

const probeBlockedEnv = {
  kind: "api_probe_result",
  api_id: "API0001", method: "POST", path: "/agent/blueocean",
  request: { url: "", query: {}, body: null, headers_keys: [], auth_inject: { header: [], body: [], query: [] } },
  status: { state: "blocked", reason: "env_missing", details: { missing: ["ZICHEN_BASE_URL", "ZICHEN_APP_CODE"] } },
};
const probeEnvHtml = renderDetails(probeBlockedEnv);
assert.ok(probeEnvHtml.includes("ZICHEN_BASE_URL"));
assert.ok(probeEnvHtml.includes("ZICHEN_APP_CODE"));

const probeMissing = {
  kind: "api_probe_result",
  api_id: "API0001", method: "POST", path: "/agent/blueocean",
  request: { url: "", query: {}, body: null, headers_keys: [], auth_inject: { header: [], body: [], query: [] } },
  status: { state: "blocked", reason: "missing_params" },
  missing_required_params: [
    { name: "requirement_prop", desc: "需求度阈值", position: "query" },
    { name: "search_value", desc: "搜索词", position: "query" },
  ],
};
const probeMissHtml = renderDetails(probeMissing);
assert.ok(probeMissHtml.includes("requirement_prop"));
assert.ok(probeMissHtml.includes("需求度阈值"));
assert.ok(probeMissHtml.includes("search_value"));

const probeOk = {
  kind: "api_probe_result",
  api_id: "API0001", method: "POST", path: "/agent/blueocean",
  request: {
    url: "https://example.com/agent/blueocean?requirement_prop=1.5&search_value=%E8%BF%9E%E8%A1%A3%E8%A3%99",
    query: { requirement_prop: "1.5", search_value: "连衣裙" },
    body: { tenant_id: "***", user_id: "***" },
    headers_keys: ["x-ca-appCodeKey", "x-ca-appCode", "Content-Type"],
    auth_inject: { header: ["x-ca-appCodeKey", "x-ca-appCode"], body: ["tenant_id", "user_id"], query: [] },
  },
  status: { state: "ok", http: 200, elapsed_ms: 421 },
  response: {
    root: "data.result[]",
    total: 23,
    truncated: true,
    top: [
      { keyword: "夏季连衣裙", popularity: "高", supply: 12 },
      { keyword: "碎花连衣裙", popularity: "中", supply: 34 },
    ],
    sample_keys: ["keyword", "popularity", "supply"],
  },
};
const probeOkHtml = renderDetails(probeOk);
assert.ok(probeOkHtml.includes("data.result[]"));
assert.ok(probeOkHtml.includes("夏季连衣裙"));
assert.ok(probeOkHtml.includes("<table"), "response top should render <table>");
assert.ok(probeOkHtml.includes("421ms"));
assert.ok(probeOkHtml.includes("200"));

const probeErr = {
  kind: "api_probe_result",
  api_id: "API0001", method: "POST", path: "/agent/blueocean",
  request: {
    url: "https://example.com/agent/blueocean",
    query: {}, body: {}, headers_keys: ["x-ca-appCode"],
    auth_inject: { header: ["x-ca-appCode"], body: [], query: [] },
  },
  status: { state: "http_error", http: 500, elapsed_ms: 102, error: "Internal Server Error" },
};
const probeErrHtml = renderDetails(probeErr);
assert.ok(probeErrHtml.includes("500"));
assert.ok(probeErrHtml.includes("Internal Server Error"));

console.log("[render] api_probe_result blocked/ok/http_error OK");

// size guard
const big = { items: Array.from({ length: 8000 }, (_, i) => ({ id: i, name: "row_" + i, blob: "x".repeat(40) })) };
const bigHtml = renderDetails(big);
assert.ok(bigHtml.includes("已降级") || bigHtml.includes("json-tree"), "oversized payload should fall back to JSON tree");

// fallback for unknown shape
const tree = renderDetails({ foo: { bar: [1, 2, 3], baz: { x: 1 } }, hint: "unknown" });
assert.ok(tree.includes("json-tree"));

console.log("[render] qa/plan/card/lineage/domain/issues + sanitize + size guard OK");

// store: simulate a turn end-to-end
const { state, applyBridgeEvent, pushUserMessage } = await import("./public/store.mjs");
pushUserMessage("商品诊断有哪些接口？");
applyBridgeEvent({ kind: "ready", ok: true, pid: 9999, model: "aicodemirror/gpt-5.5", thinking: "medium", cwd: "/x" });
applyBridgeEvent({ kind: "agent_event", payload: { type: "turn_start" } });
applyBridgeEvent({ kind: "agent_event", payload: { type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } } });
applyBridgeEvent({ kind: "agent_event", payload: { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "先调 ask_api_catalog…" } } });
applyBridgeEvent({ kind: "agent_event", payload: { type: "tool_execution_start", toolCallId: "tc1", toolName: "ask_api_catalog", args: { question: "商品诊断", limit: 5 } } });
applyBridgeEvent({ kind: "agent_event", payload: { type: "tool_execution_end", toolCallId: "tc1", toolName: "ask_api_catalog", isError: false, result: { details: fakeQa } } });
applyBridgeEvent({ kind: "agent_event", payload: { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 1 } } });
applyBridgeEvent({ kind: "agent_event", payload: { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "找到 5 个候选…" } } });
applyBridgeEvent({ kind: "agent_event", payload: { type: "message_update", assistantMessageEvent: { type: "text_end", contentIndex: 1, content: "找到 5 个候选。" } } });
applyBridgeEvent({ kind: "agent_event", payload: { type: "turn_end" } });

await new Promise((r) => setTimeout(r, 30));

// ─────────────────────────────────────────────
// upstream_error 桥接事件
// ─────────────────────────────────────────────
applyBridgeEvent({ kind: "upstream_error", phase: "retry", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "Connection error.", hint: "network_unreachable" });
applyBridgeEvent({ kind: "upstream_error", phase: "retry", attempt: 2, maxAttempts: 3, delayMs: 4000, errorMessage: "Connection error.", hint: "network_unreachable" });
applyBridgeEvent({ kind: "upstream_error", phase: "final", errorMessage: "Connection error.", hint: "network_unreachable" });
await new Promise((r) => setTimeout(r, 5));

assert.equal(state.upstreamErrors.length, 3, "three upstream_error entries cached");
assert.equal(state.upstreamErrors.at(-1).phase, "final");
assert.equal(state.upstreamErrors.at(-1).hint, "network_unreachable");

// 当 final 到达时，若仍有 running turn，应被标 error
pushUserMessage("再问一次");
applyBridgeEvent({ kind: "agent_event", payload: { type: "turn_start" } });
applyBridgeEvent({ kind: "upstream_error", phase: "final", errorMessage: "Connection error.", hint: "network_unreachable" });
await new Promise((r) => setTimeout(r, 5));
const lastTurn = state.turns.at(-1);
assert.equal(lastTurn.kind, "assistant");
assert.equal(lastTurn.status, "error");
assert.equal(lastTurn.errorHint, "network_unreachable");

console.log("[store] upstream_error retry/final + turn marking OK");

// ─────────────────────────────────────────────
// inspector tab + raw filter
// ─────────────────────────────────────────────
const {
  setInspectorTab,
  setRawFilter,
  startKeywordAnalysis,
  finishKeywordAnalysis,
  failKeywordAnalysis,
} = await import("./public/store.mjs");
assert.equal(state.inspectorTab, "trace");
setInspectorTab("upstream");
assert.equal(state.inspectorTab, "upstream");
setRawFilter("toolcall");
assert.equal(state.rawFilter, "toolcall");
setInspectorTab("raw");
const matched = (state.raw || []).filter((r) => {
  try { return JSON.stringify(r.evt).toLowerCase().includes(state.rawFilter); } catch { return false; }
});
assert.ok(matched.length > 0, "raw filter must match captured tool_execution_* events");
setRawFilter("");
console.log("[store] inspector tab + raw filter OK");

startKeywordAnalysis({ category: "客厅地毯", strategy: "baseline_v1", live: false });
assert.equal(state.keywordAnalysis.loading, true);
assert.equal(state.keywordAnalysis.lastInput.category, "客厅地毯");
finishKeywordAnalysis({
  run_id: "run_1",
  category: "入户地垫",
  category_id: "121364010",
  resolution: "mock_fixture_fallback",
  top_overall: [{ keyword: "入户门防滑吸水地垫", labels: ["category", "function"], scores: { kds: 91.2 }, explanation: { rank_reason: "强需求" } }],
  top_by_type: { function: [{ keyword: "入户门防滑吸水地垫", labels: ["category", "function"], scores: { kds: 91.2 }, explanation: { rank_reason: "强需求" } }] },
});
assert.equal(state.keywordAnalysis.loading, false);
assert.equal(state.keywordAnalysis.result.run_id, "run_1");
failKeywordAnalysis("fixture missing");
assert.equal(state.keywordAnalysis.loading, false);
assert.equal(state.keywordAnalysis.error, "fixture missing");
console.log("[store] keyword analysis state OK");

const turns = state.turns;
console.log("[store] turns =", turns.length, "tools =", state.toolsOrder.length, "metrics.toolCalls =", state.metrics.toolCalls);
assert.equal(turns.length, 4, "user1 + assistant1(done) + user2 + assistant2(error)");
assert.equal(turns[0].kind, "user");
assert.equal(turns[1].kind, "assistant");
assert.equal(turns[1].status, "done");
const aPart = turns[1].parts;
assert.ok(aPart.find((p) => p.kind === "thinking" && p.text.includes("先调")));
assert.ok(aPart.find((p) => p.kind === "tool" && p.toolCallId === "tc1"));
assert.ok(aPart.find((p) => p.kind === "text" && p.text.includes("找到")));
const tool = state.toolsById.get("tc1");
assert.equal(tool.status, "ok");
assert.ok(tool.details && tool.details.answer_type === "api_candidates", "details should be cached on tool");
assert.equal(state.docViewTurnId, null);
assert.equal(state.followBottom, true);
console.log("OK");

// ─── Workspace integration smokes (docs/22 + docs/23 §3-§10 + docs/24 §6/§7) ───
{
  const ws = await import("./lib/workspace.mjs");

  // (1) scenario_index 入口可达
  const idx = await ws.getScenarioIndex();
  assert.ok(idx, "scenario_index should exist");
  assert.equal(idx.scenarios?.length, 1, "phase1 scenario_count = 1");
  console.log("[workspace] scenario_index OK, scenarios =", idx.scenarios.length);

  // (2) marketing_insight 场景 10 节点 + 17 artifact 模板
  const sc = await ws.getScenario("marketing_insight");
  assert.ok(sc, "scenario marketing_insight should exist");
  assert.equal(sc.playbook?.nodes?.length, 10, "playbook should have 10 nodes");
  assert.ok((sc.artifact_templates?.length ?? 0) >= 1, "artifact_templates should be non-empty");
  console.log("[workspace] scenario nodes =", sc.playbook.nodes.length, "templates =", sc.artifact_templates.length);

  // (3) capability_map: 7 capability + 6 subject_kind
  const cmap = await ws.getCapabilityMap();
  assert.ok(cmap, "capability_map should exist");
  assert.equal(cmap.schema_version, "koif-capability-map-v1");
  assert.equal(Object.keys(cmap.capabilities || {}).length, 7, "phase1 should register 7 capabilities");
  assert.equal(Object.keys(cmap.subject_kinds || {}).length, 6, "phase1 should declare 6 subject_kinds");
  console.log("[workspace] capability_map OK");

  // (4) lint 状态机：unresolved_capability + subject_planned 至少各 1 条
  const cap_lint = await ws.lintCapabilityMapAgainstPlaybook("marketing_insight");
  const codes = new Set(cap_lint.lints.map((l) => l.code));
  assert.ok(codes.has("subject_planned"), "should flag planned subject_kind");
  assert.ok(codes.has("unresolved_capability"), "should flag unresolved capability");
  assert.ok(!codes.has("router_integrity_violation"), "should not violate router integrity");
  assert.ok(!codes.has("unknown_capability"), "C.5: playbook capability must align with capability_map");
  console.log("[workspace] capability lint codes =", [...codes].join(","));

  // (5) cross_node_ref 语法校验 + 切换品类 hash 变化
  const cnr = await ws.lintCrossNodeRefs("marketing_insight");
  assert.ok(Array.isArray(cnr.lints), "cross_node_ref lints should be array");
  // Phase 1 artifact_template 仍是 v0 空壳，预期全部 output_schema_absent（info），无 syntax error
  for (const l of cnr.lints) {
    assert.notEqual(l.code, "cross_node_ref_syntax", "no malformed cross_node_ref expected at phase 1");
  }
  const a = await ws.resolvePlaybookForCategory("marketing_insight");
  const b = await ws.resolvePlaybookForCategory("marketing_insight", "121364010");
  assert.ok(a.lints.some((l) => l.code === "category_default_universal"), "universal lint should fire");
  assert.notEqual(
    a.instance.__resolution.instance_hash,
    b.instance.__resolution.instance_hash,
    "instance_hash should change when category_id is provided",
  );
  console.log("[workspace] cross_node_ref lints =", cnr.lints.length, "; instance hash changes on category switch");
}
console.log("[workspace] all assertions passed");
