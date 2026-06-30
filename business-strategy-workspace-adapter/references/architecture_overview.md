# Business Strategy Workspace Adapter Overview

## Purpose

This is the top-level guide for the Business Strategy Workspace Adapter. Read it
first when working on strategy document collections, OpenKB compilation,
business schema compilation, scenario playbooks, scenario graphs, missions, or
PI-Agent workspace export.

The adapter turns business strategy document sets into Agent-run workspaces:

```text
business strategy documents
  -> OpenKB / source KB
  -> business schema tags
  -> scenario playbooks
  -> scenario graph
  -> missions
  -> PI-Agent or other Agent workspace package
```

## Core Idea

The system separates four concerns:

| Concern | Owner | Output |
| --- | --- | --- |
| Knowledge compilation | OpenKB layer | KB pages, source map, citations |
| Business interpretation | Business schema layer | Tags, missing fields, evidence |
| Work procedure | Playbook layer | Nodes, artifacts, gates, runtime requests |
| Runtime workspace | Agent runtime layer | TaskRuns, MissionRuns, artifacts, audit |

This separation keeps source knowledge, business meaning, executable process,
and runtime state from blending into one fragile prompt.

## Three Levels Of Work

### Scenario Directory

The smallest independent business strategy unit.

```text
<scenario_id>/
  scenario.yaml
  collection.yaml
  docs/
```

A scenario directory compiles independently into:

```text
scenarios/<scenario_id>/
  kb/
  schema/
  playbook/
```

Use this level for a single user-recognizable job such as `price_band_layout`,
`competitor_analysis`, or `new_product_launch`.

### Scenario Graph

The relationship layer between scenarios.

```text
scenario_graph.yaml
  category_market_analysis -> new_product_launch
  competitor_analysis -> visual_creative_planning
```

Use this level to express prerequisite, evidence-provider, downstream,
parallel, alternative, refinement, shared-context, and gate-dependent
relationships.

### Mission

The larger workflow layer that composes scenarios into one business job.

```text
missions/new_product_end_to_end.yaml
  -> category_market_analysis
  -> price_band_layout
  -> competitor_analysis
  -> new_product_launch
  -> visual_creative_planning
```

Use this level when the user goal is bigger than one scenario and needs child
TaskRuns, artifact handoff, and cross-scenario gates.

## Canonical Input Shape

