#!/usr/bin/env python3
"""Compile scenario directories into portable Agent workspace packages."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    yaml = None
    _YAML_IMPORT_ERROR = exc
else:
    _YAML_IMPORT_ERROR = None

from collection_manifest import CollectionManifestError, load_collection_manifest
from kb_schema_compiler import KBSchemaCompilerError, compile_skill_from_kb
from openkb_adapter import OpenKBAdapterError, build_kb


INDEX_SCHEMA_VERSION = "business-strategy-scenario-directory-index-v1"
SCENARIO_SCHEMA_VERSION = "business-strategy-scenario-v1"
GRAPH_SCHEMA_VERSION = "business-strategy-scenario-graph-v1"
MISSION_SCHEMA_VERSION = "business-strategy-mission-v1"
SCENARIO_INDEX_SCHEMA_VERSION = "business-strategy-scenario-index-v1"
PLAYBOOK_SCHEMA_VERSION = "business-strategy-playbook-v1"
PI_EXPORT_SCHEMA_VERSION = "pi-agent-scenario-workspace-adapter-v1"


class WorkspaceAdapterError(ValueError):
    """Raised when workspace adapter manifests or compilation fail."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _print_json(payload: dict[str, Any]) -> int:
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def _load_yaml(path: Path, label: str) -> dict[str, Any]:
    if yaml is None:
        raise WorkspaceAdapterError(
            "PyYAML is required to read workspace manifests. Install pyyaml or run inside the Hermes venv."
        ) from _YAML_IMPORT_ERROR
    if not path.exists():
        raise WorkspaceAdapterError(f"{label} does not exist: {path}")
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise WorkspaceAdapterError(f"{label} must be a mapping: {path}")
    return payload


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _copy_file_or_dir(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    if dst.exists():
        if dst.is_dir():
            shutil.rmtree(dst)
        else:
            dst.unlink()
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        shutil.copytree(src, dst)
    else:
        shutil.copy2(src, dst)


def _require_string(data: dict[str, Any], key: str, *, label: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise WorkspaceAdapterError(f"{label}.{key} must be a non-empty string")
    return value.strip()


def _as_list(value: Any, *, label: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise WorkspaceAdapterError(f"{label} must be a list")
    return value


def _resolve(path: str | Path, *, base: Path) -> Path:
    raw = Path(path).expanduser()
    if raw.is_absolute():
        return raw.resolve()
    return (base / raw).resolve()


def _safe_rel(path: Path, base: Path) -> str:
    return str(path.resolve().relative_to(base.resolve()))


def _ensure_within(path: Path, root: Path, *, label: str) -> None:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise WorkspaceAdapterError(f"{label} escapes scenario directory: {path}") from exc


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _allowed_external_document_roots(item: dict[str, Any], scenario_dir: Path) -> list[Path]:
    if not bool(item.get("allow_external_documents")):
        return []
    roots = _as_list(item.get("external_document_roots"), label="scenario.external_document_roots")
    if not roots:
        raise WorkspaceAdapterError("allow_external_documents requires external_document_roots")
    return [_resolve(str(root), base=scenario_dir) for root in roots]


def _load_node_library(path: Path) -> dict[str, dict[str, Any]]:
    payload = _load_yaml(path, "node_library")
    nodes = payload.get("nodes")
    if not isinstance(nodes, dict) or not nodes:
        raise WorkspaceAdapterError("node_library.nodes must be a non-empty mapping")
    normalized: dict[str, dict[str, Any]] = {}
    for node_id, item in nodes.items():
        if not isinstance(item, dict):
            raise WorkspaceAdapterError(f"node_library.nodes.{node_id} must be a mapping")
        normalized[str(node_id)] = {"node_id": str(node_id), **item}
    return normalized


def _load_artifact_templates(path: Path) -> dict[str, dict[str, Any]]:
    payload = _load_yaml(path, "artifact_templates")
    artifacts = payload.get("artifacts")
    if not isinstance(artifacts, dict):
        raise WorkspaceAdapterError("artifact_templates.artifacts must be a mapping")
    return {
        str(artifact_id): {"artifact_id": str(artifact_id), **item}
        for artifact_id, item in artifacts.items()
        if isinstance(item, dict)
    }


def _load_runtime_profile(path: Path) -> dict[str, Any]:
    payload = _load_yaml(path, "runtime_profile")
    if not isinstance(payload.get("tool_mappings", {}), dict):
        raise WorkspaceAdapterError(f"runtime_profile.tool_mappings must be a mapping: {path}")
    return payload


class WorkspaceManifests:
    def __init__(self, scenario_index_path: Path) -> None:
        self.index_path = scenario_index_path.expanduser().resolve()
        self.index = _load_yaml(self.index_path, "scenario_directory_index")
        if self.index.get("schema_version") != INDEX_SCHEMA_VERSION:
            raise WorkspaceAdapterError(f"scenario_directory_index.schema_version must be {INDEX_SCHEMA_VERSION}")

        index_dir = self.index_path.parent
        self.root = _resolve(_require_string(self.index, "root", label="scenario_directory_index"), base=index_dir)
        if not self.root.exists():
            raise WorkspaceAdapterError(f"scenario root does not exist: {self.root}")
        self.schema_path = _resolve(str(self.index.get("schema_path", "")), base=self.root) if self.index.get("schema_path") else None
        self.shared = self.index.get("shared", {}) if isinstance(self.index.get("shared", {}), dict) else {}
        self.node_library_path = _resolve(self.shared.get("node_library", "shared/node_library.yaml"), base=self.root)
        self.artifact_templates_path = _resolve(
            self.shared.get("artifact_templates", "shared/artifact_templates.yaml"),
            base=self.root,
        )
        runtime_profiles = self.shared.get("runtime_profiles", {})
        if not isinstance(runtime_profiles, dict):
            raise WorkspaceAdapterError("shared.runtime_profiles must be a mapping")
        self.runtime_profile_paths = {
            str(profile_id): _resolve(profile_path, base=self.root)
            for profile_id, profile_path in runtime_profiles.items()
        }
        self.default_runtime_profile = str(self.index.get("default_runtime_profile") or "")
        self.node_library = _load_node_library(self.node_library_path)
        self.artifact_templates = _load_artifact_templates(self.artifact_templates_path)
        self.runtime_profiles = {
            profile_id: _load_runtime_profile(path)
            for profile_id, path in self.runtime_profile_paths.items()
        }
        self.scenarios = self._load_scenarios()
        self.graph = self._load_graph()
        self.missions = self._load_missions()
        self._validate_graph()
        self._validate_missions()

    def _load_scenarios(self) -> list[dict[str, Any]]:
        scenarios_payload = _as_list(self.index.get("scenarios"), label="scenario_directory_index.scenarios")
        if not scenarios_payload:
            raise WorkspaceAdapterError("scenario_directory_index.scenarios must not be empty")
        seen: set[str] = set()
        scenarios: list[dict[str, Any]] = []
        for index, item in enumerate(scenarios_payload):
            if not isinstance(item, dict):
                raise WorkspaceAdapterError(f"scenarios[{index}] must be a mapping")
            scenario_id = _require_string(item, "scenario_id", label=f"scenarios[{index}]")
            if scenario_id in seen:
                raise WorkspaceAdapterError(f"duplicate scenario_id: {scenario_id}")
            seen.add(scenario_id)
            scenario_dir = _resolve(_require_string(item, "path", label=f"scenarios[{index}]"), base=self.root)
            if not scenario_dir.exists():
                raise WorkspaceAdapterError(f"scenario directory does not exist: {scenario_dir}")
            _ensure_within(scenario_dir, self.root, label=f"scenario {scenario_id}")
            collection_path = _resolve(str(item.get("collection") or "collection.yaml"), base=scenario_dir)
            if not collection_path.exists():
                raise WorkspaceAdapterError(f"collection.yaml does not exist for scenario {scenario_id}: {collection_path}")
            if not _is_within(collection_path, scenario_dir):
                if not bool(item.get("allow_external_collection")):
                    _ensure_within(collection_path, scenario_dir, label=f"scenario {scenario_id} collection")
            scenario_manifest_path = _resolve(str(item.get("scenario_manifest") or "scenario.yaml"), base=scenario_dir)
            if not scenario_manifest_path.exists():
                raise WorkspaceAdapterError(
                    f"scenario.yaml does not exist for scenario {scenario_id}: {scenario_manifest_path}"
                )
            _ensure_within(scenario_manifest_path, scenario_dir, label=f"scenario {scenario_id} manifest")
            scenario_manifest = _load_yaml(scenario_manifest_path, "scenario")
            if scenario_manifest.get("schema_version") != SCENARIO_SCHEMA_VERSION:
                raise WorkspaceAdapterError(f"scenario.schema_version must be {SCENARIO_SCHEMA_VERSION}: {scenario_id}")
            manifest_id = _require_string(scenario_manifest, "scenario_id", label=f"scenario {scenario_id}")
            if manifest_id != scenario_id:
                raise WorkspaceAdapterError(f"scenario_id mismatch: index={scenario_id} scenario.yaml={manifest_id}")
            node_sequence = _as_list(scenario_manifest.get("node_sequence"), label=f"scenario {scenario_id}.node_sequence")
            if not node_sequence:
                raise WorkspaceAdapterError(f"scenario {scenario_id}.node_sequence must not be empty")
            for node_id in node_sequence:
                if str(node_id) not in self.node_library:
                    raise WorkspaceAdapterError(f"unknown node id in scenario {scenario_id}: {node_id}")
            profile_id = str(scenario_manifest.get("runtime_profile") or item.get("runtime_profile") or self.default_runtime_profile)
            if profile_id and profile_id not in self.runtime_profiles:
                raise WorkspaceAdapterError(f"unknown runtime_profile for scenario {scenario_id}: {profile_id}")
            self._validate_runtime_mappings(scenario_id, node_sequence, profile_id)
            collection = load_collection_manifest(collection_path, base_dir=scenario_dir)
            external_document_roots = _allowed_external_document_roots(item, scenario_dir)
            for doc in collection.documents:
                if _is_within(doc.path, scenario_dir):
                    continue
                if external_document_roots and any(_is_within(doc.path, root) for root in external_document_roots):
                    continue
                _ensure_within(doc.path, scenario_dir, label=f"scenario {scenario_id} document")
            scenarios.append(
                {
                    "scenario_id": scenario_id,
                    "title": str(item.get("title") or scenario_manifest.get("title") or scenario_id),
                    "coverage_status": str(item.get("coverage_status") or scenario_manifest.get("coverage_status") or "manual"),
                    "runtime_profile": profile_id,
                    "scenario_dir": scenario_dir,
                    "collection_path": collection_path,
                    "scenario_manifest_path": scenario_manifest_path,
                    "scenario_manifest": scenario_manifest,
                    "collection": collection,
                    "node_sequence": [str(node_id) for node_id in node_sequence],
                }
            )
        return scenarios

    def _validate_runtime_mappings(self, scenario_id: str, node_sequence: list[Any], profile_id: str) -> None:
        if not profile_id:
            return
        profile = self.runtime_profiles.get(profile_id, {})
        mappings = profile.get("tool_mappings", {}) if isinstance(profile.get("tool_mappings", {}), dict) else {}
        for node_id in node_sequence:
            node = self.node_library[str(node_id)]
            if node.get("runtime") == "pi_agent" and str(node_id) not in mappings:
                raise WorkspaceAdapterError(f"missing runtime mapping for scenario {scenario_id} node {node_id}")

    def _load_graph(self) -> dict[str, Any] | None:
        graph_value = self.index.get("scenario_graph")
        if not graph_value:
            return None
        graph_path = _resolve(str(graph_value), base=self.root)
        graph = _load_yaml(graph_path, "scenario_graph")
        if graph.get("schema_version") != GRAPH_SCHEMA_VERSION:
            raise WorkspaceAdapterError(f"scenario_graph.schema_version must be {GRAPH_SCHEMA_VERSION}")
        graph["_path"] = str(graph_path)
        return graph

    def _load_missions(self) -> list[dict[str, Any]]:
        missions: list[dict[str, Any]] = []
        for raw_path in _as_list(self.index.get("missions"), label="scenario_directory_index.missions"):
            mission_path = _resolve(str(raw_path), base=self.root)
            mission = _load_yaml(mission_path, "mission")
            if mission.get("schema_version") != MISSION_SCHEMA_VERSION:
                raise WorkspaceAdapterError(f"mission.schema_version must be {MISSION_SCHEMA_VERSION}: {mission_path}")
            _require_string(mission, "mission_id", label="mission")
            _require_string(mission, "title", label="mission")
            mission["_path"] = str(mission_path)
            missions.append(mission)
        return missions

    def _validate_graph(self) -> None:
        if not self.graph:
            return
        known = {scenario["scenario_id"] for scenario in self.scenarios}
        seen: set[str] = set()
        for index, rel in enumerate(_as_list(self.graph.get("relations"), label="scenario_graph.relations")):
            if not isinstance(rel, dict):
                raise WorkspaceAdapterError(f"scenario_graph.relations[{index}] must be a mapping")
            relation_id = _require_string(rel, "relation_id", label=f"scenario_graph.relations[{index}]")
            if relation_id in seen:
                raise WorkspaceAdapterError(f"duplicate relation_id: {relation_id}")
            seen.add(relation_id)
            from_id = _require_string(rel, "from", label=relation_id)
            to_id = _require_string(rel, "to", label=relation_id)
            if from_id not in known:
                raise WorkspaceAdapterError(f"unknown scenario in relation {relation_id}: {from_id}")
            if to_id not in known:
                raise WorkspaceAdapterError(f"unknown scenario in relation {relation_id}: {to_id}")
            for handoff in _as_list(rel.get("handoff_artifacts"), label=f"relation {relation_id}.handoff_artifacts"):
                if not isinstance(handoff, dict):
                    raise WorkspaceAdapterError(f"relation {relation_id}.handoff_artifacts entries must be mappings")
                artifact_id = _require_string(handoff, "artifact_id", label=f"relation {relation_id}.handoff")
                if not self._scenario_declares_artifact(from_id, artifact_id):
                    raise WorkspaceAdapterError(
                        f"handoff artifact not declared by upstream scenario {from_id}: {artifact_id}"
                    )

    def _scenario_declares_artifact(self, scenario_id: str, artifact_id: str) -> bool:
        scenario = next(item for item in self.scenarios if item["scenario_id"] == scenario_id)
        for node_id in scenario["node_sequence"]:
            node = self.node_library[node_id]
            if artifact_id in [str(item) for item in node.get("artifact_templates", [])]:
                return True
        return False

    def _validate_missions(self) -> None:
        known = {scenario["scenario_id"] for scenario in self.scenarios}
        mission_ids: set[str] = set()
        for mission in self.missions:
            mission_id = str(mission["mission_id"])
            if mission_id in mission_ids:
                raise WorkspaceAdapterError(f"duplicate mission_id: {mission_id}")
            mission_ids.add(mission_id)
            gate_ids = {
                str(gate.get("gate_id"))
                for gate in _as_list(mission.get("gates"), label=f"mission {mission_id}.gates")
                if isinstance(gate, dict) and gate.get("gate_id")
            }
            for index, step in enumerate(_as_list(mission.get("scenario_plan"), label=f"mission {mission_id}.scenario_plan")):
                if not isinstance(step, dict):
                    raise WorkspaceAdapterError(f"mission {mission_id}.scenario_plan[{index}] must be a mapping")
                scenario_id = _require_string(step, "scenario_id", label=f"mission {mission_id}.scenario_plan[{index}]")
                if scenario_id not in known:
                    raise WorkspaceAdapterError(f"unknown scenario in mission {mission_id}: {scenario_id}")
                if step.get("mode") == "after_gate":
                    gate_dependency = step.get("gate_dependency")
                    if not isinstance(gate_dependency, str) or not gate_dependency.strip():
                        raise WorkspaceAdapterError(f"mission {mission_id} after_gate step requires gate_dependency")
                    if gate_dependency not in gate_ids:
                        raise WorkspaceAdapterError(f"unknown gate_dependency in mission {mission_id}: {gate_dependency}")
                input_bindings = step.get("input_bindings", {})
                if input_bindings is not None and not isinstance(input_bindings, dict):
                    raise WorkspaceAdapterError(f"mission {mission_id}.input_bindings must be a mapping")
                for binding in (input_bindings or {}).values():
                    self._validate_artifact_ref(mission_id, str(binding))

    def _validate_artifact_ref(self, mission_id: str, ref: str) -> None:
        if "." not in ref:
            raise WorkspaceAdapterError(f"mission {mission_id} artifact binding must be scenario.artifact: {ref}")
        scenario_id, artifact_id = ref.split(".", 1)
        if scenario_id not in {scenario["scenario_id"] for scenario in self.scenarios}:
            raise WorkspaceAdapterError(f"unknown scenario in mission {mission_id} binding: {scenario_id}")
        if not self._scenario_declares_artifact(scenario_id, artifact_id):
            raise WorkspaceAdapterError(f"mission {mission_id} references unknown artifact: {ref}")


def validate_workspace(scenario_index: Path) -> dict[str, Any]:
    manifests = WorkspaceManifests(scenario_index)
    return {
        "success": True,
        "scenario_index": str(manifests.index_path),
        "scenario_count": len(manifests.scenarios),
        "relation_count": len(manifests.graph.get("relations", [])) if manifests.graph else 0,
        "mission_count": len(manifests.missions),
    }


def _compile_playbook(
    *,
    scenario: dict[str, Any],
    manifests: WorkspaceManifests,
    source_collection_id: str,
    source_schema_version: str,
) -> dict[str, Any]:
    nodes = []
    for node_id in scenario["node_sequence"]:
        node = dict(manifests.node_library[node_id])
        node["node_id"] = node_id
        nodes.append(node)
    return {
        "schema_version": PLAYBOOK_SCHEMA_VERSION,
        "scenario_id": scenario["scenario_id"],
        "title": scenario["title"],
        "coverage_status": scenario["coverage_status"],
        "runtime_profile": scenario["runtime_profile"],
        "source_collection_id": source_collection_id,
        "source_schema_version": source_schema_version,
        "inputs": scenario["scenario_manifest"].get("inputs", {}),
        "nodes": nodes,
        "gates": [
            {
                "gate_id": "human_approval",
                "gate_type": "human_review_gate",
                "required_before": ["external_tool_execution"],
                "approval_options": ["approve", "reject", "request_changes"],
            }
        ],
    }


def _copy_schema_refs(skill_dir: Path, schema_dir: Path) -> None:
    refs_dir = skill_dir / "references"
    for source_name, target_name in (
        ("schema_tags.json", "schema_tags.json"),
        ("source_digest.md", "source_digest.md"),
    ):
        _copy_file_or_dir(refs_dir / source_name, schema_dir / target_name)


def _write_shared_outputs(manifests: WorkspaceManifests, output: Path) -> None:
    _write_json(
        output / "shared" / "node_library.json",
        {
            "schema_version": "business-strategy-node-library-v1",
            "nodes": manifests.node_library,
        },
    )
    for artifact_id, artifact in manifests.artifact_templates.items():
        _write_json(output / "shared" / "artifact_templates" / f"{artifact_id}.json", artifact)
    for profile_id, profile in manifests.runtime_profiles.items():
        _write_json(output / "shared" / "runtime_profiles" / f"{profile_id}.json", profile)


def _mission_output_path(output: Path, mission_id: str) -> Path:
    return output / "missions" / mission_id / "mission.json"


def build_workspace(
    *,
    scenario_index: Path,
    openkb_root: Path,
    output: Path,
    openkb_mode: str = "auto",
    openkb_model: str | None = None,
    openkb_timeout: int | None = None,
) -> dict[str, Any]:
    manifests = WorkspaceManifests(scenario_index)
    output = output.expanduser().resolve()
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    _write_shared_outputs(manifests, output)

    scenarios_index: list[dict[str, Any]] = []
    for scenario in manifests.scenarios:
        scenario_id = scenario["scenario_id"]
        scenario_root = output / "scenarios" / scenario_id
        kb_dir = scenario_root / "kb"
        schema_dir = scenario_root / "schema"
        playbook_dir = scenario_root / "playbook"
        kb_manifest = build_kb(
            collection=scenario["collection"],
            openkb_root=openkb_root,
            output_dir=kb_dir,
            openkb_mode=openkb_mode,
            openkb_model=openkb_model,
            openkb_timeout=openkb_timeout,
        )
        generated_skills = output / ".generated-skills"
        compile_result = compile_skill_from_kb(
            kb_manifest_path=kb_dir / "kb_manifest.json",
            schema_path=scenario["collection"].schema_path,
            output_root=generated_skills,
            slug=scenario_id,
        )
        skill_dir = Path(compile_result["skill_dir"])
        _copy_schema_refs(skill_dir, schema_dir)
        _copy_file_or_dir(kb_dir / "kb_manifest.json", schema_dir / "kb_manifest.json")
        playbook = _compile_playbook(
            scenario=scenario,
            manifests=manifests,
            source_collection_id=str(kb_manifest.get("collection_id", "")),
            source_schema_version="biz-strategy-meta-v2",
        )
        _write_json(playbook_dir / "playbook.json", playbook)
        for artifact_id in sorted({artifact for node in playbook["nodes"] for artifact in node.get("artifact_templates", [])}):
            artifact = manifests.artifact_templates.get(
                str(artifact_id),
                {
                    "artifact_id": str(artifact_id),
                    "title": str(artifact_id).replace("_", " "),
                    "content_type": "markdown",
                    "versioning": "append_only",
                    "editable": True,
                },
            )
            _write_json(playbook_dir / "artifact_templates" / f"{artifact_id}.json", artifact)
        _write_json(
            playbook_dir / "gate_policy.json",
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
                    "api_mutation",
                ],
            },
        )
        normalized_manifest = {
            "schema_version": SCENARIO_SCHEMA_VERSION,
            "scenario_id": scenario_id,
            "title": scenario["title"],
            "coverage_status": scenario["coverage_status"],
            "runtime_profile": scenario["runtime_profile"],
            "inputs": scenario["scenario_manifest"].get("inputs", {}),
            "source_evidence": scenario["scenario_manifest"].get("source_evidence", {}),
            "collection_manifest": "kb/collection.normalized.json",
            "kb_manifest_path": "kb/kb_manifest.json",
            "schema_tags_path": "schema/schema_tags.json",
            "playbook_path": "playbook/playbook.json",
        }
        _write_json(scenario_root / "scenario_manifest.json", normalized_manifest)
        scenarios_index.append(
            {
                "scenario_id": scenario_id,
                "title": scenario["title"],
                "coverage_status": scenario["coverage_status"],
                "scenario_path": f"scenarios/{scenario_id}",
                "task_entrypoint": scenario_id,
                "playbook_path": f"scenarios/{scenario_id}/playbook/playbook.json",
                "kb_manifest_path": f"scenarios/{scenario_id}/kb/kb_manifest.json",
                "schema_tags_path": f"scenarios/{scenario_id}/schema/schema_tags.json",
                "runtime_profile": scenario["runtime_profile"],
                "required_inputs": list((scenario["scenario_manifest"].get("inputs") or {}).get("required", [])),
            }
        )

    graph_path = None
    if manifests.graph:
        graph = {key: value for key, value in manifests.graph.items() if not key.startswith("_")}
        _write_json(output / "scenario_graph.json", graph)
        graph_path = "scenario_graph.json"

    mission_index: list[dict[str, Any]] = []
    for mission in manifests.missions:
        mission_id = str(mission["mission_id"])
        payload = {key: value for key, value in mission.items() if not key.startswith("_")}
        _write_json(_mission_output_path(output, mission_id), payload)
        scenario_ids = [
            str(step["scenario_id"])
            for step in _as_list(payload.get("scenario_plan"), label=f"mission {mission_id}.scenario_plan")
            if isinstance(step, dict)
        ]
        mission_index.append(
            {
                "mission_id": mission_id,
                "title": str(mission.get("title", mission_id)),
                "mission_path": f"missions/{mission_id}/mission.json",
                "scenario_ids": scenario_ids,
            }
        )

    scenario_index_payload = {
        "schema_version": SCENARIO_INDEX_SCHEMA_VERSION,
        "generated_at": _utc_now(),
        "input_model": "scenario_directory_index",
        "source_index": str(manifests.index_path),
        "scenario_graph_path": graph_path,
        "scenarios": scenarios_index,
        "missions": mission_index,
    }
    _write_json(output / "scenario_index.json", scenario_index_payload)
    return {
        "success": True,
        "output": str(output),
        "scenario_index": str(output / "scenario_index.json"),
        "scenario_count": len(scenarios_index),
        "mission_count": len(mission_index),
        "relation_count": len(manifests.graph.get("relations", [])) if manifests.graph else 0,
    }


def export_pi_workspace(*, workspace_packages: Path, output: Path) -> dict[str, Any]:
    source = workspace_packages.expanduser().resolve()
    if not (source / "scenario_index.json").exists():
        raise WorkspaceAdapterError(f"scenario_index.json not found in workspace packages: {source}")
    output = output.expanduser().resolve()
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for item in ("scenario_index.json", "scenario_graph.json", "shared", "missions"):
        _copy_file_or_dir(source / item, output / item)
    index = json.loads((output / "scenario_index.json").read_text(encoding="utf-8"))
    for scenario in index.get("scenarios", []):
        if not isinstance(scenario, dict) or not scenario.get("scenario_id"):
            continue
        scenario_id = str(scenario["scenario_id"])
        src_root = source / "scenarios" / scenario_id
        dst_root = output / "scenarios" / scenario_id
        for rel in (
            "scenario_manifest.json",
            "schema/schema_tags.json",
            "schema/source_digest.md",
            "schema/kb_manifest.json",
            "playbook/playbook.json",
            "playbook/gate_policy.json",
            "playbook/artifact_templates",
        ):
            _copy_file_or_dir(src_root / rel, dst_root / rel)
        for rel in ("kb/kb_manifest.json", "kb/source_map.json", "kb/citations.json"):
            _copy_file_or_dir(src_root / rel, dst_root / rel)
    _write_json(
        output / "adapter_manifest.json",
        {
            "schema_version": PI_EXPORT_SCHEMA_VERSION,
            "source_workspace_packages": str(source),
            "scenario_count": len(index.get("scenarios", [])),
            "mission_count": len(index.get("missions", [])),
            "runtime_targets": ["strategy", "pi_agent", "human", "external_tool"],
            "import_hint": "Configure PI-Agent to read this scenario_workspace path.",
        },
    )
    _write_json(
        output / "runtime_contract.json",
        {
            "schema_version": "playbook-runtime-contract-v1",
            "entrypoints": ["scenario", "mission"],
            "artifact_versioning": "append_only",
            "cross_scenario_handoff": "versioned_artifacts_only",
            "pi_decision_layer": "proposal_only",
        },
    )
    return {
        "success": True,
        "output": str(output),
        "scenario_count": len(index.get("scenarios", [])),
        "mission_count": len(index.get("missions", [])),
    }


def cmd_validate(args: argparse.Namespace) -> int:
    return _print_json(validate_workspace(args.scenario_index))


def cmd_build(args: argparse.Namespace) -> int:
    return _print_json(
        build_workspace(
            scenario_index=args.scenario_index,
            openkb_root=args.openkb_root,
            output=args.output,
            openkb_mode=args.openkb_mode,
            openkb_model=args.openkb_model,
            openkb_timeout=args.openkb_timeout,
        )
    )


def cmd_export_pi(args: argparse.Namespace) -> int:
    return _print_json(export_pi_workspace(workspace_packages=args.workspace_packages, output=args.output))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate")
    validate.add_argument("--scenario-index", required=True, type=Path)
    validate.set_defaults(func=cmd_validate)

    build = subparsers.add_parser("build")
    build.add_argument("--scenario-index", required=True, type=Path)
    build.add_argument("--openkb-root", required=True, type=Path)
    build.add_argument("--output", required=True, type=Path)
    build.add_argument("--openkb-mode", choices=("auto", "source-only", "cli-ingest"), default="auto")
    build.add_argument("--openkb-model", default=None)
    build.add_argument("--openkb-timeout", default=None, type=int)
    build.set_defaults(func=cmd_build)

    export_pi = subparsers.add_parser("export-pi")
    export_pi.add_argument("--workspace-packages", required=True, type=Path)
    export_pi.add_argument("--output", required=True, type=Path)
    export_pi.set_defaults(func=cmd_export_pi)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.func(args))
    except (
        WorkspaceAdapterError,
        CollectionManifestError,
        OpenKBAdapterError,
        KBSchemaCompilerError,
        FileNotFoundError,
        ValueError,
    ) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
