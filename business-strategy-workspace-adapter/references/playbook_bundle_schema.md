# Playbook Bundle Schema

## scenario_catalog.json

```json
{
  "schema_version": "business-strategy-playbook-bundle-v1",
  "bundle_id": "marketing-insight",
  "title": "市场分析洞察元策略",
  "source_kb": "kb_manifest.json",
  "scenarios": [
    {
      "scenario_id": "new_product_launch",
      "title": "淘宝/天猫新品开发",
      "coverage_status": "explicit",
      "playbook_path": "playbooks/new_product_launch/playbook.json",
      "runtime_targets": ["strategy", "pi_agent", "human"]
    }
  ]
}
```

## Scenario Directory Output

For new strategy documents, the primary output is scenario-directory based:

```text
workspace-packages/
  scenario_index.json
  scenario_graph.json
  missions/
    new_product_end_to_end/
      mission.json
  shared/
    node_library.json
    artifact_templates/
    runtime_profiles/
  scenarios/
    new_product_launch/
      scenario_manifest.json
      kb/
      schema/
      playbook/
    visual_creative_planning/
      scenario_manifest.json
      kb/
      schema/
      playbook/
```

`scenario_index.json` is the UI and PI-Agent import entrypoint:

```json
{
  "schema_version": "business-strategy-scenario-index-v1",
  "input_model": "scenario_directory_index",
  "scenario_graph_path": "scenario_graph.json",
  "scenarios": [
    {
      "scenario_id": "new_product_launch",
      "title": "淘宝/天猫新品开发",
      "coverage_status": "explicit",
      "scenario_path": "scenarios/new_product_launch",
      "playbook_path": "scenarios/new_product_launch/playbook/playbook.json",
      "kb_manifest_path": "scenarios/new_product_launch/kb/kb_manifest.json",
      "schema_tags_path": "scenarios/new_product_launch/schema/schema_tags.json"
    }
  ],
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
  ]
}
```

## mission.json

```json
{
  "schema_version": "business-strategy-mission-v1",
  "mission_id": "new_product_end_to_end",
  "title": "新品开发全流程",
  "inputs": {
    "required": ["category", "date_range"],
    "optional": ["target_price_band", "target_user", "shop_stage"]
  },
  "scenario_plan": [
    {
      "scenario_id": "category_market_analysis",
      "mode": "blocking"
    },
    {
      "scenario_id": "new_product_launch",
      "mode": "blocking",
      "input_bindings": {
        "market_opportunity_context": "category_market_analysis.category_opportunity_report"
      }
    },
    {
      "scenario_id": "visual_creative_planning",
      "mode": "after_gate",
      "gate_dependency": "launch_decision_gate"
    }
  ],
  "gates": [
    {
      "gate_id": "launch_decision_gate",
      "type": "human_review_gate",
      "after": "new_product_launch",
      "required_before": ["visual_creative_planning"]
    }
  ]
}
```

## scenario_graph.json

```json
{
  "schema_version": "business-strategy-scenario-graph-v1",
  "relations": [
    {
      "relation_id": "category_to_launch",
      "from": "category_market_analysis",
      "to": "new_product_launch",
      "type": "prerequisite",
      "required": true,
      "handoff_artifacts": [
        {
          "artifact_id": "category_opportunity_report",
          "as_input": "market_opportunity_context"
        }
      ]
    }
  ]
}
```

## Legacy Multi-Bundle Output

For multiple strategy collections, the adapter should emit a package root:

```text
workspace-packages/
  scenario_index.json
  packages/
    marketing-insight/
      scenario_catalog.json
      playbooks/
      artifact_templates/
      gate_policy.json
    product-optimization/
      scenario_catalog.json
      playbooks/
      artifact_templates/
      gate_policy.json
```

`scenario_index.json` is the cross-bundle UI entrypoint:

```json
{
  "schema_version": "business-strategy-scenario-index-v1",
  "bundles": [
    {
      "bundle_id": "marketing-insight",
      "title": "市场分析洞察元策略",
      "package_path": "packages/marketing-insight",
      "scenario_count": 10
    }
  ],
  "scenarios": [
    {
      "bundle_id": "marketing-insight",
      "scenario_id": "new_product_launch",
      "title": "淘宝/天猫新品开发",
      "coverage_status": "explicit",
      "playbook_path": "packages/marketing-insight/playbooks/new_product_launch/playbook.json"
    }
  ]
}
```

The current single-bundle schema remains valid. Legacy multi-bundle export
wraps many single-bundle packages and adds the index. New authoring should
prefer scenario-directory output.

## playbook.json

```json
{
  "schema_version": "business-strategy-playbook-v1",
  "scenario_id": "new_product_launch",
  "title": "淘宝/天猫新品开发",
  "nodes": [
    {
      "node_id": "define_scope",
      "title": "明确分析边界",
      "runtime": "strategy",
      "depends_on": [],
      "input_schema": {
        "required": ["category", "date_range"]
      },
      "runtime_request": {
        "kind": "hermes_request"
      },
      "artifact_templates": ["analysis_scope"],
      "failure_policy": "request_user_input",
      "rerun_policy": "allowed"
    }
  ],
  "gates": []
}
```

## artifact template

```json
{
  "artifact_id": "analysis_scope",
  "title": "分析范围",
  "content_type": "markdown",
  "versioning": "append_only",
  "editable": true
}
```

## gate_policy.json

```json
{
  "schema_version": "business-strategy-gate-policy-v1",
  "default_state_changing_action_gate": "execution_approval_gate",
  "requires_human_review": [
    "budget",
    "pricing",
    "publish",
    "listing_edit",
    "browser_mutation",
    "mobile_mutation",
    "api_mutation"
  ]
}
```
