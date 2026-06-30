# Scenario Graph And Mission Spec

## Purpose

Scenario directories are independent compile units, but real business work often
requires several scenarios to complete a larger task. This spec adds two
top-level orchestration layers:

```text
Scenario Directory
  -> one scenario's docs, KB, schema tags, and playbook

Scenario Graph
  -> relationships among scenarios

Mission
  -> executable larger task that composes multiple scenarios
```

The goal is to let scenarios stay independently buildable while still making
cross-scenario dependencies, evidence flow, and human gates explicit.

## Recommended Directory Shape

```text
strategy-scenarios/
  scenario_directory_index.yaml
  scenario_graph.yaml
  missions/
    new_product_end_to_end.yaml
    seasonal_launch_planning.yaml
  shared/
    node_library.yaml
    artifact_templates.yaml
    runtime_profiles/

  category_market_analysis/
    scenario.yaml
    collection.yaml
    docs/

  price_band_layout/
    scenario.yaml
    collection.yaml
    docs/

  competitor_analysis/
    scenario.yaml
    collection.yaml
    docs/

  new_product_launch/
    scenario.yaml
    collection.yaml
    docs/

  visual_creative_planning/
    scenario.yaml
    collection.yaml
    docs/
```

`scenario_directory_index.yaml` answers "what scenarios exist".
`scenario_graph.yaml` answers "how scenarios relate".
`missions/*.yaml` answers "which scenarios run together for a larger job".

## Design Principles

- Keep scenario compilation independent.
- Put cross-scenario relations in a top-level graph, not inside individual
  documents.
- Pass durable artifacts between scenarios; do not share hidden runtime state.
- Preserve evidence provenance per scenario.
- Let missions create multiple TaskRuns or a MissionRun with child TaskRuns.
- Require explicit gates when a later scenario depends on human approval.
- Treat PI-Agent decision outputs as proposals until a gate approves them.

## scenario_graph.yaml

`scenario_graph.yaml` declares reusable relationships between scenarios.

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

  - relation_id: price_band_to_launch
    from: price_band_layout
    to: new_product_launch
    type: evidence_provider
    required: false
    reason: 新品定价和链接规划依赖价格带判断。
    handoff_artifacts:
      - artifact_id: price_band_opportunity_map
        as_input: target_price_band_context

  - relation_id: competitor_to_visual
    from: competitor_analysis
    to: visual_creative_planning
    type: prerequisite
    required: true
    reason: 主图和视觉策划需要参考竞品卖点和点击理由。
    handoff_artifacts:
      - artifact_id: competitor_signal_report
        as_input: competitor_visual_context

  - relation_id: launch_to_visual
    from: new_product_launch
    to: visual_creative_planning
    type: downstream
    required: true
    gate_dependency: launch_decision_gate
    reason: 新品定位确认后再生成主图方向。
```

### Relation Fields

Required fields:

| Field | Meaning |
| --- | --- |
| `relation_id` | Stable id for audit and UI display. |
| `from` | Upstream scenario id from `scenario_directory_index.yaml`. |
| `to` | Downstream scenario id from `scenario_directory_index.yaml`. |
| `type` | Relationship type. |
| `reason` | Human-readable business reason. |

Recommended fields:

| Field | Meaning |
| --- | --- |
| `required` | Whether the downstream scenario is blocked without this relation. |
| `handoff_artifacts` | Upstream artifacts that become downstream inputs. |
| `gate_dependency` | Gate id that must pass before this relation can activate. |
| `condition` | Optional expression or note for conditional routing. |
| `risk_note` | Why the relation needs review or may be unreliable. |

## Relation Types

| Type | Meaning | Runtime behavior |
| --- | --- | --- |
| `prerequisite` | Upstream scenario must complete first. | Blocks downstream until required outputs exist. |
| `evidence_provider` | Upstream provides useful evidence. | Adds context but may not block if `required: false`. |
| `downstream` | Downstream scenario follows from upstream outcome. | Shown as next recommended scenario. |
| `parallel` | Scenarios can run at the same time. | UI may offer parallel TaskRuns. |
| `alternative` | Scenarios are substitutes. | UI asks user or policy to choose one. |
| `refinement` | Downstream refines an upstream artifact. | Downstream starts from selected artifact version. |
| `shared_context` | Scenarios share business inputs or background. | Inputs can be copied but evidence stays separate. |
| `gate_dependency` | Relation depends on a gate result. | Blocks until gate is approved. |

## Artifact Handoff

Cross-scenario handoff must use explicit artifacts:

```yaml
handoff_artifacts:
  - artifact_id: price_band_opportunity_map
    version_policy: latest_approved
    as_input: target_price_band_context
    required: true
```

Allowed `version_policy` values:

| Value | Meaning |
| --- | --- |
| `latest_approved` | Use the newest artifact version approved by a gate. |
| `latest` | Use newest version, including user edits and reruns. |
| `pinned` | Use a specific version id declared by the mission run. |
| `manual_select` | User must choose the artifact version in UI. |

Do not pass raw node memory, chat transcript state, or unversioned runtime
variables across scenarios. Handoff must be inspectable and auditable.

## Mission Manifest

A mission composes scenarios into a larger business job.

```yaml
schema_version: business-strategy-mission-v1
mission_id: new_product_end_to_end
title: 新品开发全流程
description: 从市场机会判断到新品立项、链接规划和视觉方向的端到端任务。

