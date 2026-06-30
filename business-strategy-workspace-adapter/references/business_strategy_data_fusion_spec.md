# Business Strategy And Data Fusion Spec

## Purpose

This spec defines how business strategy language is mapped to data queries in
the Fusion Layer.

The key decision is that the Fusion Layer must not directly map natural
language snippets to APIs. It must first convert strategy language into a
structured evidence requirement, then delegate tool selection and data access to
the PI + DB Data Agent.

## Core Principle

Use an intermediate representation:

```text
strategy language snippet
  -> business schema tag
  -> business evidence need
  -> data query intent
  -> PI/Data Agent tool plan
  -> data evidence
  -> fused strategy answer
```

This avoids brittle prompt-to-API routing and keeps PI/DB as the owner of data
tool choice.

## Inputs

### Strategy Inputs

From generated strategy skills:

- `references/schema_tags.json`
- `references/kb_manifest.json`
- `references/source_map.json`
- `references/citations.json`
- `references/source_digest.md`

Relevant fields from `schema_tags.json`:

```json
{
  "perspectives": {
    "客户业务专家视角": {
      "tags": []
    },
    "经营增长目标维度": {
      "tags": []
    }
  }
}
```

Each tag may include:

- `field`
- `value`
- `evidence_quote`
- `confidence`
- `source_doc_id`
- `source_path`
- `kb_page_id`
- `citation_id`

### Data Agent Inputs

From the PI + DB spec-pack:

- API asset cards.
- tool registry.
- metric dictionary.
- domain mappings.
- KOIF route rules.
- analysis pack manifests.
- tool selection and API QA services.

Stable files:

```text
registry/derived/api_asset_cards.json
registry/derived/tool_registry.yaml
registry/metric_dictionary.seed.yaml
registry/keyword_field_mapping.yaml
registry/koif_route_rules.yaml
docs/08_API_QA_AND_TOOL_SELECTION_SPEC.md
docs/11_ANALYSIS_PACK_FRAMEWORK_SPEC.md
docs/15_KOIF_ROUTER_SPEC.md
docs/19_KOIF_DECISION_LAYER_SPEC.md
```

## Business Evidence Need

`business_evidence_need` is the bridge between strategy text and data queries.

Schema:

```json
{
  "need_id": "need_price_band_opportunity_001",
  "source_claim": "价格带中存在高增长但竞争较弱的机会，可以作为新品切入点。",
  "schema_perspective": "经营增长目标维度",
  "schema_field": "判断依据/指标",
  "business_signal": "price_band_opportunity",
  "entities": {
    "category": "刘海片",
    "keyword": null,
    "goods_id": null,
    "price_band": null
  },
  "data_needs": [
    {
      "metric_intent": "价格带销售增长",
      "metric_candidates": ["gmv_growth", "sales_growth", "pay_buyers_growth"],
      "domain": "类目域"
    },
    {
      "metric_intent": "竞争强度",
      "metric_candidates": ["competitor_count", "top_concentration", "cps"],
      "domain": "竞争域"
    }
  ],
  "query_constraints": {
    "time_range": "最近30天或最近90天",
    "granularity": "price_band",
    "compare_mode": "环比/同比/同类目对比"
  },
  "expected_decision": "判断是否值得切入该价格带",
  "provenance": {
    "source_doc_id": "price-band-standard",
    "citation_id": "cite-price-band-standard-001"
  }
}
```

## Mapping Layers

### Layer 1: Strategy Language To Business Signal

This layer reads schema tags and evidence quotes. It classifies the business
meaning of a claim.

Examples:

| Strategy language | Business signal |
| --- | --- |
| 搜索人气增长、供需比高 | `demand_strength_signal` |
| 搜索增长持续、跨平台热度上升 | `trend_momentum_signal` |
| 评价/问大家反复出现痛点 | `customer_pain_signal` |
| 竞品卖点集中但未覆盖某需求 | `competitor_gap_signal` |
| 价格带增长但竞争弱 | `price_band_opportunity` |
| 主图点击差、视觉卖点不清 | `visual_conversion_signal` |
| 高需求低竞争 | `blue_ocean_signal` |
| 强需求高竞争 | `competition_warning_signal` |

### Layer 2: Business Signal To Metric Intent

This layer turns business signals into data evidence needs.

Examples:

| Business signal | Metric intents |
| --- | --- |
| `demand_strength_signal` | search popularity, demand supply ratio, pay buyers, KDS |
| `trend_momentum_signal` | search growth, pay growth, trend persistence, TMS |
| `customer_pain_signal` | negative review topics, QA frequency, pain point count |
| `competitor_gap_signal` | competitor count, feature coverage, CPS |
| `price_band_opportunity` | price band GMV, growth, competitor density, profit proxy |
| `visual_conversion_signal` | main image CTR, click rate, conversion rate, visual element |
| `blue_ocean_signal` | BDS, demand supply ratio, competition pressure |
| `competition_warning_signal` | CPS, market average bid, brand concentration |

### Layer 3: Metric Intent To Data Agent Tool Plan

This layer does not select raw APIs. It asks the Data Agent to select tools.

Preferred Data Agent tools:

