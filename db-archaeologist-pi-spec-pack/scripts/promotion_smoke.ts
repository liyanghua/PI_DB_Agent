// scripts/promotion_smoke.ts — fixture-driven smoke for promotion + backfill
//
// 不依赖任何持久化数据；构造若干 ApiAssetCard 走 detector / applier，
// 断言 gap/fix/promote_to 与 lifecycle 推进路径。

import assert from "node:assert/strict";
import type { ApiAssetCard } from "../src/lib/types.js";
import { analyzePromotion, inferFieldsFromExample } from "../src/services/promotion.js";
import { applyBackfill } from "../src/services/backfill.js";

function mk(over: Partial<ApiAssetCard>): ApiAssetCard {
  return {
    api_id: "fx_a",
    source_seq: 1,
    name: "fx",
    module: "demo",
    domain: "商品域",
    method: "POST",
    path: "/api/demo",
    lifecycle_status: "candidate",
    quality_score: 0.4,
    request_schema: { query: [], body: [], headers: ["x-ca-appCode"], path_params: [] },
    response_schema: { root: "data", fields: [], example: null },
    ...over,
  };
}

// ── detector ──
const cards: ApiAssetCard[] = [
  mk({
    api_id: "fx_only_example",
    response_schema: { root: "data", fields: [], example: { code: 0, data: { result: [{ id: 1, name: "a" }] } } },
  }),
  mk({
    api_id: "fx_only_fields",
    response_schema: { root: "data", fields: [{ path: "data.x", name: "x", type: "string" }], example: null },
  }),
  mk({
    api_id: "fx_neither",
    response_schema: { root: "data", fields: [], example: null },
  }),
  mk({ api_id: "fx_path_ph", path: "/api/{table}/rows" }),
  mk({ api_id: "fx_no_param", request_schema: { query: [], body: [], headers: [], path_params: [] } }),
];

const rep = analyzePromotion(cards);
const planById = new Map(rep.plans.map((p) => [p.api_id, p]));

assert.ok(planById.get("fx_only_example")!.gaps.includes("response_fields_missing"));
assert.ok(planById.get("fx_only_example")!.fix_hints.includes("infer_fields_from_example"));
assert.equal(planById.get("fx_only_example")!.promote_to, "verified");

assert.ok(planById.get("fx_only_fields")!.gaps.includes("response_example_missing"));
assert.ok(planById.get("fx_only_fields")!.fix_hints.includes("probe_then_infer"));

assert.ok(planById.get("fx_neither")!.gaps.includes("response_both_missing"));
assert.equal(planById.get("fx_neither")!.promote_to, "candidate");

assert.equal(planById.get("fx_path_ph")!.promote_to, "blocked");
assert.ok(planById.get("fx_path_ph")!.blockers.includes("path_placeholder"));

assert.ok(planById.get("fx_no_param")!.gaps.includes("param_undocumented"));

console.log("[detector] OK", rep.byPromote);

// ── inferFieldsFromExample ──
const inf = inferFieldsFromExample({ code: 0, data: { result: [{ id: 1, name: "x", price: 1.2, tags: ["a"] }] } });
const paths = inf.map((f) => f.path).sort();
assert.ok(paths.includes("data.code"));
assert.ok(paths.includes("data.data.result[].id"));
assert.ok(paths.includes("data.data.result[].name"));
console.log("[infer] paths", paths.length);

// ── applier: example_only path ──
{
  const before = mk({
    api_id: "fx_only_example",
    response_schema: { root: "data", fields: [], example: { code: 0, data: { result: [{ id: 1 }] } } },
  });
  const { cards: after, report } = applyBackfill([before]);
  assert.equal(report.changed.length, 1);
  assert.equal(report.changed[0].source, "example_only");
  assert.ok((after[0].response_schema?.fields.length ?? 0) > 0);
}

// ── applier: probe_payload path ──
{
  const before = mk({ api_id: "fx_neither", response_schema: { root: "data", fields: [], example: null } });
  const sample = {
    api_id: "fx_neither",
    response: { http: 200, elapsed_ms: 120, payload: { code: 0, data: { result: [{ id: 1, name: "n" }] } } },
  };
  const { cards: after, report } = applyBackfill([before], { samples: [sample] });
  assert.equal(report.changed.length, 1);
  assert.equal(report.changed[0].source, "probe_payload");
  const fields = after[0].response_schema?.fields ?? [];
  assert.ok(fields.length >= 3);
  assert.ok(after[0].response_schema?.example);
}

// ── applier: probe http=500 should be skipped ──
{
  const before = mk({ api_id: "fx_neither2", response_schema: { root: "data", fields: [], example: null } });
  const { report } = applyBackfill([before], {
    samples: [{ api_id: "fx_neither2", response: { http: 500, payload: { err: "x" } } }],
  });
  assert.equal(report.changed.length, 0);
  assert.equal(report.skipped.length, 1);
}

console.log("[applier] OK");
console.log("OK");