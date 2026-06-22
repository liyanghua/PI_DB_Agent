import test from "node:test";
import { strict as assert } from "node:assert";
import { resolveKeywordUniverse } from "../src/services/keyword_competition/resolve.js";
import { validateProbeContext } from "../src/services/keyword_demand/live_pull.js";
import { shapeRawByApi } from "../src/services/keyword_demand/shape.js";
import type { ApiProbeResult } from "../src/services/api_runtime.js";
import type { CategoryContext } from "../src/services/keyword_competition/resolve.js";
import type { KeywordFieldMapping } from "../src/services/keyword_competition/types.js";

const ctx: CategoryContext = {
  category_name: "入户地垫",
  category_id: "121364010",
  tertiary_category: "入户地垫",
  resolution: "taxonomy",
};

const competitionMapping: KeywordFieldMapping = {
  version: 1,
  apis: {
    data_cust_ads_ad_flow_plan_goods_keyword_7d: {
      keyword_field: "kw_name",
      score_domain_hint: "competition",
      aggregation: {
        group_by: "kw_name",
        output_level: "keyword",
        keyword_field: "kw_name",
        derivations: {},
      },
    },
  },
};

test("competition live context rejects paid rows with mismatched cate_name and biz_date", () => {
  const probe: ApiProbeResult = {
    kind: "api_probe_result",
    api_id: "data_cust_ads_ad_flow_plan_goods_keyword_7d",
    method: "GET",
    path: "/data/cust/ads_ad_flow_plan_goods_keyword_7d",
    request: {
      url: "http://example.test",
      query: {
        tertiary_category: "入户地垫",
        start_date: "2025-09-01",
        end_date: "2025-09-30",
        business_date: "2026-05-01",
      },
      body: null,
      headers_keys: [],
      auth_inject: { header: [], body: [], query: [] },
    },
    status: { state: "ok", http: 200, elapsed_ms: 1 },
    response: {
      root: "data.result[]",
      total: 1,
      truncated: false,
      top: [{ kw_name: "tpu食品级餐桌垫", cate_name: "桌布", biz_date: "2026-01-25" }],
      sample_keys: ["kw_name", "cate_name", "biz_date"],
      raw_kind: "array",
    },
  };

  const result = validateProbeContext(probe, ctx, { start_date: "2025-09-01", end_date: "2025-09-30" });

  assert.equal(result?.status, "context_mismatch");
  assert.match(result?.hint ?? "", /cate_name/);
  assert.match(result?.hint ?? "", /biz_date/);
});

test("shape skips sanitized context-mismatch probes with total zero", () => {
  const probe: ApiProbeResult = {
    kind: "api_probe_result",
    api_id: "data_cust_ads_ad_flow_plan_goods_keyword_7d",
    method: "GET",
    path: "/data/cust/ads_ad_flow_plan_goods_keyword_7d",
    request: { url: "http://example.test", query: {}, body: null, headers_keys: [], auth_inject: { header: [], body: [], query: [] } },
    status: { state: "ok", http: 200, elapsed_ms: 1 },
    response: {
      root: "data.result[]",
      total: 0,
      truncated: false,
      top: [],
      sample_keys: [],
      raw_kind: "array",
    },
  };

  const shaped = shapeRawByApi({ data_cust_ads_ad_flow_plan_goods_keyword_7d: probe });

  assert.deepEqual(shaped.rawByApi.data_cust_ads_ad_flow_plan_goods_keyword_7d, undefined);
  assert.equal(shaped.report.per_api.data_cust_ads_ad_flow_plan_goods_keyword_7d.count, 0);
});

test("competition keyword universe prefers demand keywords over polluted paid keywords", () => {
  const result = resolveKeywordUniverse({
    paid_raw_by_api: {
      data_cust_ads_ad_flow_plan_goods_keyword_7d: [
        { kw_name: "流量智选-捡漏", cate_name: "入户地垫" },
        { kw_name: "桌垫", cate_name: "桌布" },
        { kw_name: "地垫防滑", cate_name: "入户地垫" },
      ],
    },
    competition_mapping: competitionMapping,
    tertiary_category: "入户地垫",
    demand_keywords: ["耐脏地垫", "地垫防滑"],
  });

  assert.deepEqual(result.universe, ["耐脏地垫", "地垫防滑"]);
  assert.equal(result.source, "demand_pack");
});

test("competition keyword universe filters paid package names and category-mismatched paid rows", () => {
  const result = resolveKeywordUniverse({
    paid_raw_by_api: {
      data_cust_ads_ad_flow_plan_goods_keyword_7d: [
        { kw_name: "流量智选-捡漏", cate_name: "入户地垫" },
        { kw_name: "桌垫", cate_name: "桌布" },
        { kw_name: "入户门垫", cate_name: "入户地垫" },
      ],
    },
    competition_mapping: competitionMapping,
    tertiary_category: "入户地垫",
  });

  assert.deepEqual(result.universe, ["入户门垫"]);
  assert.equal(result.source, "paid_kw_name");
});