```text
strategy-scenarios/
  scenario_directory_index.yaml
  scenario_graph.yaml
  missions/
    <mission_id>.yaml
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

`scenario_directory_index.yaml` lists available scenarios.
`scenario_graph.yaml` explains relationships among scenarios.
`missions/*.yaml` defines larger tasks that compose scenarios.
`shared/` holds reusable node, artifact, and runtime declarations.

## Canonical Output Shape

```text
workspace-packages/
  scenario_index.json
  scenario_graph.json
  shared/
    node_library.json
    artifact_templates/
    runtime_profiles/
  missions/
    <mission_id>/mission.json
  scenarios/
    <scenario_id>/
      scenario_manifest.json
      kb/
        kb_manifest.json
        source_map.json
        citations.json
      schema/
        schema_tags.json
        source_digest.md
      playbook/
        playbook.json
        artifact_templates/
        gate_policy.json
```

Agent runtimes should start from `scenario_index.json`, then load either a
single scenario package or a mission package.

The PI-Agent export is a runtime-facing subset of this package. It includes
scenario indexes, graph, missions, playbooks, schema tags, source digest, and KB
JSON manifests, but it does not export raw scenario `docs/` or OpenKB raw
workspaces.

## Compile Flow

For each scenario directory:

```text
validate collection.yaml
  -> build KB artifacts
  -> compile business schema tags
  -> compile playbook from scenario.yaml + shared node library
  -> write scenarios/<scenario_id> package
```

For the scenario set:

```text
validate scenario_directory_index.yaml
  -> validate scenario_graph.yaml
  -> validate missions/*.yaml
  -> write scenario_graph.json
  -> write missions/<mission_id>/mission.json
  -> write scenario_index.json
```

## Runtime Flow

Single-scenario task:

```text
user selects scenario
  -> runtime loads playbook.json
  -> creates TaskRun
  -> runs nodes
  -> writes artifacts, gates, audit
```

Mission task:

```text
user selects mission
  -> runtime loads mission.json and scenario_graph.json
  -> creates MissionRun
  -> creates child TaskRuns as ready
  -> passes versioned artifacts between scenarios
  -> enforces cross-scenario gates
  -> writes mission audit
```

## Key Boundaries

- PI-Agent consumes compiled packages, not raw strategy documents.
- OpenKB owns KB/wiki/citation generation.
- Business schema owns field tagging and missing-field judgment.
- Playbooks declare process nodes and runtime requests.
- Runtime profiles map logical nodes to runtime capabilities.
- Missions orchestrate scenarios; they do not merge scenario internals.
- Cross-scenario context must flow through versioned artifacts.
- PI Decision Layer outputs are proposals until a gate approves them.

## Document Map

| Read when you need... | Document |
| --- | --- |
| Collection manifest rules | `strategy_kb_collection_spec.md` |
| OpenKB + business schema flow | `openkb_business_schema_compiler_spec.md` |
| Scenario directory input contract | `scenario_directory_input_spec.md` |
| Cross-scenario relations and missions | `scenario_graph_and_mission_spec.md` |
| Manifest YAML examples | `declarative_manifest_spec.md` |
| Playbook and output JSON shape | `playbook_bundle_schema.md` |
| Node runtime request contract | `playbook_runtime_contract.md` |
| TaskRun, MissionRun, Artifact, Gate model | `scenario_task_workspace_spec.md` |
| Hermes / PI-Agent orchestration boundaries | `agent_runtime_orchestration_architecture.md` |
| PI-Agent export/import contract | `pi_agent_adapter_spec.md` |
| Strategy/data fusion design | `business_strategy_data_fusion_spec.md` |
| First new product launch sample | `market_insight_new_product_task_flow_spec.md` |
| Runtime KB query fallback | `strategy_kb_runtime_query_spec.md` |
| Portable single-document technical flow | `technical_flow.md` |
| Implementation migration path | `multi_scenario_migration_plan.md` |

## Recommended Reading Paths

For input authoring:

```text
architecture_overview.md
  -> scenario_directory_input_spec.md
  -> strategy_kb_collection_spec.md
  -> scenario_graph_and_mission_spec.md
  -> declarative_manifest_spec.md
```

For compiler implementation:

```text
architecture_overview.md
  -> openkb_business_schema_compiler_spec.md
  -> playbook_bundle_schema.md
  -> declarative_manifest_spec.md
  -> multi_scenario_migration_plan.md
```

For PI-Agent workspace integration:

```text
architecture_overview.md
  -> pi_agent_adapter_spec.md
  -> scenario_task_workspace_spec.md
  -> playbook_runtime_contract.md
  -> agent_runtime_orchestration_architecture.md
```

For runtime UX:

```text
architecture_overview.md
  -> scenario_task_workspace_spec.md
  -> scenario_graph_and_mission_spec.md
  -> market_insight_new_product_task_flow_spec.md
```

## Non-Goals

- Do not use this adapter for ordinary chat Q&A.
- Do not make PI-Agent parse raw strategy documents as its main contract.
- Do not put final schema tags into `collection.yaml`.
- Do not hide cross-scenario dependencies inside a single scenario.
- Do not pass unversioned hidden runtime state between scenarios.
- Do not let PI-Agent decision proposals bypass human gates.

## Acceptance At The Architecture Level

The architecture is coherent when:

- a scenario can be built and run independently.
- related scenarios can be explained by `scenario_graph.yaml`.
- a larger task can be represented as a mission.
- cross-scenario inputs are versioned artifacts.
- every output can trace back to source documents, schema evidence, runtime
  runs, artifact versions, and gate decisions.
