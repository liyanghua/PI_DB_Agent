# Scenario Directory Input Spec

## Purpose

Future business strategy documents are provided as a **scenario directory
list**. Each scenario directory contains one business document collection.
This is the default authoring model for new strategy work.

This changes the adapter's primary input model:

```text
scenario directory index
  -> scenario directories
  -> each directory owns one document collection
  -> each directory compiles to one scenario playbook package
  -> optional scenario graph records relations among scenarios
  -> optional missions compose scenarios into larger tasks
  -> global scenario index aggregates all scenarios
```

The compiler should treat each scenario directory as the smallest independent
business strategy unit. A strategy author should be able to add, remove,
rebuild, review, and import one scenario directory without touching unrelated
scenarios.

## Authoring Contract

The upstream document provider gives the adapter a directory tree, not a single
Markdown file and not a monolithic bundle manifest.

Required contract:

- One top-level `scenario_directory_index.yaml` lists all available scenario
  directories.
- Every scenario directory contains exactly one `collection.yaml`.
- Every scenario directory owns the local source documents needed by that
  `collection.yaml`, normally under `docs/`.
- Every scenario directory may include `scenario.yaml` to declare the task
  playbook. If it is absent, the compiler may infer metadata but must mark the
  scenario as inferred.
- Each scenario directory compiles independently into KB, business schema, and
  playbook artifacts.
- Scenario-to-scenario relationships live in top-level `scenario_graph.yaml`,
  not inside individual scenario directories.
- Larger business tasks live in top-level `missions/*.yaml`, not inside a
  single scenario's `scenario.yaml`.
- The global index only aggregates scenario outputs; it should not contain raw
  document relations, chunks, evidence quotes, or node implementation details.

This contract lets document owners deliver scenarios incrementally:

```text
add one new scenario directory
  -> validate its collection.yaml
  -> build its KB
  -> compile its business schema
  -> compile its playbook
  -> update global scenario_index.json
```

## Recommended Directory Shape

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

  new_product_launch/
    scenario.yaml
    collection.yaml
    docs/
      20260519市场分析洞察元策略.md
      7个结论的判断详细流程.md
      价格带市场结构判断标准.md
      竞品现象判断标准.md

  visual_creative_planning/
    scenario.yaml
    collection.yaml
    docs/
      主图与视觉策划.md
      竞品主图分析标准.md
      第一点击理由判断标准.md

  price_band_layout/
    scenario.yaml
    collection.yaml
    docs/
      价格带布局策略.md
      价格带市场结构判断标准.md
      店铺产品结构规划.md
