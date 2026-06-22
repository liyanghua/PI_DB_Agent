import { proposeKoifDecision } from "../src/services/koif_decision/index.js";
import { proposeKoifStrategy } from "../src/services/koif_router/index.js";

// 1) 缺 router_run_id → router_run_id_required
const r1 = await proposeKoifDecision({ router_run_id: "", decision_kind: "paid_test_plan" });
console.log("[1] missing run_id:", JSON.stringify(r1));

// 2) 非法 decision_kind → decision_kind_unsupported
const r2 = await proposeKoifDecision({ router_run_id: "fake_id", decision_kind: "weird_unknown" });
console.log("[2] bad kind:", JSON.stringify(r2));

// 3) router_run_id 不存在 → router_run_not_found
const r3 = await proposeKoifDecision({
  router_run_id: "router_does_not_exist",
  decision_kind: "paid_test_plan",
});
console.log("[3] no run:", JSON.stringify(r3));

// 4) 真实 router_run + 合法 kind → decision_layer_phase3_stub
const r = await proposeKoifStrategy({
  category: "入户地垫",
  category_id: "121364010",
  capabilities: ["kds", "tms", "cps"],
  live: false,
  top_n: 10,
});
if ("error" in r) {
  console.log("router err:", r);
} else {
  const r4 = await proposeKoifDecision({
    router_run_id: r.router_run_id,
    decision_kind: "paid_test_plan",
  });
  console.log("[4] phase3 stub:", JSON.stringify(r4));
}