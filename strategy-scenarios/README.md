# Strategy Scenarios Smoke Input

This is a minimal input package for validating the portable
`business-strategy-workspace-adapter`.

It defines one scenario, `marketing_insight`, backed by the existing source
documents in `docs/biz_spec/marketing_insight/`. The package intentionally does
not copy the raw strategy documents. Instead, the scenario index explicitly
allows that read-only external document root for smoke validation.

Run from the repository root:

```bash
.venv/bin/python local-skills/business-strategy-workspace-adapter/scripts/workspace_adapter.py validate \
  --scenario-index strategy-scenarios/scenario_directory_index.yaml

.venv/bin/python local-skills/business-strategy-workspace-adapter/scripts/workspace_adapter.py build \
  --scenario-index strategy-scenarios/scenario_directory_index.yaml \
  --openkb-root third_party/OpenKB \
  --openkb-mode source-only \
  --output .strategy-workspace/workspace-packages-smoke
```

Use `--openkb-mode cli-ingest` only when you want to exercise real OpenKB LLM
ingestion. The `source-only` mode is the fastest deterministic adapter smoke.
