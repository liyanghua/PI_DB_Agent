# Business Strategy Workspace Adapter Integration

## Purpose

This document is the first thing PI-Agent should read before adapting the
business strategy workspace package.

The package compiles business strategy document collections into a standard
scenario workspace that PI-Agent can import. PI-Agent should consume the
compiled workspace artifacts, not the raw strategy documents or the OpenKB
runtime directly.

## Target Topology

```text
/Users/yichen/Desktop/OntologyBrain/PI_AGENT/
  business-strategy-workspace-adapter/
  strategy-scenarios/
  docs/biz_spec/
    marketing_insight/
    元策略规范.md
  third_party/OpenKB/
  .strategy-workspace/
    workspace-packages/
  db-archaeologist-pi-spec-pack/
    registry/derived/scenario_workspace/
    docs/22_BUSINESS_STRATEGY_WORKSPACE_ADAPTER_INTEGRATION.md
    scripts/install_business_strategy_workspace_adapter.sh
```

The adapter lives beside `db-archaeologist-pi-spec-pack` so it remains an
independent compiler package. The spec-pack reads only
`registry/derived/scenario_workspace`.

## Architecture Boundary

```text
strategy-scenarios/
  -> business-strategy-workspace-adapter
  -> OpenKB/source KB
  -> business schema tags
  -> playbook
  -> registry/derived/scenario_workspace
  -> PI-Agent BFF/UI/runtime
```

Responsibilities:

- `business-strategy-workspace-adapter`: compile strategy documents into KB,
  schema tags, playbooks, scenario graph, and mission manifests.
- `strategy-scenarios`: authoring input for scenario directories, collections,
  graph, missions, shared node library, and runtime profiles.
- `registry/derived/scenario_workspace`: PI-Agent import contract.
- PI-Agent BFF/UI/runtime: list scenarios, create task runs, execute nodes,
  store artifacts, and enforce human gates.

PI-Agent should not directly depend on Hermes paths after installation. The
Hermes checkout is only the current source used by the installer.

## Install

From the PI spec-pack:

```bash
cd /Users/yichen/Desktop/OntologyBrain/PI_AGENT/db-archaeologist-pi-spec-pack
bash scripts/install_business_strategy_workspace_adapter.sh
```

The script copies:

```text
hermes-agent/local-skills/business-strategy-workspace-adapter
  -> PI_AGENT/business-strategy-workspace-adapter

hermes-agent/strategy-scenarios
  -> PI_AGENT/strategy-scenarios

hermes-agent/docs/biz_spec/marketing_insight
  -> PI_AGENT/docs/biz_spec/marketing_insight

hermes-agent/docs/biz_spec/元策略规范.md
  -> PI_AGENT/docs/biz_spec/元策略规范.md
```

By default it runs a deterministic `source-only` build and export:

```text
PI_AGENT/.strategy-workspace/workspace-packages
PI_AGENT/db-archaeologist-pi-spec-pack/registry/derived/scenario_workspace
```

Use `--skip-build` when only installing files. Use `--mode cli-ingest` only
when OpenKB dependencies, model, and API key are ready and a long LLM-backed
compile is intended.

## Manual Build Commands

```bash
cd /Users/yichen/Desktop/OntologyBrain/PI_AGENT

python business-strategy-workspace-adapter/scripts/workspace_adapter.py validate \
  --scenario-index strategy-scenarios/scenario_directory_index.yaml

python business-strategy-workspace-adapter/scripts/workspace_adapter.py build \
  --scenario-index strategy-scenarios/scenario_directory_index.yaml \
  --openkb-root third_party/OpenKB \
  --openkb-mode source-only \
  --output .strategy-workspace/workspace-packages

python business-strategy-workspace-adapter/scripts/workspace_adapter.py export-pi \
  --workspace-packages .strategy-workspace/workspace-packages \
  --output db-archaeologist-pi-spec-pack/registry/derived/scenario_workspace
```

If the system Python cannot import `yaml`, run the commands with a Python
environment that has PyYAML installed, or use a project venv.

## PI-Agent Follow-Up Interface

The first PI-Agent integration should be read-only. The BFF reads
`registry/derived/scenario_workspace` and exposes:

```text
GET /api/workspace/scenario_index
GET /api/workspace/scenarios/:scenario_id/playbook
GET /api/workspace/scenarios/:scenario_id/schema
GET /api/workspace/missions/:mission_id
```

The UI should first show:

- Scenario list, including `marketing_insight`.
- Playbook node list and node status placeholders.
- Business schema perspectives, tags, and missing fields.
- KB document and citation counts.

Runtime execution is a later phase. It should dispatch by playbook node
`runtime_request`:

- `pi_agent_request` -> PI-Agent analysis tools.
- `hermes_request` or `strategy` -> strategy/schema/KB explanation and artifact
  drafting.
- `human_review_gate` -> explicit user approval in the UI.
- external mutation tools -> preview first, human gate before mutation.

## Market Insight Smoke Expectations

After the default source-only build:

- `scenario_index.json` exists under `registry/derived/scenario_workspace`.
- `scenario_count = 1`.
- `mission_count = 1`.
- Scenario id is `marketing_insight`.
- The playbook has 10 nodes:
  - `define_scope`
  - `industry_top300_analysis`
  - `keyword_demand_analysis`
  - `review_qa_pain_analysis`
  - `price_band_opportunity`
  - `competitor_analysis`
  - `opportunity_score`
  - `launch_brief`
  - `link_planning`
  - `human_approval`
- `schema_tags.json.schema_version = biz-strategy-meta-v2`.
- `客户业务专家视角` has 13 tags and missing field `页面截图`.
- `经营增长目标维度` has 13 tags and missing field `迭代日期`.

## Design Rules

- Keep raw strategy documents out of PI-Agent runtime APIs.
- Treat `registry/derived/scenario_workspace` as the import boundary.
- Do not mark PI tools as ready only because a playbook references them.
- Keep PI decision outputs as proposals until a human gate approves them.
- Do not run `cli-ingest` in background UI flows; it can call LLMs and take a
  long time.
- Keep generated workspace artifacts append-only or reproducible from the
  scenario input package.

## Troubleshooting

- Missing `third_party/OpenKB`: install or copy OpenKB to
  `/Users/yichen/Desktop/OntologyBrain/PI_AGENT/third_party/OpenKB`, or run only
  file installation with `--skip-build`.
- Existing target directories: rerun with `--force` if overwrite is intended.
- PyYAML missing: use a venv with PyYAML or install it into the Python used by
  the script.
- LLM/API errors: use `--mode source-only` for deterministic validation before
  attempting `--mode cli-ingest`.