inputs:
  required: [category, date_range]
  optional: [target_price_band, target_user, shop_stage]

scenario_plan:
  - scenario_id: category_market_analysis
    mode: blocking
    output_bindings:
      category_opportunity_report: market_opportunity_context

  - scenario_id: price_band_layout
    mode: blocking
    output_bindings:
      price_band_opportunity_map: target_price_band_context

  - scenario_id: competitor_analysis
    mode: blocking
    output_bindings:
      competitor_signal_report: competitor_context

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
      competitor_context: competitor_analysis.competitor_signal_report

gates:
  - gate_id: launch_decision_gate
    title: 新品立项确认
    after: new_product_launch
    required_before: [visual_creative_planning]
    type: human_review_gate
```

### Mission Fields

Required fields:

| Field | Meaning |
| --- | --- |
| `schema_version` | Must be `business-strategy-mission-v1`. |
| `mission_id` | Stable mission id. |
| `title` | User-facing mission title. |
| `scenario_plan` | Ordered or partially ordered scenario list. |

Recommended fields:

| Field | Meaning |
| --- | --- |
| `description` | When the user should choose this mission. |
| `inputs.required` | Inputs needed before the mission starts. |
| `inputs.optional` | Non-blocking inputs. |
| `gates` | Cross-scenario gates. |
| `success_criteria` | What must exist when the mission completes. |
| `failure_policy` | How to handle failed child scenarios. |

## Scenario Modes In Missions

| Mode | Meaning |
| --- | --- |
| `blocking` | Scenario must complete before the next dependent scenario starts. |
| `non_blocking` | Scenario can provide context if available. |
| `parallel` | Scenario may run concurrently with other parallel steps. |
| `after_gate` | Scenario waits for a named gate. |
| `manual` | User explicitly starts the scenario inside the mission. |
| `optional` | User may skip with a reason. |

## Mission Runtime Model

The runtime may implement a mission as:

```text
MissionRun
  -> child TaskRun: category_market_analysis
  -> child TaskRun: price_band_layout
  -> child TaskRun: competitor_analysis
  -> child TaskRun: new_product_launch
  -> child TaskRun: visual_creative_planning
```

Each child TaskRun keeps its own node runs, artifacts, gates, and audit log. The
MissionRun stores only orchestration state:

- mission inputs.
- child TaskRun ids.
- relation activations.
- artifact handoffs.
- cross-scenario gate results.
- mission-level audit events.

## Mission Output Contract

Compiled workspace packages may include:

```text
workspace-packages/
  scenario_index.json
  scenario_graph.json
  missions/
    new_product_end_to_end/mission.json
  scenarios/
    <scenario_id>/
      kb/
      schema/
      playbook/
```

`scenario_index.json` should include mission discovery metadata:

```json
{
  "schema_version": "business-strategy-scenario-index-v1",
  "scenarios": [],
  "missions": [
    {
      "mission_id": "new_product_end_to_end",
      "title": "新品开发全流程",
      "mission_path": "missions/new_product_end_to_end/mission.json",
      "scenario_ids": [
        "category_market_analysis",
        "price_band_layout",
        "competitor_analysis",
        "new_product_launch",
        "visual_creative_planning"
      ]
    }
  ],
  "scenario_graph_path": "scenario_graph.json"
}
```

## UI Behavior

PI-Agent or another Agent workspace UI should support two entrypoints:

- **Scenario workspace:** user chooses one scenario and creates one TaskRun.
- **Mission workspace:** user chooses one mission and creates one MissionRun
  with multiple child TaskRuns.

The UI should show:

- scenario graph overview.
- mission timeline.
- child TaskRun status.
- artifact handoff edges.
- gates that block downstream scenarios.
- provenance for each mission-level output.

## Validation Rules

The compiler should reject:

- relation `from` or `to` scenario ids missing from `scenario_directory_index`.
- duplicate `relation_id` values.
- mission scenario ids missing from `scenario_directory_index`.
- mission input bindings that reference unknown scenarios or artifacts.
- `after_gate` steps with missing `gate_dependency`.
- cycles made only of `prerequisite` or required `gate_dependency` relations.
- handoff artifacts that are not declared by the upstream scenario playbook or
  artifact templates.

The compiler should warn:

- optional evidence-provider relations without declared handoff artifacts.
- missions with no human review gate before state-changing downstream scenarios.
- alternative relations where no selection policy is declared.
- parallel scenarios that write the same named artifact.

## Acceptance Checklist

Acceptance requires:

- single scenarios remain independently buildable.
- `scenario_graph.yaml` can explain why two scenarios are connected.
- a mission can create a larger task from multiple scenarios.
- cross-scenario inputs come from versioned artifacts.
- gates can block downstream scenarios.
- mission outputs can trace back to child TaskRun ids, artifact versions, KB
  citations, and human gate records.
