# Multi-Strategy Multi-Scenario Adapter Spec

## Purpose

This spec defines how `business-strategy-workspace-adapter` should evolve from
a single-scenario compiler into a generic adapter for many business strategy
collections and many scenarios.

The adapter should not hardcode business scenarios in Python. Business strategy
collections, scenario catalogs, node sequences, runtime mappings, gates, and
artifact templates must be declared in manifests.

New business strategy documents are expected to arrive as a **scenario
directory list**: each scenario directory contains one document collection. This
is the preferred input model and the unit that document owners should maintain.

Bundle-style manifests remain useful for compatibility and for packaging older
strategy systems, but new authoring should start from
`scenario_directory_index.yaml`.

## Target Architecture

```text
scenario directory index
  -> scenario directories
  -> per-scenario collection manifests
  -> OpenKB / source-backed KB artifacts
  -> business schema tags
  -> per-scenario manifests
  -> scenario graph
  -> mission manifests
  -> shared node library
  -> runtime profiles
  -> playbook bundles
  -> PI-Agent workspace packages
```

## Default Authoring Model

The default authoring model is:

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

Each `<scenario_id>/` directory should be independently buildable into:

```text
scenarios/<scenario_id>/
  kb/
  schema/
  playbook/
```

The global package root only aggregates compiled scenarios with
`scenario_index.json`. When present, `scenario_graph.yaml` records
cross-scenario relationships and `missions/*.yaml` composes scenarios into
larger tasks.

## Package Levels

### Strategy Collection

A source document collection. In the preferred input model, every scenario
directory owns one collection.

```text
marketing-insight-meta-strategy
product-optimization-strategy
paid-traffic-strategy
content-seeding-strategy
customer-service-strategy
```

Each collection owns:

- `collection.yaml`
- source documents
- OpenKB build artifacts
- schema tags
- source citations

### Scenario Directory

The preferred authoring unit:

```text
new_product_launch/
  scenario.yaml
  collection.yaml
  docs/
```

The scenario directory lets authors maintain each business scene independently
without editing a global strategy bundle file.

### Strategy Bundle

A compiled output package for one strategy collection or a compatibility
wrapper around older bundle-centric authoring.

Example:

```text
packages/marketing-insight/
  scenario_catalog.json
  playbooks/
  artifact_templates/
  gate_policy.json
```

### Scenario

A business task type and PI-Agent workspace entrypoint. In the preferred input
model, a scenario is backed by one scenario directory.

Example market insight scenarios:

- `new_product_launch`
- `bestseller_opportunity_mining`
- `category_market_analysis`
- `visual_creative_planning`
- `competitor_analysis`
- `price_band_layout`
- `product_upgrade_iteration`
- `cross_platform_trend_opportunity`
- `seasonal_product_planning`
- `shop_product_structure_planning`

### Scenario Graph

A top-level graph that declares how scenarios relate. It answers questions such
as:

- Which scenario must run before another?
- Which scenario provides evidence to another?
- Which scenarios can run in parallel?
- Which gate blocks downstream scenario execution?

Relations must pass versioned artifacts across scenarios. They must not share
hidden runtime state or let one scenario's schema evidence silently fill another
scenario's missing fields.

### Mission

A larger business task that composes multiple scenarios. A mission such as
`new_product_end_to_end` may run:

```text
category_market_analysis
  -> price_band_layout
  -> competitor_analysis
  -> new_product_launch
  -> visual_creative_planning
```

Each child scenario still keeps its own TaskRun. The mission stores
orchestration state, artifact handoffs, cross-scenario gates, and mission-level
audit events.

### Node

A reusable task unit. Nodes should live in a shared library and be reused across
scenarios.

Examples:

- `define_scope`
- `keyword_demand_analysis`
- `competitor_analysis`
- `price_band_opportunity`
- `opportunity_score`
- `human_approval`

### Runtime Profile

A runtime profile maps logical nodes to available Agent runtime tools.

Example:

```text
runtime_profile: pi_agent_v1
keyword_demand_analysis -> analyze_keyword_demand
competitor_analysis -> analyze_keyword_competition
opportunity_score -> propose_koif_strategy
```

## Scenario Coverage Status

Scenarios must record how they were obtained:

