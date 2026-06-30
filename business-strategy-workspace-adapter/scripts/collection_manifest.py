#!/usr/bin/env python3
"""Load and validate Strategy KB collection manifests."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover - exercised only without PyYAML
    yaml = None
    _YAML_IMPORT_ERROR = exc
else:
    _YAML_IMPORT_ERROR = None


SCHEMA_VERSION = "strategy-kb-collection-v1"


class CollectionManifestError(ValueError):
    """Raised when a collection manifest is invalid."""


@dataclass(frozen=True)
class CollectionDocument:
    id: str
    path: Path
    title: str
    role: str
    topics: list[str]


@dataclass(frozen=True)
class CollectionRelation:
    from_id: str
    to_id: str
    type: str
    anchor: str
    external_url: str
    supports_fields: list[str]


@dataclass(frozen=True)
class CollectionManifest:
    schema_version: str
    id: str
    title: str
    domain: str
    entrypoint: str
    root: Path
    default_slug: str
    schema_path: Path
    documents: list[CollectionDocument]
    relations: list[CollectionRelation]
    manifest_path: Path


def _resolve_path(raw: str, *, base_dir: Path) -> Path:
    path = Path(raw).expanduser()
    if path.is_absolute():
        return path.resolve()
    return (base_dir / path).resolve()


def _require_mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CollectionManifestError(f"{label} must be a mapping")
    return value


def _require_string(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise CollectionManifestError(f"{key} must be a non-empty string")
    return value.strip()


def _string_list(value: Any, key: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise CollectionManifestError(f"{key} must be a list of strings")
    return list(value)


def load_collection_manifest(path: str | Path, *, base_dir: Path | None = None) -> CollectionManifest:
    if yaml is None:
        raise CollectionManifestError(
            "PyYAML is required to read collection.yaml. Install pyyaml or run inside the Hermes venv."
        ) from _YAML_IMPORT_ERROR

    base = (base_dir or Path.cwd()).resolve()
    manifest_path = _resolve_path(str(path), base_dir=base)
    if not manifest_path.exists():
        raise CollectionManifestError(f"collection manifest does not exist: {manifest_path}")

    payload = _require_mapping(yaml.safe_load(manifest_path.read_text(encoding="utf-8")), "collection manifest")
    schema_version = _require_string(payload, "schema_version")
    if schema_version != SCHEMA_VERSION:
        raise CollectionManifestError(f"schema_version must be {SCHEMA_VERSION}")

    root = _resolve_path(_require_string(payload, "root"), base_dir=base)
    if not root.exists():
        raise CollectionManifestError(f"root does not exist: {root}")

    schema_path = _resolve_path(_require_string(payload, "schema_path"), base_dir=base)
    if not schema_path.exists():
        raise CollectionManifestError(f"schema_path does not exist: {schema_path}")

    documents_payload = payload.get("documents")
    if not isinstance(documents_payload, list) or not documents_payload:
        raise CollectionManifestError("documents must be a non-empty list")

    documents: list[CollectionDocument] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(documents_payload):
        data = _require_mapping(item, f"documents[{index}]")
        doc_id = _require_string(data, "id")
        if doc_id in seen_ids:
            raise CollectionManifestError(f"duplicate document id: {doc_id}")
        seen_ids.add(doc_id)
        doc_path = _resolve_path(_require_string(data, "path"), base_dir=root)
        if not doc_path.exists():
            raise CollectionManifestError(f"document path does not exist: {doc_path}")
        documents.append(
            CollectionDocument(
                id=doc_id,
                path=doc_path,
                title=_require_string(data, "title"),
                role=_require_string(data, "role"),
                topics=_string_list(data.get("topics"), "topics"),
            )
        )

    entrypoint = _require_string(payload, "entrypoint")
    if entrypoint not in seen_ids:
        raise CollectionManifestError(f"entrypoint references unknown document id: {entrypoint}")

    relations_payload = payload.get("relations", [])
    if not isinstance(relations_payload, list):
        raise CollectionManifestError("relations must be a list")

    relations: list[CollectionRelation] = []
    for index, item in enumerate(relations_payload):
        data = _require_mapping(item, f"relations[{index}]")
        from_id = _require_string(data, "from")
        to_id = _require_string(data, "to")
        if from_id not in seen_ids:
            raise CollectionManifestError(f"unknown relation document id: {from_id}")
        if to_id not in seen_ids:
            raise CollectionManifestError(f"unknown relation document id: {to_id}")
        relations.append(
            CollectionRelation(
                from_id=from_id,
                to_id=to_id,
                type=_require_string(data, "type"),
                anchor=_require_string(data, "anchor"),
                external_url=str(data.get("external_url", "") or ""),
                supports_fields=_string_list(data.get("supports_fields"), "supports_fields"),
            )
        )

    return CollectionManifest(
        schema_version=schema_version,
        id=_require_string(payload, "id"),
        title=_require_string(payload, "title"),
        domain=_require_string(payload, "domain"),
        entrypoint=entrypoint,
        root=root,
        default_slug=str(payload.get("default_slug") or payload["id"]),
        schema_path=schema_path,
        documents=documents,
        relations=relations,
        manifest_path=manifest_path,
    )
