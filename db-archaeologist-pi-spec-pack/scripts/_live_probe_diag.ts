// _live_probe_diag.ts
// 真机 LIVE 诊断三合一：B.1 CPS context_mismatch / B.2 竞争域沙发垫窗口 / C.5b decision e2e。
//
// 必须在 Terminal.app 跑（沙箱无外网 + 无凭据）。命令：
//   cd <spec-pack> && LIVE_PROBE=true node --env-file=.env --import ./scripts/ts_loader.mjs scripts/_live_probe_diag.ts <stage>
// stage ∈ { b1 | b2 | c5b | all }，缺省 all。
// B.2 窗口可覆盖：DBA_COMP_START=YYYY-MM-DD DBA_COMP_END=YYYY-MM-DD（竞争域 date_format=month，自动截 YYYY-MM）。
// B.2 类目可覆盖：DBA_COMP_CATEGORY（缺省 沙发垫）。

import { analyzeKeywordCompetition } from "../src/services/keyword_competition/index.js";
import { proposeKoifStrategy } from "../src/services/koif_router/index.js";
import { proposeKoifDecision } from "../src/services/koif_decision/index.js";

const PAID_API = "data_cust_ads_ad_flow_plan_goods_keyword_7d";
const COMP_API = "data_competition_pattern_analysis";

type PerApi = Record<string, { status?: string; total?: number; http?: number; hint?: string; code?: unknown; msg?: unknown; note?: unknown; error?: unknown }>;

function dumpPerApi(per: PerApi | undefined): void {
  if (!per) {
    console.log("  (无 pull_report — 可能未走 LIVE 分支，检查 LIVE_PROBE=true)");
    return;
  }
  for (const [api, v] of Object.entries(per)) {
    const flag = v.status === "context_mismatch" ? "  ⟵ context_mismatch" : v.status === "ok" ? "  ✓" : "";
    console.log(`  - ${api}: status=${v.status} http=${v.http ?? "-"} total=${v.total ?? "-"}${flag}`);
    if (v.hint) console.log(`      hint: ${v.hint}`);
    if (v.code !== undefined || v.msg !== undefined) console.log(`      code=${String(v.code)} msg=${String(v.msg)}`);
    if (v.error) console.log(`      error: ${String(v.error)}`);
  }
}

async function stageB1(): Promise<void> {
  console.log("\n========== B.1 CPS context_mismatch（入户地垫 · 默认上一完整月）==========");
  const r = await analyzeKeywordCompetition({
    category: "入户地垫",
    category_id: "121364010",
    live: true,
    top_n: 30,
  });
  if ("error" in r) {
    console.log("ERROR:", r.error, "—", r.details ?? "");
    dumpPerApi(r.pull_report?.per_api as PerApi | undefined);
    return;
  }
  console.log(`run_id: ${r.run_id}`);
  console.log(`run_dir: ${r.run_dir}`);
  console.log(`date_range: ${JSON.stringify(r.pull_report?.date_range)}`);
  console.log(`cps_records_count: ${r.cps_records_count}  top_overall: ${r.top_overall.length}`);
  console.log("per_api:");
  dumpPerApi(r.pull_report?.per_api as PerApi | undefined);
  const per = r.pull_report?.per_api as PerApi | undefined;
  const paid = per?.[PAID_API];
  console.log(`\n[B.1 判定] 投流域 ${PAID_API}: status=${paid?.status ?? "缺失"}`);
  if (paid?.status === "context_mismatch") {
    console.log(`  → R-DATA-07 命中。hint 指明不对齐维度（类目/category_id/日期），据此决定改 normalize 容错还是改 mapping 窗口缺省。`);
  } else if (paid?.status === "ok") {
    console.log(`  → 投流域已闭环（total=${paid.total}）。R-DATA-07 解除。`);
  }
}