```

`shared/` is optional but recommended once more than one scenario exists. It
keeps node definitions, artifact templates, and runtime mappings reusable while
the source documents remain inside their scenario directories.

`scenario_graph.yaml` and `missions/` are optional for a pure single-scenario
package. They become recommended when scenarios are related or when the user
needs a larger task such as "新品开发全流程".

## Path Resolution

Path resolution should be deterministic:

| Field | Base directory |
| --- | --- |
| `scenario_directory_index.yaml.root` | Current working directory unless the CLI passes an explicit base directory. |
| `scenarios[].path` | Resolved relative to index `root`. |
| Per-scenario `scenario.yaml` | Resolved inside the scenario directory. |
| Per-scenario `collection.yaml` | Resolved inside the scenario directory. |
| `collection.yaml.root` | Resolved relative to the scenario directory. |
| `collection.yaml.documents[].path` | Resolved relative to `collection.yaml.root`. |
| Shared `node_library`, `artifact_templates`, `runtime_profiles` | Resolved relative to the index `root`, unless explicitly absolute. |
| `scenario_graph.yaml` | Resolved relative to the index `root`, unless overridden. |
| `missions/*.yaml` | Resolved relative to the index `root`, unless overridden. |
| Business schema path | Prefer a shared schema path from the index; allow per-collection override. |

Document paths must not escape the scenario directory. The only normal
exceptions are read-only shared references such as the business schema,
node library, artifact templates, and runtime profiles.

For smoke validation or migration from an existing document repository, a
scenario entry may explicitly declare read-only external document roots:

```yaml
scenarios:
  - scenario_id: marketing_insight
    path: marketing_insight
    collection: collection.yaml
    allow_external_documents: true
    external_document_roots:
      - ../../docs/biz_spec/marketing_insight
```

This is an adapter validation convenience, not the preferred long-term package
shape. When `allow_external_documents` is absent, document paths outside the
scenario directory remain invalid. When it is present, every escaped source
document must still be under one of the declared `external_document_roots`.

## scenario_directory_index.yaml

The index is the top-level input.

```yaml
schema_version: business-strategy-scenario-directory-index-v1
id: ecommerce-market-strategy-scenarios
title: 电商经营策略场景集合
root: strategy-scenarios
default_runtime_profile: pi_agent_v1
schema_path: ../docs/biz_spec/元策略规范.md

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
    coverage_status: explicit
    runtime_profile: pi_agent_v1
    collection: collection.yaml
    scenario_manifest: scenario.yaml
    tags: [market-insight, product-development]

  - scenario_id: visual_creative_planning
    title: 主图与视觉策划
    path: visual_creative_planning
    coverage_status: explicit
    runtime_profile: pi_agent_v1
    collection: collection.yaml
    scenario_manifest: scenario.yaml
    tags: [visual, conversion]
```

### Index Fields

Required fields:

| Field | Meaning |
| --- | --- |
| `schema_version` | Must be `business-strategy-scenario-directory-index-v1`. |
| `id` | Stable id for the scenario list. |
| `title` | Human-readable title shown in workspace import UI. |
| `root` | Directory containing scenario directories. |
| `scenarios` | List of scenario directory entries. |

Recommended fields:

| Field | Meaning |
| --- | --- |
| `schema_path` | Shared business schema source. Per-collection override is allowed. |
| `default_runtime_profile` | Runtime profile used when a scenario omits one. |
| `shared.node_library` | Shared node library path. |
| `shared.artifact_templates` | Shared artifact templates path. |
| `shared.runtime_profiles` | Named runtime profile path map. |
| `scenario_graph` | Optional top-level scenario relationship graph. |
| `missions` | Optional mission manifests that compose multiple scenarios. |

Scenario entry fields:

| Field | Meaning |
| --- | --- |
| `scenario_id` | Stable scenario id. Must match `scenario.yaml.scenario_id` if present. |
| `title` | Human-readable scenario title. |
| `path` | Directory path relative to index root. |
| `coverage_status` | `explicit`, `inferred`, `manual`, or `experimental`. |
| `runtime_profile` | Runtime mapping used for playbook compilation. |
| `collection` | Optional collection manifest filename, default `collection.yaml`. |
| `scenario_manifest` | Optional scenario manifest filename, default `scenario.yaml`. |
| `tags` | Discovery hints for UI and search. |

## scenario.yaml

Each scenario directory may include a scenario manifest. If omitted, the
compiler should derive basic metadata from `scenario_directory_index.yaml` and
`collection.yaml`.

```yaml
schema_version: business-strategy-scenario-v1
scenario_id: new_product_launch
title: 淘宝/天猫新品开发
description: 准备开发新品，但不知道做什么产品、什么价格、什么卖点、什么人群。
coverage_status: explicit
business_goal: 生成可执行的新品开发立项与链接规划。
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

### Scenario Manifest Fields

Required fields when `scenario.yaml` exists:

| Field | Meaning |
| --- | --- |
| `schema_version` | Must be `business-strategy-scenario-v1`. |
| `scenario_id` | Stable id and directory identity. |
| `title` | Human-readable task scenario title. |
| `coverage_status` | Provenance status for how the scenario was defined. |
| `node_sequence` | Ordered list of logical node ids from the shared node library. |

Recommended fields:

| Field | Meaning |
| --- | --- |
| `description` | User-facing explanation of when to choose this scenario. |
| `business_goal` | Target business outcome. |
| `runtime_profile` | Runtime mapping override for this scenario. |
| `inputs.required` | User inputs required before a TaskRun can start. |
| `inputs.optional` | Useful but non-blocking inputs. |
| `source_evidence` | Parent document and anchor that justify the scenario. |
| `gates` | Scenario-level gate ids or gate overrides. |
| `artifact_expectations` | Key artifacts the workspace should eventually produce. |

`node_sequence` is the strict default execution order. A runtime may mark
independent nodes as parallelizable only when dependencies in the node library
make that safe. Human review nodes and state-changing external tool nodes must
remain explicit gates.

### Scenario Granularity

A scenario directory should represent one user-recognizable job, not one tiny
analysis step.

Good examples:

- `new_product_launch`
- `visual_creative_planning`
- `price_band_layout`
- `competitor_analysis`
- `seasonal_product_planning`

Too small:

- `fetch_top300`
- `calculate_search_growth`
- `render_price_chart`

Too broad:

- `operate_store`
- `all_market_insight`
- `growth_strategy_everything`

Small steps belong in the node library. Large strategy systems should be split
into multiple scenario directories and aggregated by the index.

## collection.yaml In Scenario Directory

Each scenario directory owns its own document collection. `collection.yaml`
should use paths relative to the scenario directory.

```yaml
schema_version: strategy-kb-collection-v1
id: new-product-launch-strategy
title: 淘宝/天猫新品开发策略
domain: ecommerce-market-insight
entrypoint: main
root: docs
default_slug: new-product-launch
schema_path: ../../docs/biz_spec/元策略规范.md

documents:
  - id: main
    path: 20260519市场分析洞察元策略.md
    title: 20260519市场分析洞察元策略
    role: parent_strategy
    topics: [new-product-launch, market-insight]

relations: []
```

The collection should include all documents required to answer and execute the
scenario. If two scenarios share the same source file, duplicate the reference
in both scenario collections or point both to a read-only shared document only
when the repository policy explicitly allows shared docs. The compiled outputs
must still be per-scenario so provenance and missing-field judgments stay local.

`collection.yaml` remains document-level and relation-level. Do not put final
schema tags, playbook nodes, chunk ids, or evidence quotes in it.

## Compile Pipeline Per Scenario

For each scenario directory, the compiler runs the same pipeline:

```text
scenario directory
  -> validate scenario.yaml and collection.yaml
  -> build OpenKB/source-backed KB artifacts
  -> compile business schema tags from KB evidence
  -> compile playbook from scenario.yaml + node library + runtime profile
  -> write scenario package
  -> update global scenario_index.json
```

Every scenario package should be rebuildable from its directory and shared
manifests. Rebuilding one scenario must not require rebuilding unrelated
scenarios, although a full index build may rebuild all.

## Compilation Output

Given a scenario directory list, the adapter should emit:

```text
workspace-packages/
  scenario_index.json
  scenario_graph.json
  shared/
    node_library.json
    artifact_templates/
    runtime_profiles/
  missions/
    new_product_end_to_end/
      mission.json
  scenarios/
    new_product_launch/
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

    visual_creative_planning/
      kb/
      schema/
      playbook/
```

The global `scenario_index.json` points directly to scenario outputs:

```json
{
  "schema_version": "business-strategy-scenario-index-v1",
  "scenario_graph_path": "scenario_graph.json",
  "scenarios": [
    {
        "scenario_id": "new_product_launch",
        "title": "淘宝/天猫新品开发",
        "coverage_status": "explicit",
        "scenario_path": "scenarios/new_product_launch",
        "task_entrypoint": "new_product_launch",
        "playbook_path": "scenarios/new_product_launch/playbook/playbook.json",
        "kb_manifest_path": "scenarios/new_product_launch/kb/kb_manifest.json",
        "schema_tags_path": "scenarios/new_product_launch/schema/schema_tags.json",
        "runtime_profile": "pi_agent_v1",
        "required_inputs": ["category", "date_range"]
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

### Scenario Package Contract

Each `scenarios/<scenario_id>/` package must be usable by an Agent runtime
without reading raw source documents:

| File | Purpose |
| --- | --- |
| `scenario_manifest.json` | Normalized scenario metadata and user inputs. |
| `kb/kb_manifest.json` | KB pages, source map, backend info, and compile metadata. |
| `kb/source_map.json` | Source document mapping for citations. |
| `kb/citations.json` | Citation ids and source passages. |
| `schema/schema_tags.json` | Business schema tags, missing fields, and evidence. |
| `schema/source_digest.md` | Human-readable source summary. |
| `playbook/playbook.json` | Executable node order and runtime requests. |
| `playbook/artifact_templates/` | Artifact schemas for the workspace. |
| `playbook/gate_policy.json` | Human review and external mutation gate rules. |

The PI-Agent UI should normally read `scenario_index.json`, then load only the
selected scenario package.

If the user chooses a mission, the UI should load the mission manifest, resolve
its child scenario packages, and create a MissionRun with child TaskRuns.

## Relationship To Bundle Registry

The previous `bundle_registry.yaml` model groups many scenarios under one
strategy bundle. The scenario directory model is more granular:

| Model | Best for | Primary unit |
| --- | --- | --- |
| Bundle registry | One large method system with many internal scenarios. | Strategy bundle |
| Scenario directory index | Many independently authored scenario document sets. | Scenario directory |

The adapter should support both, but the scenario directory index becomes the
preferred input for new business strategy documents.

## Multi-Scenario Governance

When many scenario directories come from one larger strategy method, keep the
following separation:

- Source document ownership lives in each scenario directory.
- Shared reusable execution logic lives in `shared/node_library.yaml`.
- Runtime-specific tool mapping lives in `shared/runtime_profiles/`.
- Business schema evidence and missing fields are compiled per scenario.
- UI scenario discovery happens through the global `scenario_index.json`.
- Cross-scenario relationships live in `scenario_graph.yaml`.
- Larger workflows live in `missions/*.yaml`.

This prevents a common failure mode: a field found in one scenario's strategy
documents should not automatically satisfy another scenario's missing field.
Cross-scenario reuse is allowed only through explicit shared documents or
shared node definitions, and the compiled evidence must still name the source
scenario and source document.

See `scenario_graph_and_mission_spec.md` for relationship types, artifact
handoff, mission manifests, cross-scenario gates, and MissionRun behavior.

## PI-Agent Import Model

PI-Agent should consume compiled scenario packages instead of raw strategy
documents.

Recommended import flow:

```text
workspace-packages/scenario_index.json
  -> user selects scenario
  -> PI-Agent loads scenarios/<scenario_id>/playbook/playbook.json
  -> UI creates TaskRun nodes
  -> runtime executes nodes using PI-Agent/Hermes/tool requests
  -> audit links artifacts back to schema evidence and KB citations
```

The import should preserve:

- `scenario_id`
- `mission_id` when a mission is selected
- `coverage_status`
- required and optional inputs
- playbook node order and dependencies
- scenario graph relation ids
- artifact handoff bindings
- artifact templates
- gate policy
- KB and schema provenance paths

## Compiler Rules

The compiler should:

- treat each scenario directory as independently buildable.
- build KB artifacts per scenario directory.
- build schema tags per scenario directory.
- compile one playbook per scenario directory.
- aggregate all scenarios into one global index.
- allow scenarios to share node libraries and runtime profiles.
- validate `scenario_graph.yaml` when present.
- validate mission manifests when present.

The compiler should reject:

- duplicate `scenario_id` values in one index.
- mismatch between index `scenario_id` and `scenario.yaml.scenario_id`.
- missing scenario directory paths.
- scenario directories without `collection.yaml`.
- `collection.yaml` files whose document paths escape the scenario directory,
  except explicitly allowed schema paths.
- unknown node ids in `scenario.yaml`.
- runtime profiles that do not map required PI-Agent nodes.
- scenario directories that produce no source documents.
- generated output paths that collide across scenarios.
- scenario graph relations that reference unknown scenarios.
- mission manifests that reference unknown scenarios.
- required cross-scenario handoff artifacts missing from upstream playbooks.

The compiler should warn:

- when `scenario.yaml` is absent and metadata is inferred.
- when `coverage_status` is `inferred`, `manual`, or `experimental`.
- when a scenario uses runtime nodes unsupported by the selected runtime
  profile.
- when two scenarios use the same source document but do not declare the reuse
  policy.
- when a scenario has no human gate despite containing state-changing nodes.
- when a mission has no gate before state-changing downstream scenarios.
- when related scenarios have no declared artifact handoff.

## Acceptance Checklist

For a new scenario directory list, acceptance requires:

- `scenario_directory_index.yaml` lists every scenario directory exactly once.
- Every listed directory has `collection.yaml`.
- Every listed directory has local docs or explicitly approved shared docs.
- Every `collection.yaml` validates at document and relation granularity.
- Every `scenario.yaml.node_sequence` resolves against the shared node library.
- Every PI-Agent node resolves through the selected runtime profile.
- Each scenario compiles to `kb/`, `schema/`, and `playbook/` outputs.
- `scenario_index.json` can list all scenarios without opening raw documents.
- `scenario_graph.yaml`, if present, explains cross-scenario relationships.
- every mission, if present, resolves to known scenario ids.
- PI-Agent can create a TaskRun from one selected scenario package.
- PI-Agent can create a MissionRun from one selected mission package.
- Evidence in one scenario does not silently satisfy missing fields in another.

## Example Authoring Workflow

```text
1. Create strategy-scenarios/<scenario_id>/.
2. Put downloaded parent and child strategy documents under docs/.
3. Write collection.yaml with document ids, roles, relations, and anchors.
4. Write scenario.yaml with user inputs, business goal, node sequence, and
   source evidence.
5. Add the directory to scenario_directory_index.yaml.
6. Run collection validation for that scenario.
7. Build KB and schema artifacts.
8. Compile the playbook package.
9. Optionally declare cross-scenario relations in scenario_graph.yaml.
10. Optionally declare larger missions under missions/.
11. Import the package into PI-Agent and create a TaskRun or MissionRun.
```