| Status | Meaning | Runtime behavior |
| --- | --- | --- |
| `explicit` | Directly stated in source strategy documents. | Can be offered by default. |
| `inferred` | Derived from flow sections, child docs, or business signals. | Offered with review marker. |
| `manual` | Added by an operator or strategy owner. | Requires owner confirmation. |
| `experimental` | Draft scenario for validation. | Hidden from default workspace unless enabled. |

PI-Agent UI should display coverage status so users understand confidence.

## Multi-Scenario Adaptation Rules

The adapter supports many business strategies by keeping four layers separate:

| Layer | Varies by scenario? | Shared across scenarios? |
| --- | --- | --- |
| Source document collection | Yes. Each directory owns one collection. | Only with explicit shared-doc policy. |
| Business schema tagging | Yes. Tags and missing fields are per scenario. | Schema definition is shared. |
| Playbook node sequence | Yes. Each scenario has its own sequence. | Node templates are shared. |
| Runtime mapping | Usually shared by profile. | Runtime profiles are shared and versioned. |
| Scenario relations | Usually shared at index level. | `scenario_graph.yaml` is shared. |
| Larger tasks | Yes by mission. | Missions can reuse scenarios. |

This means adding a new scenario normally requires:

1. Add a new scenario directory with docs, `collection.yaml`, and
   `scenario.yaml`.
2. Reuse existing nodes from `shared/node_library.yaml` when possible.
3. Add new nodes to the shared library only when the business process introduces
   a genuinely new reusable task unit.
4. Extend the runtime profile only when PI-Agent or another runtime needs a new
   capability mapping.
5. Compile and import only the new scenario package.

Evidence isolation is mandatory. Schema evidence extracted for
`new_product_launch` cannot satisfy `visual_creative_planning` unless the
latter scenario's collection explicitly includes or references the same source
document.

Cross-scenario reuse should happen through explicit artifact handoff declared in
`scenario_graph.yaml` or a mission manifest.

## Business Strategy To Runtime Boundary

Compiled strategy packages should give PI-Agent enough structure to run work,
but should not force raw API selection inside the strategy layer.

```text
scenario strategy evidence
  -> business schema tags
  -> playbook node requirements
  -> runtime profile capability mapping
  -> PI-Agent tool selection / analysis / decision proposal
```

The playbook can say "analyze keyword demand with category and date range". It
should not hardcode low-level database queries unless the target runtime
profile explicitly owns that query contract.

## Compiler Responsibilities

The multi-scenario compiler must:

- read a scenario directory index.
- read one or more scenario directories.
- validate per-directory `scenario.yaml` and `collection.yaml`.
- compile or reference KB artifacts per scenario directory.
- read per-scenario manifests.
- validate scenario graph relations when present.
- validate mission manifests when present.
- load shared node libraries.
- apply runtime profiles.
- generate one playbook per scenario.
- generate mission packages when mission manifests exist.
- generate a cross-scenario index.
- preserve source KB and schema tag provenance.

It must not:

- select raw APIs directly.
- execute PI-Agent data tools during compile.
- assume all scenarios are supported by all runtimes.
- auto-approve state-changing actions.
- merge scenario evidence or artifacts without an explicit handoff relation.

## Output Shape

Preferred scenario-directory output:

```text
workspace-packages/
  scenario_index.json
  scenario_graph.json
  missions/
    new_product_end_to_end/
      mission.json
  scenarios/
    new_product_launch/
      kb/
      schema/
      playbook/
    visual_creative_planning/
      kb/
      schema/
      playbook/
```

This output is the primary contract for PI-Agent workspace import.

Bundle-style output remains supported:

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

## Scenario Index

`scenario_index.json` lets a UI list scenarios across many strategy directories
or legacy strategy bundles.

```json
{
  "schema_version": "business-strategy-scenario-index-v1",
  "generated_at": "2026-06-22T00:00:00Z",
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

Legacy bundle outputs may include a `bundles` section in the same index, but
new scenario-directory output does not require one.

## Design Principles

- Compile knowledge before runtime.
- Keep scenarios declarative.
- Keep scenario relationships declarative.
- Use missions for larger business workflows.
- Reuse node templates across scenarios.
- Let runtime profiles adapt to different Agent runtimes.
- Treat PI-Agent decision outputs as proposals.
- Preserve artifact versioning and human gates.