async function stageB2(): Promise<void> {
  const start = process.env.DBA_COMP_START ?? "2025-09-01";
  const end = process.env.DBA_COMP_END ?? "2025-09-30";
  const category = process.env.DBA_COMP_CATEGORY ?? "沙发垫";
  console.log(`\n========== B.2 竞争域窗口 LIVE（${category} · ${start}~${end}）==========`);
  const r = await analyzeKeywordCompetition({
    category,
    live: true,
    date_range: { start_date: start, end_date: end },
    top_n: 30,
  });
  if ("error" in r) {
    console.log("ERROR:", r.error, "—", r.details ?? "");
    dumpPerApi(r.pull_report?.per_api as PerApi | undefined);
    return;
  }
  console.log(`run_id: ${r.run_id}  category_id(resolved): ${r.category_id}`);
  console.log(`run_dir: ${r.run_dir}`);
  console.log("per_api:");
  dumpPerApi(r.pull_report?.per_api as PerApi | undefined);
  const per = r.pull_report?.per_api as PerApi | undefined;
  const comp = per?.[COMP_API];
  console.log(`\n[B.2 判定] 竞争域 ${COMP_API}: status=${comp?.status ?? "缺失"} total=${comp?.total ?? "-"}`);
  if (comp?.status === "ok" && (comp.total ?? 0) > 0) {
    console.log(`  → 该窗口/类目有数据，mapping 正确。证明原 business_empty 是窗口/类目本期真无数据，非 mapping 错。`);
  } else if (comp?.status === "business_empty") {
    console.log(`  → 仍 business_empty，换窗口（DBA_COMP_START/END）或类目（DBA_COMP_CATEGORY）再试。`);
  }
}

async function stageC5b(): Promise<void> {
  console.log("\n========== C.5b propose_koif_decision e2e（live router）==========");
  const router = await proposeKoifStrategy({
    category: "入户地垫",
    category_id: "121364010",
    capabilities: ["kds", "tms", "cps"],
    live: true,
    top_n: 10,
  });
  if ("error" in router) {
    console.log("router ERROR:", router.error, "—", router.details ?? "");
    console.log("capability statuses:", router.capability_runs?.map((c) => `${c.capability}=${c.status}`).join(", "));
    return;
  }
  console.log(`router_run_id: ${router.router_run_id}`);
  console.log("capability statuses:", router.capability_runs.map((c) => `${c.capability}=${c.status}`).join(", "));

  const r1 = await proposeKoifDecision({ router_run_id: "", decision_kind: "paid_test_plan" });
  console.log(`[1] 空 run_id → ${("error" in r1) ? r1.error : "未报错(异常)"}`);
  const r2 = await proposeKoifDecision({ router_run_id: router.router_run_id, decision_kind: "weird_unknown" });
  console.log(`[2] 非法 kind → ${("error" in r2) ? r2.error : "未报错(异常)"}`);
  const r3 = await proposeKoifDecision({ router_run_id: "router_does_not_exist", decision_kind: "paid_test_plan" });
  console.log(`[3] 不存在 run → ${("error" in r3) ? r3.error : "未报错(异常)"}`);
  const r4 = await proposeKoifDecision({ router_run_id: router.router_run_id, decision_kind: "paid_test_plan" });
  console.log(`[4] 真实 run + 合法 kind → ${JSON.stringify(r4)}`);
  console.log(`\n[C.5b 判定] 期望 [1]=router_run_id_required [2]=decision_kind_unsupported [3]=router_run_not_found [4]=decision_layer_phase3_stub`);
}

async function main(): Promise<void> {
  const stage = (process.argv[2] ?? "all").toLowerCase();
  if (process.env.LIVE_PROBE !== "true") {
    console.log("⚠️  LIVE_PROBE !== 'true'，所有出站会被闸门拦截。命令前加 LIVE_PROBE=true。");
  }
  if (stage === "b1" || stage === "all") await stageB1();
  if (stage === "b2" || stage === "all") await stageB2();
  if (stage === "c5b" || stage === "all") await stageC5b();
}

main().catch((err) => {
  console.error("诊断脚本异常：", err);
  process.exit(1);
});