#!/usr/bin/env python3
"""Export a playbook bundle into a PI-Agent workspace package."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any


def _load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.expanduser().resolve().read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def export_pi_workspace(*, bundle: Path, output: Path) -> dict[str, Any]:
    bundle = bundle.expanduser().resolve()
    output = output.expanduser().resolve()
    if not (bundle / "scenario_catalog.json").exists():
        raise FileNotFoundError(f"scenario_catalog.json not found in bundle: {bundle}")

    catalog = _load_json(bundle / "scenario_catalog.json")
    workspace = output / "scenario_workspace"
    if workspace.exists():
        shutil.rmtree(workspace)
    workspace.mkdir(parents=True)

    copy_items = [
        "scenario_catalog.json",
        "shared_node_library.json",
        "data_agent_request_templates.json",
        "gate_policy.json",
        "business_signal_mapping.yaml",
        "playbooks",
        "artifact_templates",
    ]
    for item in copy_items:
        src = bundle / item
        if not src.exists():
            continue
        dst = workspace / item
        if src.is_dir():
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)

    manifest = {
        "schema_version": "pi-agent-scenario-workspace-adapter-v1",
        "bundle_id": catalog.get("bundle_id"),
        "bundle_title": catalog.get("title"),
        "source_bundle": str(bundle),
        "scenario_count": len(catalog.get("scenarios", [])),
        "runtime_targets": ["strategy", "pi_agent", "human", "external_tool"],
        "import_hint": "Copy scenario_workspace into registry/derived/scenario_workspace/packages/<bundle_id> or configure PI-Agent to read this package path.",
    }
    _write_json(workspace / "adapter_manifest.json", manifest)
    _write_json(
        workspace / "runtime_contract.json",
        {
            "schema_version": "playbook-runtime-contract-v1",
            "node_statuses": [
                "pending",
                "ready",
                "running",
                "needs_input",
                "needs_review",
                "done",
                "failed",
                "skipped",
                "rerun_requested",
                "blocked_by_pi_capability",
            ],
            "artifact_versioning": "append_only",
            "pi_decision_layer": "proposal_only",
        },
    )
    return {
        "success": True,
        "output": str(workspace),
        "bundle_id": manifest["bundle_id"],
        "scenario_count": manifest["scenario_count"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = export_pi_workspace(bundle=args.bundle, output=args.output)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