- `select_tools_for_task`
- `ask_api_catalog`
- `get_api_asset_card`
- `explain_tool_lineage`
- `list_domain_apis`
- `list_api_quality_issues`
- `analyze_keyword_demand`
- `analyze_keyword_trend`
- `analyze_keyword_competition`
- `propose_koif_strategy`
- `propose_koif_decision` when decision-layer prerequisites are satisfied.

Tool selection request shape:

```json
{
  "task": "验证刘海片类目是否存在价格带机会，需要查询价格带增长、竞争强度和利润空间代理指标。",
  "known_params": {
    "category": "刘海片",
    "date_range": {
      "start_date": "2026-05-01",
      "end_date": "2026-05-31"
    }
  }
}
```

Expected Data Agent response:

```json
{
  "recommended_tools": [
    {
      "tool_id": "get_competition_pattern",
      "reason": "查询价格带竞品和竞争格局",
      "required_params": ["tertiary_category", "business_date"],
      "missing_params": [],
      "source_apis": ["data_competition_pattern_analysis"],
      "quality_score": 0.838
    }
  ],
  "blocked_or_deprioritized": [],
  "next_question": null
}
```

## Fusion Output

The Fusion Layer should emit an auditable evidence plan before or alongside
runtime data calls.

```json
{
  "claim_id": "claim_price_band_opportunity_001",
  "source_doc": "价格带市场结构判断标准.md",
  "source_quote": "价格带增长但竞争弱时，可优先判断机会空间。",
  "business_signal": "price_band_opportunity",
  "evidence_needs": ["价格带增长", "竞争强度", "利润空间"],
  "tool_plan": [
    {
      "tool": "select_tools_for_task",
      "purpose": "选择价格带与竞争格局相关工具"
    },
    {
      "tool": "get_competition_pattern",
      "purpose": "查询价格带竞品和竞争强度"
    },
    {
      "tool": "propose_koif_strategy",
      "purpose": "综合需求、趋势、竞争形成经营策略"
    }
  ],
  "required_params": ["category", "date_range"],
  "missing_params": [],
  "approval_required": false
}
```

After data queries finish, the fused answer should include:

- source document evidence.
- data evidence.
- API/tool lineage.
- metric definitions.
- missing or weak evidence.
- action options.

## Business Signal Mapping File

Recommended portable file:

```text
references/business_signal_mapping.yaml
```

Example:

```yaml
signals:
  price_band_opportunity:
    schema_fields:
      - 判断依据/指标
      - 判断标准
      - 建议动作
      - 执行条件
    language_hints:
      - 价格带
      - 利润空间
      - 高增长
      - 竞争较弱
      - 切入机会
    metric_intents:
      - name: price_band_growth
        metrics: [gmv_growth, sales_growth, pay_buyers_growth]
        domain: 类目域
      - name: competition_pressure
        metrics: [cps, competitor_count, brand_concentration]
        domain: 竞争域
    preferred_tools:
      - select_tools_for_task
      - get_competition_pattern
      - propose_koif_strategy
    required_params:
      - category
      - date_range
```

This file should be versioned and reviewed like schema. It is the main place to
encode business-language-to-data-intent knowledge.

## Parameter Policy

The Fusion Layer must never silently invent operational parameters.

Parameter classes:

- source parameters: category, keyword, goods id, price band, platform.
- time parameters: date range, compare window, granularity.
- scope parameters: shop, category, competitor set, product set.
- decision parameters: budget, risk tolerance, ROI threshold.

If a required parameter is missing:

- produce `missing_params`.
- ask the user or call a resolver tool if one exists.
- do not run state-changing actions.

## Quality And Safety Policy

Data calls must respect PI/DB quality gates:

- prefer `verified` and `agent_ready` assets.
- use candidate APIs only through business wrappers.
- do not expose blocked APIs unless debug mode is explicit.
- report low confidence when data source quality is weak.
- separate read-only evidence gathering from execution.

State-changing execution requires:

- preview.
- explicit confirmation.
- target and payload display.
- rollback or recovery note.
- provenance from strategy claim to data evidence.

## Example: Market Insight For 刘海片

Question:

```text
刘海片这个品类，当前是否有新品机会？
```

Fusion steps:

1. Load strategy skill for market insight.
2. Retrieve tags for `对象`, `判断指标`, `判断标准`, `建议动作`, `验证方式`.
3. Identify signals:
   - demand strength.
   - trend momentum.
   - customer pain.
   - competitor gap.
   - price band opportunity.
4. Build evidence needs:
   - KDS / demand metrics.
   - TMS / trend metrics.
   - CPS / competition metrics.
   - review and QA pain point metrics.
   - price band growth and profit proxy.
5. Ask Data Agent for tool plan.
6. Run read-only tools or ask for missing parameters.
7. Fuse document evidence and data evidence.
8. Return:
   - opportunity verdict.
   - supporting metrics.
   - weak or missing evidence.
   - next actions.

## Non-Goals

- Do not replace OpenKB retrieval.
- Do not bypass the PI/DB Data Agent by selecting raw APIs directly.
- Do not implement budget, bidding, or ROI decisions in the strategy compiler.
- Do not automatically execute browser/mobile/computer actions.
- Do not write strategy conclusions back to source docs without review.

