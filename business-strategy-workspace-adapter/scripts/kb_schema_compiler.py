#!/usr/bin/env python3
"""Compile strategy skills from normalized Strategy KB artifacts."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from builder_common import (
    EXPERT_PERSPECTIVE,
    GROWTH_PERSPECTIVE,
    SCHEMA_VERSION,
    build_perspectives,
    build_qa_index,
    flatten_missing_fields,
    flatten_open_questions,
    flatten_tags,
    render_skill_md,
    title_from_document,
    update_index,
)


class KBSchemaCompilerError(RuntimeError):
    """Raised when a Strategy KB skill cannot be compiled."""


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise KBSchemaCompilerError(f"required KB artifact does not exist: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise KBSchemaCompilerError(f"KB artifact must be a JSON object: {path}")
    return payload


def _artifact_path(kb_manifest: dict[str, Any], key: str) -> Path:
    try:
        return Path(kb_manifest["artifact_paths"][key])
    except KeyError as exc:
        raise KBSchemaCompilerError(f"kb_manifest missing artifact_paths.{key}") from exc


def _document_map(kb_manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(doc["id"]): doc for doc in kb_manifest.get("documents", [])}


def _citation_map(citations_payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    citations: dict[str, list[dict[str, Any]]] = {}
    for item in citations_payload.get("citations", []):
        citations.setdefault(str(item["doc_id"]), []).append(item)
    return citations


def _combined_text(documents: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for doc in documents:
        full_text = str(doc.get("full_text") or "")
        if not full_text and doc.get("path"):
            path = Path(str(doc["path"]))
            if path.exists():
                full_text = path.read_text(encoding="utf-8")
        if not full_text:
            continue
        parts.append(
            "\n\n"
            + "=" * 80
            + f"\nSOURCE_DOC_ID: {doc['id']}\nSOURCE_TITLE: {doc.get('title', '')}\n"
            + "=" * 80
            + "\n\n"
            + full_text
        )
    return "\n".join(parts).strip()


def _text_for_doc(doc: dict[str, Any]) -> str:
    if doc.get("full_text"):
        return str(doc["full_text"])
    path = Path(str(doc.get("path", "")))
    if path.exists():
        return path.read_text(encoding="utf-8")
    return ""


def _supporting_relations(kb_manifest: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    by_target: dict[str, list[dict[str, Any]]] = {}
    for rel in kb_manifest.get("relations", []):
        by_target.setdefault(str(rel.get("to", "")), []).append(rel)
    return by_target


def _score_tag_for_doc(
    tag: dict[str, Any],
    doc: dict[str, Any],
    supporting_relations: dict[str, list[dict[str, Any]]],
) -> int:
    text = _text_for_doc(doc)
    if not text:
        return 0
    score = 0
    evidence = str(tag.get("evidence_quote", ""))
    value = str(tag.get("value", ""))
    field = str(tag.get("field", ""))
    if evidence and evidence[:80] in text:
        score += 100
    if value and value[:40] in text:
        score += 20
    if field and field in text:
        score += 10
    for rel in supporting_relations.get(str(doc["id"]), []):
        if field in rel.get("supports_fields", []):
            score += 150
        if field and field in str(rel.get("anchor", "")):
            score += 20
    for topic in doc.get("topics", []):
        if str(topic).replace("-", "") in field:
            score += 1
    return score


def _provenance_for_tag(
    tag: dict[str, Any],
    documents: dict[str, dict[str, Any]],
    citations: dict[str, list[dict[str, Any]]],
    supporting_relations: dict[str, list[dict[str, Any]]],
) -> dict[str, str]:
    best_doc = max(
        documents.values(),
        key=lambda doc: _score_tag_for_doc(tag, doc, supporting_relations),
        default=None,
    )
    if not best_doc:
        raise KBSchemaCompilerError("cannot assign provenance without documents")
    doc_citations = citations.get(str(best_doc["id"]), [])
    citation = doc_citations[0] if doc_citations else {}
    page_ids = best_doc.get("page_ids") or []
    return {
        "source_doc_id": str(best_doc["id"]),
        "source_path": str(best_doc.get("path", "")),
        "kb_page_id": str(citation.get("kb_page_id") or (page_ids[0] if page_ids else "")),
        "citation_id": str(citation.get("citation_id") or ""),
    }


def _add_provenance(
    perspectives: dict[str, dict[str, Any]],
    documents: dict[str, dict[str, Any]],
    citations: dict[str, list[dict[str, Any]]],
    supporting_relations: dict[str, list[dict[str, Any]]],
) -> dict[str, dict[str, Any]]:
    enriched: dict[str, dict[str, Any]] = {}
    for perspective in (EXPERT_PERSPECTIVE, GROWTH_PERSPECTIVE):
        item = perspectives[perspective]
        tags = []
        for tag in item["tags"]:
            tags.append({**tag, **_provenance_for_tag(tag, documents, citations, supporting_relations)})
        enriched[perspective] = {
            "tags": tags,
            "missing_fields": item["missing_fields"],
            "open_questions": item["open_questions"],
        }
    return enriched


def _render_kb_digest(
    *,
    title: str,
    perspectives: dict[str, dict[str, Any]],
    kb_manifest: dict[str, Any],
) -> str:
    lines = [
        f"# Source Digest: {title}",
        "",
        f"- Collection: `{kb_manifest.get('collection_id', '')}`",
        f"- Knowledge backend: `{kb_manifest.get('backend', '')}`",
        f"- Schema version: `{SCHEMA_VERSION}`",
        f"- Extraction engine: `openkb+business-schema`",
        "",
        "## Collection Documents",
        "",
    ]
    for doc in kb_manifest.get("documents", []):
        lines.append(f"- `{doc['id']}`: {doc.get('title', '')} ({doc.get('role', '')})")
    lines.append("")
    for perspective in (EXPERT_PERSPECTIVE, GROWTH_PERSPECTIVE):
        lines.extend([f"## {perspective}", "", "### Extracted Fields", ""])
        for tag in perspectives[perspective]["tags"]:
            lines.append(f"#### {tag['field']}")
            lines.append("")
            lines.append(f"- Value: {tag['value']}")
            lines.append(f"- Source doc: `{tag['source_doc_id']}`")
            lines.append(f"- Citation: `{tag['citation_id']}`")
            lines.append(f"- Evidence: {tag['evidence_quote']}")
            lines.append("")
        lines.extend(["### Missing Fields", ""])
        missing = perspectives[perspective]["missing_fields"]
        if missing:
            lines.extend(f"- {field}" for field in missing)
        else:
            lines.append("- None")
        lines.append("")
    return "\n".join(lines)


def compile_skill_from_kb(
    *,
    kb_manifest_path: Path,
    schema_path: Path,
    output_root: Path,
    slug: str,
) -> dict[str, Any]:
    kb_manifest_path = kb_manifest_path.expanduser().resolve()
    output_root = output_root.expanduser().resolve()
    schema_path = schema_path.expanduser().resolve()
    if not schema_path.exists():
        raise KBSchemaCompilerError(f"schema_path does not exist: {schema_path}")

    kb_manifest = _load_json(kb_manifest_path)
    source_map_path = _artifact_path(kb_manifest, "source_map")
    citations_path = _artifact_path(kb_manifest, "citations")
    source_map = _load_json(source_map_path)
    citations_payload = _load_json(citations_path)

    documents = _document_map(kb_manifest)
    if not documents:
        raise KBSchemaCompilerError("kb_manifest contains no documents")
    text = _combined_text(list(documents.values()))
    if not text:
        raise KBSchemaCompilerError("KB documents contain no usable text")

    title = str(kb_manifest.get("collection_title") or slug)
    skill_dir = output_root / "biz-strategy" / slug
    refs_dir = skill_dir / "references"
    refs_dir.mkdir(parents=True, exist_ok=True)

    perspectives = _add_provenance(
        build_perspectives(text),
        documents,
        _citation_map(citations_payload),
        _supporting_relations(kb_manifest),
    )
    tags = flatten_tags(perspectives)
    missing = flatten_missing_fields(perspectives)
    open_questions = flatten_open_questions(perspectives)
    payload = {
        "document_id": slug,
        "source_paths": [doc["path"] for doc in kb_manifest.get("documents", [])],
        "schema_path": str(schema_path),
        "schema_version": SCHEMA_VERSION,
        "extraction": {
            "engine": "openkb+business-schema",
            "fallback": False,
            "fallback_reason": "",
        },
        "knowledge_base": {
            "contract_version": "strategy-kb-provenance-v1",
            "backend": "openkb",
            "collection_manifest": kb_manifest.get("collection_manifest", ""),
            "kb_manifest": "references/kb_manifest.json",
            "source_map": "references/source_map.json",
            "citations": "references/citations.json",
        },
        "perspectives": perspectives,
        "tags": tags,
        "evidence": [
            {
                "scheme": item["scheme"],
                "field": item["field"],
                "quote": item["evidence_quote"],
                "source_doc_id": item["source_doc_id"],
                "citation_id": item["citation_id"],
            }
            for item in tags
        ],
        "missing_fields": missing,
        "open_questions": open_questions,
        "qa_index": build_qa_index(tags),
    }

    entrypoint_path = Path(str(next(iter(documents.values())).get("path", "")))
    (skill_dir / "SKILL.md").write_text(
        render_skill_md(title, slug, entrypoint_path, perspectives),
        encoding="utf-8",
    )
    (refs_dir / "schema_tags.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (refs_dir / "source_digest.md").write_text(
        _render_kb_digest(title=title, perspectives=perspectives, kb_manifest=kb_manifest),
        encoding="utf-8",
    )
    shutil.copy2(kb_manifest_path, refs_dir / "kb_manifest.json")
    shutil.copy2(source_map_path, refs_dir / "source_map.json")
    shutil.copy2(citations_path, refs_dir / "citations.json")

    perspective_stats = {
        perspective: {
            "extracted_count": len(perspectives[perspective]["tags"]),
            "missing_count": len(perspectives[perspective]["missing_fields"]),
        }
        for perspective in (EXPERT_PERSPECTIVE, GROWTH_PERSPECTIVE)
    }
    update_index(
        output_root,
        {
            "name": f"biz-strategy-{slug}",
            "title": title,
            "source_path": str(kb_manifest.get("collection_manifest", "")),
            "skill_path": str(skill_dir),
            "schema_version": SCHEMA_VERSION,
            "knowledge_backend": "openkb",
            "fields": [item["field"] for item in tags],
            "missing_fields": missing,
            "perspective_stats": perspective_stats,
        },
    )
    return {"skill_dir": str(skill_dir), "name": f"biz-strategy-{slug}"}
