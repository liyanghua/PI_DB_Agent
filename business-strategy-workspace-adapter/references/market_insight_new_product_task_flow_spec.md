# Market Insight New Product Task Flow Spec

## Purpose

This spec defines the first complete scenario task flow for the market insight
strategy collection: `new_product_launch`.

The scenario maps the business strategy "淘宝/天猫新品开发" into a task
workspace that users can run, inspect, edit, and rerun node by node.

## Scenario Metadata

```json
{
  "scenario_id": "new_product_launch",
  "title": "淘宝/天猫新品开发",
  "source_collection": "marketing-insight-meta-strategy",
  "coverage_status": "explicit",
  "entry_strategy_skill": "biz-strategy/marketing-insight-kb-real"
}
```

Applicable situation:

```text
准备开发新品，但不知道做什么产品、什么价格、什么卖点、什么人群。
```

Core judgement:

```text
有搜索需求 + 有热销验证 + 有痛点可升级 + 有价格带空间 + 有竞品可对标。
```

## Node Flow

### 1. `define_scope`

Goal:

Define the analysis boundary before data collection.

Inputs:

- category
- target channel
- date range
- target price band, optional
- target customer or shop stage, optional

Runtime:

```text
strategy
```

Outputs:

- `analysis_scope.md`
- `analysis_scope.json`

Gate:

No hard gate. Missing category or date range makes the node `needs_input`.

Acceptance:

- The scope states category, platform, analysis period, goal, and known
  constraints.

### 2. `industry_top300_analysis`

Goal:

Understand mainstream product structure and hot-selling validation.

Runtime:

```text
pi_agent
```

Expected PI capability:

- tool selection for category market and top goods data
- future category analysis pack

Outputs:

- `industry_top300_summary.md`
- `mainstream_product_structure.json`

Failure policy:

If the category analysis capability is unavailable, record a placeholder
artifact and continue with manual evidence.

### 3. `keyword_demand_analysis`

Goal:

Identify demand strength, keyword clusters, demand types, and search evidence.

Runtime:

```text
pi_agent
```

Expected PI capability:

- `analyze_keyword_demand`

Outputs:

- `keyword_demand_table.json`
- `keyword_demand_summary.md`

Acceptance:

- Contains PI run id.
- Contains top demand keywords.
- Separates demand evidence from interpretation.

### 4. `review_qa_pain_analysis`

Goal:

Find high-frequency pain points and upgrade opportunities from reviews and Q&A.

Runtime:

```text
pi_agent`
```

Expected PI capability:

- future review / Q&A analysis pack
- tool selector fallback

Outputs:

- `pain_point_table.json`
- `upgrade_opportunity_summary.md`

Failure policy:

If unavailable, status becomes `blocked_by_pi_capability` and downstream nodes
can still use manual notes.

### 5. `price_band_opportunity`

Goal:

Determine the new product entry price band and product role.

Runtime:

```text
pi_agent
```

Expected PI capability:

- category/price band data tools
- competition pressure evidence

Outputs:

- `price_band_opportunity_table.json`
- `price_role_recommendation.md`

Acceptance:

- Distinguishes low-price traffic SKU, mid-price main SKU, high-price profit
  SKU, and blank-space test SKU.

### 6. `competitor_analysis`

Goal:

Select comparable competitors and identify breakthrough points.

Runtime:

```text
pi_agent
```

Expected PI capability:

- `analyze_keyword_competition`
- tool selector for competitor data

Outputs:

- `competitor_breakthrough_table.json`
- `competitor_analysis_summary.md`

Acceptance:

- Includes competitor strengths, weaknesses, our opportunity, and action.

### 7. `opportunity_score`

Goal:

Score whether the product opportunity is worth launching.

Runtime:

```text
pi_agent
```

Expected PI capability:

- `propose_koif_strategy`
- future `new_opportunity` / NOS score
- future `propose_koif_decision`

Outputs:

- `opportunity_scorecard.json`
- `opportunity_score_summary.md`

Gate:

`pi_decision_gate` if the scorecard requests a decision proposal.

Acceptance:

- Shows demand, trend, competition, profit proxy, supply feasibility, and
  differentiation evidence.
- If PI Decision Layer is unavailable, marks the decision portion as blocked
  instead of inventing it.

### 8. `launch_brief`

Goal:

Generate the new product launch brief from prior artifacts.

Runtime:

```text
strategy
```

Inputs:

- scope artifact
- keyword demand artifact
- pain point artifact
- price band artifact
- competitor artifact
- opportunity score artifact

Outputs:

- `new_product_launch_brief.md`
- `new_product_launch_brief.json`

Acceptance:

- Defines product direction, target user, scene, positioning, selling points,
  material/function, SKU, price, competitor, image direction, test metrics, and
  launch recommendation.

### 9. `link_planning`

Goal:

Turn the product brief into link planning.

Runtime:

```text
strategy
```

Outputs:

- `link_planning_table.json`
- `link_planning_summary.md`

Gate:

Requires approval of the launch brief.

### 10. `human_approval`

Goal:

Confirm whether to proceed to execution.

Runtime:

```text
human
```

Approval options:

```text
approve
reject
request_changes
```

This gate is mandatory before any browser, mobile, local computer, backend API,
budget, publish, price, listing, or ad operation.

## End-To-End Acceptance

For "刘海片新品开发":

- The task run creates 10 ordered nodes.
- Keyword demand, competitor analysis, and KOIF Router nodes can store PI run
  ids when executed.
- The user can edit an artifact and rerun the source node.
- Final launch brief cites both strategy evidence and PI data evidence.
- Human approval is required before execution-oriented steps.

