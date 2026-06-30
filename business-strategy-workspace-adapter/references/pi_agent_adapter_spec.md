# PI-Agent Workspace Adapter Spec

## Purpose

This reference defines how a compiled strategy playbook bundle is exported for
PI-Agent without coupling PI-Agent to OpenKB or raw strategy documents.

## Input

For new scenario-directory packages, PI-Agent consumes a workspace package root:

```text
scenario_index.json
scenario_graph.json
missions/<mission_id>/mission.json
scenarios/<scenario_id>/
  scenario_manifest.json
  kb/
  schema/
  playbook/
```

The UI should read `scenario_index.json` first, then let the user choose either:

- one scenario, which creates one TaskRun.
- one mission, which creates one MissionRun with child TaskRuns.

Legacy input remains a playbook bundle:

```text
scenario_catalog.json
playbooks/<scenario_id>/playbook.json
shared_node_library.json
business_signal_mapping.yaml
data_agent_request_templates.json
gate_policy.json
artifact_templates/
```

## Output

The PI-Agent export is a filesystem package:

```text
scenario_workspace/
  adapter_manifest.json
  scenario_index.json
  scenario_graph.json
  missions/
    new_product_end_to_end/
      mission.json
  scenarios/
    new_product_launch/
      scenario_manifest.json
      playbook/playbook.json
      schema/schema_tags.json
      kb/kb_manifest.json
  artifact_templates/
  gate_policy.json
  runtime_contract.json
```

PI-Agent can import this package into:

```text
registry/derived/scenario_workspace/
  missions/<mission_id>/
  scenarios/<scenario_id>/
```

or read it directly from a configured package path.

## Runtime Mapping

Playbook runtime values map to PI-Agent behavior:

| Playbook runtime | PI-Agent handling |
| --- | --- |
| `strategy` | show strategy context; optionally call Hermes/strategy runtime if configured |
| `pi_agent` | route to PI tools, analysis packs, KOIF Router, or Decision Layer |
| `human` | render review gate in UI |
| `external_tool` | render preview and approval gate; no automatic mutation |

## Required PI-Agent UI Behavior

The PI-Agent workspace UI should:

- list scenarios from `scenario_index.json`.
- list missions from `scenario_index.json`.
- create task runs from `playbooks/<scenario_id>/playbook.json`.
- in scenario-directory mode, create task runs from
  `scenarios/<scenario_id>/playbook/playbook.json`.
- create mission runs from `missions/<mission_id>/mission.json`.
- show child TaskRun status inside a MissionRun.
- show artifact handoff between scenarios.
- show cross-scenario gates that block downstream scenarios.
- persist node runs, artifacts, gates, and audit events.
- allow artifact edits as new versions.
- allow node reruns from a selected artifact version.
- prevent downstream execution when a required gate is not approved.

## Data And Decision Boundary

PI-Agent owns:

- tool selection.
- data query execution.
- analysis pack runs.
- KOIF Router score and next action generation.
- PI Decision Layer proposal generation.

PI-Agent does not own:

- raw strategy document parsing.
- OpenKB citation compilation.
- final approval of budget, publishing, pricing, listing, or external tool
  mutation.

## Failure Handling

If a PI capability is unavailable:

```json
{
  "node_status": "blocked_by_pi_capability",
  "reason": "koif_decision_layer_phase3_stub",
  "recoverable": true
}
```

The task run remains readable and editable. Downstream nodes that strictly
depend on the blocked result must stay pending or blocked.

## MissionRun Behavior

A MissionRun is an orchestration wrapper around child TaskRuns:

```text
MissionRun
  -> TaskRun category_market_analysis
  -> TaskRun price_band_layout
  -> TaskRun competitor_analysis
  -> TaskRun new_product_launch
  -> TaskRun visual_creative_planning
```

PI-Agent should store mission-level state separately from child TaskRun state.
Mission state includes:

- mission inputs.
- child TaskRun ids.
- relation activations.
- artifact handoff records.
- mission gates.
- mission audit events.

Child TaskRuns continue to own node runs, artifacts, node gates, and per-scenario
audit logs.
