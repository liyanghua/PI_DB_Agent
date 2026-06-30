# Multi-Scenario Migration Plan

## Purpose

This plan describes how to migrate `business-strategy-workspace-adapter` from
the current hardcoded `new_product_launch` compiler to a declarative
multi-business-strategy, multi-scenario compiler.

## Current State

Current `compile_playbook_bundle.py` behavior:

- reads one KB manifest.
- reads one `schema_tags.json`.
- hardcodes `new_product_launch`.
- hardcodes all node definitions.
- writes one playbook bundle.

This is enough for smoke testing, but not enough for multiple scenarios or
multiple strategy collections.

## Target State

The compiler should read:

```text
scenario_directory_index.yaml
scenario_graph.yaml
missions/*.yaml
shared/node_library.yaml
shared/runtime_profiles/*.yaml
shared/artifact_templates.yaml
<scenario_id>/scenario.yaml
<scenario_id>/collection.yaml
<scenario_id>/docs/
```

and emit:

```text
workspace-packages/
  scenario_index.json
  scenario_graph.json
  missions/<mission_id>/mission.json
  shared/
  scenarios/<scenario_id>/
    kb/
    schema/
    playbook/
```

`bundle_registry.yaml` remains a compatibility input for older bundle-centric
sources, but it is not the primary implementation target for new documents.

## Implementation Steps

### Step 1: Add Scenario Directory Index Loader

Add a small loader that reads `scenario_directory_index.yaml` and validates:

- scenario ids.
- scenario directory paths.
- required `collection.yaml` files.
- optional `scenario.yaml` files.
- shared node library, artifact template, and runtime profile paths.
- optional scenario graph path.
- optional mission manifest paths.

Keep `PyYAML` optional only if the existing environment already provides it.
The current adapter already depends on YAML for collection manifests.

### Step 2: Validate Per-Scenario Manifests

For each listed scenario directory:

- validate `collection.yaml` with the existing collection validator.
- validate `scenario.yaml.scenario_id` against the index entry.
- resolve user inputs, `coverage_status`, source evidence, and node sequence.
- reject document paths that escape the scenario directory unless they are
  explicitly shared read-only references.

### Step 3: Extract Node Library

Move `_new_product_nodes()` into a default `node_library.yaml`.

Compiler behavior:

```text
scenario.node_sequence
  -> lookup node by id
  -> apply scenario-level overrides
  -> apply runtime profile mappings
  -> write playbook.json
```

### Step 4: Add Scenario Directory Samples

Create one scenario directory per market insight scenario:

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

Mark the scenarios with coverage:

- explicit when directly described in source strategy sections.
- inferred when derived from process tables or child documents.
- manual when added by an operator.

### Step 5: Add Scenario Directory Compile CLI

Add:

```bash
python scripts/compile_scenario_directories.py \
  --scenario-index strategy-scenarios/scenario_directory_index.yaml \
  --openkb-root third_party/OpenKB \
  --output .strategy-workspace/workspace-packages
```

This CLI should generate a cross-scenario `scenario_index.json`.

### Step 6: Add Scenario Graph And Mission Validation

Add validation for:

- graph relations referencing known scenarios.
- duplicate `relation_id` values.
- mission manifests referencing known scenarios.
- mission `input_bindings` referencing known upstream artifacts.
- `after_gate` steps declaring `gate_dependency`.
- required prerequisite cycles.
- mission gates referencing known scenario ids.

The compiler should emit:

```text
scenario_graph.json
missions/<mission_id>/mission.json
```

and add mission discovery metadata to `scenario_index.json`.

### Step 7: Upgrade PI Export

Update `export_pi_workspace.py` so it accepts:

```bash
--bundle <single-bundle>
--bundles <packages-root>
--scenario-packages <workspace-packages-root>
```

Single-bundle mode remains backward compatible.

Multi-bundle mode exports:

```text
scenario_workspace/
  scenario_index.json
  scenario_graph.json
  missions/<mission_id>/
  scenarios/<scenario_id>/
```

### Step 8: Keep Bundle Compatibility

Add a compatibility wrapper that can translate existing `bundle_registry.yaml`
inputs into an internal scenario-directory-like compile graph. Keep old CLI
paths working during migration.

### Step 9: Add Tests

Add tests for:

- unknown node id fails validation.
- duplicate scenario id fails validation.
- index `scenario_id` mismatch fails validation.
- missing `collection.yaml` fails validation.
- missing runtime mapping fails validation.
- inferred scenario produces warning.
- multiple scenario directories generate one scenario index.
- graph relation with unknown scenario fails validation.
- mission with unknown scenario fails validation.
- mission with missing artifact handoff fails validation.
- after-gate mission step without gate dependency fails validation.
- single-bundle mode remains compatible with current smoke path.

## Rollout

Phase 1:

- Keep current hardcoded compiler working.
- Add manifests and validation docs.

Phase 2:

- Implement scenario-directory compiler behind a new CLI.
- Keep old CLI as compatibility wrapper.

Phase 3:

- Switch `compile_playbook_bundle.py` to scenario-directory or manifest mode by
  default.
- Keep `--preset new_product_launch` for smoke testing.

Phase 4:

- PI-Agent imports multi-package `scenario_workspace`.
- PI-Agent can create MissionRuns from mission manifests.

## Acceptance

The migration is complete when:

- adding a new scenario requires no Python code changes.
- adding a new strategy collection requires no Python code changes.
- PI-Agent can list scenarios across multiple bundles.
- PI-Agent can list missions that compose multiple scenarios.
- each scenario playbook preserves runtime requests, artifact templates, and
  gate policy.
- mission runs preserve child TaskRun ids, artifact handoffs, cross-scenario
  gates, and mission audit events.
- hardcoded `new_product_launch` is only a preset or fixture, not the primary
  compiler path.
