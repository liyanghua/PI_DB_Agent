# Declarative Manifest Spec

## Purpose

This spec defines the manifest files needed for multi-business-strategy and
multi-scenario workspace compilation.

The goal is to add new strategy collections and scenarios without editing
compiler code.

## Directory Convention

Preferred new input shape:

```text
strategy-scenarios/
  scenario_directory_index.yaml
  scenario_graph.yaml
  missions/
    new_product_end_to_end.yaml
  shared/
    node_library.yaml
    artifact_templates.yaml
    runtime_profiles/
      pi_agent_v1.yaml
  <scenario_id>/
    scenario.yaml
    collection.yaml
    docs/
```

See `scenario_directory_input_spec.md` for the canonical structure. The
manifest files below remain useful as shared libraries and for bundle-style
compilation.

```text
references/
  manifests/
    bundle_registry.yaml
    node_library.yaml
    runtime_profiles/
      pi_agent_v1.yaml
      hermes_strategy_v1.yaml
    scenarios/
      marketing_insight.yaml
      product_optimization.yaml
```

These files are compile-time declarations. Generated bundles should contain
JSON outputs for runtime consumption.

## scenario_directory_index.yaml

This is the preferred top-level input for new strategy documents.

```yaml
schema_version: business-strategy-scenario-directory-index-v1
id: ecommerce-market-strategy-scenarios
title: 电商经营策略场景集合
root: strategy-scenarios
schema_path: ../docs/biz_spec/元策略规范.md
default_runtime_profile: pi_agent_v1

shared:
  node_library: shared/node_library.yaml
  artifact_templates: shared/artifact_templates.yaml
  runtime_profiles:
    pi_agent_v1: shared/runtime_profiles/pi_agent_v1.yaml

scenario_graph: scenario_graph.yaml
missions:
  - missions/new_product_end_to_end.yaml

scenarios:
  - scenario_id: new_product_launch
    title: 淘宝/天猫新品开发
    path: new_product_launch
    collection: collection.yaml
    scenario_manifest: scenario.yaml
    coverage_status: explicit
    runtime_profile: pi_agent_v1
    tags: [market-insight, product-development]
```

Rules:

- `path` resolves relative to index `root`.
- `collection` defaults to `collection.yaml`.
- `scenario_manifest` defaults to `scenario.yaml`.
- each listed directory is independently buildable.
- shared manifests are read-only compile inputs.
- `scenario_graph` is optional unless missions depend on cross-scenario
  relations.
- `missions` is optional for pure single-scenario packages.
- generated output must include a global `scenario_index.json`.

## scenario_graph.yaml

Declares relationships between scenarios.

```yaml
schema_version: business-strategy-scenario-graph-v1
graph_id: ecommerce-market-strategy-graph
title: 电商经营策略场景关系图

relations:
  - relation_id: category_to_launch
    from: category_market_analysis
    to: new_product_launch
    type: prerequisite
    required: true
    reason: 新品立项前需要先判断类目机会和市场空间。
    handoff_artifacts:
      - artifact_id: category_opportunity_report
        as_input: market_opportunity_context

  - relation_id: launch_to_visual
    from: new_product_launch
    to: visual_creative_planning
    type: downstream
    required: true
    gate_dependency: launch_decision_gate
    reason: 新品定位确认后再生成主图方向。
```

Allowed relation types:

```text
prerequisite
evidence_provider
downstream
parallel
alternative
refinement
shared_context
gate_dependency
```

See `scenario_graph_and_mission_spec.md` for the full contract.

## missions/<mission_id>.yaml

Declares a larger business task composed from scenarios.

```yaml
schema_version: business-strategy-mission-v1
mission_id: new_product_end_to_end
title: 新品开发全流程

inputs:
  required: [category, date_range]
  optional: [target_price_band, target_user, shop_stage]

scenario_plan:
  - scenario_id: category_market_analysis
    mode: blocking

  - scenario_id: price_band_layout
    mode: blocking

  - scenario_id: competitor_analysis
    mode: blocking

  - scenario_id: new_product_launch
    mode: blocking
    input_bindings:
      market_opportunity_context: category_market_analysis.category_opportunity_report
      target_price_band_context: price_band_layout.price_band_opportunity_map
      competitor_context: competitor_analysis.competitor_signal_report

  - scenario_id: visual_creative_planning
    mode: after_gate
    gate_dependency: launch_decision_gate
    input_bindings:
      launch_brief: new_product_launch.launch_brief

gates:
  - gate_id: launch_decision_gate
    title: 新品立项确认
    after: new_product_launch
    required_before: [visual_creative_planning]
    type: human_review_gate
```

Allowed scenario modes:

```text
blocking
non_blocking
parallel
after_gate
manual
optional
```

## bundle_registry.yaml

Declares strategy bundles to compile. This is the older bundle-centric shape.
For newly authored business strategy documents, prefer
`scenario_directory_index.yaml`. Use `bundle_registry.yaml` only when an older
source set is naturally maintained as one large method bundle with many
internal scenarios.

