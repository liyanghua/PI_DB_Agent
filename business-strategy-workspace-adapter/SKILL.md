---
name: business-strategy-workspace-adapter
description: Use when compiling strategy document collections into Agent task workspaces.
license: MIT
metadata:
  hermes:
    tags: [business-strategy, openkb, playbook, pi-agent, workspace]
    related_skills: [business-strategy-skill-pack]
---

# Business Strategy Workspace Adapter

## Overview

Use this portable adapter to turn business strategy document collections into
Agent task workspace packages. The preferred input is a scenario directory list:
each scenario directory owns one business document collection, and each
directory compiles into its own KB, business schema tags, and playbook package.

The adapter combines OpenKB knowledge compilation, business schema compilation,
scenario playbook generation, and PI-Agent workspace export.

The adapter is runtime-neutral. Hermes can be used as a strategy runtime, and
PI-Agent can be used as a data and decision runtime, but neither is required at
compile time except when the caller chooses a runtime-specific export target.

## When to Use

Use this adapter when the goal is:

- compile scenario directories into KB-backed strategy packages.
- manage many business strategy scenarios from one directory index.
- generate scenario catalogs and playbooks from business strategy evidence.
- export playbook nodes, artifact schemas, and gate policies for PI-Agent UI.
- preserve provenance from document citations to Agent task outputs.

Do not use it for ordinary chat Q&A, raw API selection, or direct browser/mobile
execution.

## How to Run

Preferred future input shape:

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
  <scenario_id>/
    scenario.yaml
    collection.yaml
    docs/
```

Validate a scenario directory package:

```bash
python <adapter-dir>/scripts/workspace_adapter.py validate \
  --scenario-index strategy-scenarios/scenario_directory_index.yaml
```

Build workspace packages:

```bash
python <adapter-dir>/scripts/workspace_adapter.py build \
  --scenario-index strategy-scenarios/scenario_directory_index.yaml \
  --openkb-root ./third_party/OpenKB \
  --output .strategy-workspace/workspace-packages
```

Export for PI-Agent path-based import:

```bash
python <adapter-dir>/scripts/workspace_adapter.py export-pi \
  --workspace-packages .strategy-workspace/workspace-packages \
  --output .strategy-workspace/pi-agent/scenario_workspace
```

Legacy single-collection path:

Validate a document collection:

```bash
python <adapter-dir>/scripts/strategy_kb.py validate-collection \
  --collection docs/biz_spec/marketing_insight/collection.yaml
```

Build KB artifacts:

```bash
python <adapter-dir>/scripts/strategy_kb.py build-kb \
  --collection docs/biz_spec/marketing_insight/collection.yaml \
  --openkb-root ./third_party/OpenKB \
  --output .strategy-workspace/marketing-insight/kb
```

Compile the KB-backed strategy skill:

```bash
python <adapter-dir>/scripts/strategy_kb.py compile-skill \
  --kb .strategy-workspace/marketing-insight/kb/kb_manifest.json \
  --schema docs/biz_spec/元策略规范.md \
  --output-root .strategy-workspace/generated-skills \
  --slug marketing-insight-kb
```

Compile a scenario playbook bundle:

```bash
python <adapter-dir>/scripts/compile_playbook_bundle.py \
  --kb .strategy-workspace/marketing-insight/kb/kb_manifest.json \
  --schema-tags .strategy-workspace/generated-skills/biz-strategy/marketing-insight-kb/references/schema_tags.json \
  --output .strategy-workspace/marketing-insight/playbook-bundle \
  --bundle-id marketing-insight
```

The legacy compiler includes a single-scenario `new_product_launch` preset for
smoke testing. For multi-scenario or multi-business-strategy work, use
`scripts/workspace_adapter.py` and read
`references/scenario_directory_input_spec.md`,
`references/multi_strategy_multi_scenario_spec.md`, and
`references/declarative_manifest_spec.md`. New business strategy documents
should be provided as a scenario directory index where each scenario directory
contains its own `collection.yaml` and docs.

Export a PI-Agent workspace package:

```bash
python <adapter-dir>/scripts/export_pi_workspace.py \
  --bundle .strategy-workspace/marketing-insight/playbook-bundle \
  --output .strategy-workspace/marketing-insight/pi-workspace
```

To install into a PI-Agent project, copy the exported `scenario_workspace`
folder into the PI-Agent derived registry or pass it to a future PI-Agent
workspace importer.

## Output Contract

The adapter produces:

```text
workspace-packages/
  scenario_index.json
  scenario_graph.json
  shared/
  missions/<mission_id>/mission.json
  scenarios/<scenario_id>/
    scenario_manifest.json
    kb/
    schema/
    playbook/

scenario_workspace/
  scenario_index.json
  scenario_graph.json
  shared/
  missions/
  scenarios/
  adapter_manifest.json
  runtime_contract.json
```

`export-pi` copies only runtime-facing JSON/Markdown artifacts. It does not
export raw scenario `docs/` or OpenKB raw workspaces as PI-Agent's primary
interface.

## References

Read `references/architecture_overview.md` first. It is the top-level map for
the adapter and explains which sub-spec to read for each task.

Sub-documents:

- `references/architecture_overview.md` for the overall architecture, document
  map, compile flow, runtime flow, and recommended reading paths.
- `references/strategy_kb_collection_spec.md` for collection manifests.
- `references/openkb_business_schema_compiler_spec.md` for KB/schema flow.
- `references/scenario_task_workspace_spec.md` for TaskRun and Artifact model.
- `references/playbook_runtime_contract.md` for runtime requests and gates.
- `references/agent_runtime_orchestration_architecture.md` for Hermes/PI-Agent
  runtime boundaries.
- `references/market_insight_new_product_task_flow_spec.md` for the first
  scenario playbook.
- `references/multi_strategy_multi_scenario_spec.md` for multi-bundle and
  multi-scenario architecture.
- `references/scenario_directory_input_spec.md` for the preferred input shape:
  a list of scenario directories, each with one business document collection.
- `references/scenario_graph_and_mission_spec.md` for cross-scenario
  relationships, artifact handoff, and larger mission workflows.
- `references/declarative_manifest_spec.md` for bundle, scenario, node library,
  runtime profile, and artifact manifests.
- `references/multi_scenario_migration_plan.md` for the implementation path
  from hardcoded preset to manifest-driven compiler.

## Pitfalls

- Do not make PI-Agent read raw strategy documents as its primary contract.
- Do not let PI Decision Layer proposals bypass human gates.
- Do not overwrite artifact versions during reruns.
- Do not treat OpenKB runtime availability as required for local artifact
  search or package export.
- Do not add new scenarios by editing Python node lists once manifest-driven
  compilation is available.
- Do not hide cross-scenario dependencies inside a single scenario's
  `scenario.yaml`; use `scenario_graph.yaml` and `missions/*.yaml`.
- Do not pass hidden runtime state between scenarios; use versioned artifact
  handoff.
