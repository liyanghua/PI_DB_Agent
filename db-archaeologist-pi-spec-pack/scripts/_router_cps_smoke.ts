import { proposeKoifStrategy } from "../src/services/koif_router/index.js";
import { join } from "node:path";
import { readJson, ROOT } from "../src/lib/io.js";

const r = await proposeKoifStrategy({
  category: "入户地垫",
  category_id: "121364010",
  capabilities: ["kds", "tms", "cps"],
  live: false,
  top_n: 30,
});
if ("error" in r) {
  console.log("ERROR", JSON.stringify(r, null, 2));
  process.exit(1);
}
console.log("router_run_id:", r.router_run_id);
console.log("strategy_routes:", r.strategy_routes.map(s => ({ id: s.strategy_id, hits: s.hit_count, conf: s.confidence })));
console.log("next_actions:", r.next_actions.map(a => ({ id: a.action_id, kws: a.keywords.length, by: a.triggered_by })));
console.log("capability statuses:", r.capability_runs.map(c => `${c.capability}=${c.status}` + (c.reason ? `(${c.reason})` : "")));

const full = readJson<unknown[]>(join(ROOT, r.router_run_dir, "score_vector.json"));
const arr = full as Array<{ keyword: string; scores: Record<string, number>; cps_bucket?: string; cpc_source?: string }>;
const withCps = arr.filter(e => typeof e.scores.cps === "number");
const withKds = arr.filter(e => typeof e.scores.kds === "number");
const withTms = arr.filter(e => typeof e.scores.tms === "number");
console.log(`score_vector: total=${arr.length}, kds=${withKds.length}, tms=${withTms.length}, cps=${withCps.length}`);
console.log("CPS sample:");
for (const v of withCps.slice(0, 5)) {
  console.log("  ", v.keyword, "scores=", JSON.stringify(v.scores), "cps_bucket=", v.cps_bucket, "cpc_source=", v.cpc_source);
}