```yaml
schema_version: business-strategy-bundle-registry-v1
bundles:
  - bundle_id: marketing-insight
    title: 市场分析洞察元策略
    collection: docs/biz_spec/marketing_insight/collection.yaml
    scenario_manifest: references/manifests/scenarios/marketing_insight.yaml
    runtime_profile: pi_agent_v1
    output_slug: marketing-insight

  - bundle_id: product-optimization
    title: 商品优化元策略
    collection: docs/biz_spec/product_optimization/collection.yaml
    scenario_manifest: references/manifests/scenarios/product_optimization.yaml
    runtime_profile: pi_agent_v1
    output_slug: product-optimization
```

## node_library.yaml

Declares reusable nodes.

```yaml
schema_version: business-strategy-node-library-v1
nodes:
  define_scope:
    title: 明确分析边界
    runtime: strategy
    input_schema:
      required: [category, date_range]
    runtime_request:
      kind: hermes_request
      expected_output: analysis_scope
    artifact_templates: [analysis_scope]
    failure_policy: request_user_input
    rerun_policy: allowed

  keyword_demand_analysis:
    title: 关键词需求分析
    runtime: pi_agent
    input_schema:
      required: [category, date_range]
    runtime_request:
      kind: pi_agent_request
      capability: keyword_demand
      tool: analyze_keyword_demand
    artifact_templates: [keyword_demand_table, keyword_demand_summary]
    failure_policy: record_failure_and_block_dependents
    rerun_policy: allowed
```

## scenarios/<bundle>.yaml

Declares scenarios for one strategy bundle. In the preferred
scenario-directory model, this information moves into each directory's
`scenario.yaml`.

```yaml
schema_version: business-strategy-scenario-manifest-v1
bundle_id: marketing-insight
title: 市场分析洞察元策略
default_runtime_profile: pi_agent_v1

scenarios:
  - scenario_id: new_product_launch
    title: 淘宝/天猫新品开发
    coverage_status: explicit
    source_evidence:
      doc_id: main
      section: 子场景1：淘宝 / 天猫新品开发
    node_sequence:
      - define_scope
      - industry_top300_analysis
      - keyword_demand_analysis
      - review_qa_pain_analysis
      - price_band_opportunity
      - competitor_analysis
      - opportunity_score
      - launch_brief
      - link_planning
      - human_approval

  - scenario_id: visual_creative_planning
    title: 主图与视觉策划
    coverage_status: explicit
    source_evidence:
      doc_id: main
      section: 子场景4：主图与视觉策划
    node_sequence:
      - define_scope
      - keyword_demand_analysis
      - competitor_visual_analysis
      - first_click_reason
      - visual_direction_brief
      - human_approval
```

## <scenario_id>/scenario.yaml

Declares one workspace scenario inside a scenario directory.

```yaml
schema_version: business-strategy-scenario-v1
scenario_id: new_product_launch
title: 淘宝/天猫新品开发
description: 面向新品开发立项、机会判断、链接规划的可执行流程。
coverage_status: explicit
business_goal: 生成新品开发立项与链接规划。
runtime_profile: pi_agent_v1

inputs:
  required: [category, date_range]
  optional: [target_price_band, target_user, shop_stage]

node_sequence:
  - define_scope
  - industry_top300_analysis
  - keyword_demand_analysis
  - review_qa_pain_analysis
  - price_band_opportunity
  - competitor_analysis
  - opportunity_score
  - launch_brief
  - link_planning
  - human_approval

source_evidence:
  entry_doc_id: main
  anchor: 子场景1：淘宝 / 天猫新品开发
```

The compiler should validate `node_sequence` against `node_library.yaml`, apply
runtime mappings from the selected profile, then write one `playbook.json` for
the scenario.

## runtime_profiles/<profile>.yaml

Maps logical runtime requests to a specific Agent runtime.

```yaml
schema_version: business-strategy-runtime-profile-v1
profile_id: pi_agent_v1
runtime: pi_agent

tool_mappings:
  keyword_demand_analysis:
    tool: analyze_keyword_demand
    capability: keyword_demand
    result_refs:
      run_id: $.run_id
      report_path: $.summary_path

  competitor_analysis:
    tool: analyze_keyword_competition
    capability: keyword_competition
    result_refs:
      run_id: $.run_id
      report_path: $.summary_path

  opportunity_score:
    tool: propose_koif_strategy
    capability: koif_router
    result_refs:
      router_run_id: $.router_run_id
```

## artifact_templates.yaml

Optional shared artifact declaration.

```yaml
schema_version: business-strategy-artifact-template-v1
artifacts:
  analysis_scope:
    title: 分析范围
    content_type: markdown
    editable: true
    versioning: append_only

  keyword_demand_table:
    title: 关键词需求表
    content_type: json
    editable: true
    versioning: append_only
```

## Validation Rules

The compiler should reject manifests when:

- a scenario references an unknown node id.
- a node references an unknown artifact template.
- a PI-Agent node has no runtime mapping in the selected profile.
- a required `collection.yaml` does not exist.
- two scenarios in one bundle share the same `scenario_id`.
- a `coverage_status` is not one of `explicit`, `inferred`, `manual`, or
  `experimental`.

The compiler should warn, not fail, when:

- a scenario has `inferred` or `manual` coverage.
- a runtime capability is declared but not available in a target runtime.
- a scenario has no source evidence.
