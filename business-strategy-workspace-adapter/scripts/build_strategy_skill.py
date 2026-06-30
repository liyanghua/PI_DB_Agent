#!/usr/bin/env python3
"""Compile a business strategy document into a portable strategy skill package."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from builder_common import (
    EXPERT_PERSPECTIVE,
    GROWTH_PERSPECTIVE,
    SCHEMA_VERSION,
    SCHEMA_VERSION_V1,
    build_perspectives,
    build_qa_index,
    build_v1_qa_index,
    default_schema_path,
    extract_v1_tags,
    flatten_missing_fields,
    flatten_open_questions,
    flatten_tags,
    read_text,
    render_digest,
    render_skill_md,
    render_v1_digest,
    render_v1_skill_md,
    slugify,
    title_from_document,
    update_index,
    _resolve_runtime_path,
)


def default_extractor_path() -> Path:
    return Path(__file__).resolve().parents[1] / "scripts" / "extract_document.py"


def _compact_reason(value: str, limit: int = 240) -> str:
    compact = re.sub(r"\s+", " ", value).strip()
    return compact[:limit] or "unknown"


def _extraction_workdir(slug: str, extraction_work_root: Path | None) -> Path:
    if extraction_work_root is not None:
        return extraction_work_root / slug
    return Path(tempfile.mkdtemp(prefix=f"hermes-biz-strategy-{slug}-"))


def extract_with_book_to_skill(
    *,
    source_path: Path,
    slug: str,
    extractor_path: Path | None = None,
    extraction_work_root: Path | None = None,
    extraction_mode: str = "text",
) -> tuple[str, dict[str, Any]]:
    extractor = extractor_path or default_extractor_path()
    workdir = _extraction_workdir(slug, extraction_work_root)
    full_text_path = workdir / "full_text.txt"
    metadata_path = workdir / "metadata.json"
    extraction = {
        "engine": "book-to-skill",
        "mode": extraction_mode,
        "workdir": str(workdir),
        "full_text_path": str(full_text_path),
        "metadata_path": str(metadata_path),
        "metadata": {},
        "fallback": False,
        "fallback_reason": "",
    }

    try:
        if not extractor.exists():
            raise FileNotFoundError(f"extractor_not_found:{extractor}")
        workdir.mkdir(parents=True, exist_ok=True)
        full_text_path.unlink(missing_ok=True)
        metadata_path.unlink(missing_ok=True)
        env = os.environ.copy()
        env["BOOK_SKILL_WORKDIR"] = str(workdir)
        result = subprocess.run(
            [
                sys.executable,
                str(extractor),
                str(source_path),
                "--mode",
                extraction_mode,
                "--install-missing",
                "no",
            ],
            cwd=str(source_path.parent),
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if result.returncode != 0:
            reason = result.stderr or result.stdout or f"exit {result.returncode}"
            raise RuntimeError(f"extractor_exit_{result.returncode}: {reason}")
        text = full_text_path.read_text(encoding="utf-8")
        if not text.strip():
            raise RuntimeError("extractor_produced_empty_full_text")
        metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
        extraction["metadata"] = metadata
        return text, extraction
    except Exception as exc:
        extraction["fallback"] = True
        extraction["fallback_reason"] = _compact_reason(str(exc))
        return read_text(source_path), extraction


def build_skill(
    *,
    source_path: Path,
    output_root: Path,
    schema_path: Path,
    slug: str | None = None,
    extractor_path: Path | None = None,
    extraction_work_root: Path | None = None,
    extraction_mode: str = "text",
    builder_version: str = "v2",
) -> dict[str, Any]:
    if builder_version not in {"v1", "v2"}:
        raise ValueError("builder_version must be 'v1' or 'v2'")
    invocation_cwd = Path.cwd().resolve()
    source_path = _resolve_runtime_path(source_path, base_dir=invocation_cwd)
    output_root = _resolve_runtime_path(output_root, base_dir=invocation_cwd)
    schema_path = _resolve_runtime_path(schema_path, base_dir=invocation_cwd)
    if extractor_path is not None:
        extractor_path = _resolve_runtime_path(extractor_path, base_dir=invocation_cwd)
    if extraction_work_root is not None:
        extraction_work_root = _resolve_runtime_path(
            extraction_work_root,
            base_dir=invocation_cwd,
        )
    slug = slug or slugify(source_path.stem)
    if builder_version == "v1":
        return build_v1_skill(
            source_path=source_path,
            output_root=output_root,
            schema_path=schema_path,
            slug=slug,
        )
    text, extraction = extract_with_book_to_skill(
        source_path=source_path,
        slug=slug,
        extractor_path=extractor_path,
        extraction_work_root=extraction_work_root,
        extraction_mode=extraction_mode,
    )
    title = title_from_document(source_path, text)
    skill_dir = output_root / "biz-strategy" / slug
    refs_dir = skill_dir / "references"
    refs_dir.mkdir(parents=True, exist_ok=True)

    perspectives = build_perspectives(text)
    tags = flatten_tags(perspectives)
    missing = flatten_missing_fields(perspectives)
    open_questions = flatten_open_questions(perspectives)
    payload = {
        "document_id": slug,
        "source_path": str(source_path),
        "source_paths": [str(source_path)],
        "schema_path": str(schema_path),
        "schema_version": SCHEMA_VERSION,
        "extraction": extraction,
        "perspectives": perspectives,
        "tags": tags,
        "evidence": [
            {
                "scheme": item["scheme"],
                "field": item["field"],
                "quote": item["evidence_quote"],
            }
            for item in tags
        ],
        "missing_fields": missing,
        "open_questions": open_questions,
        "qa_index": build_qa_index(tags),
    }

    (skill_dir / "SKILL.md").write_text(
        render_skill_md(title, slug, source_path, perspectives),
        encoding="utf-8",
    )
    (refs_dir / "schema_tags.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (refs_dir / "source_digest.md").write_text(
        render_digest(title, source_path, perspectives, extraction),
        encoding="utf-8",
    )

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
            "source_path": str(source_path),
            "skill_path": str(skill_dir),
            "schema_version": SCHEMA_VERSION,
            "fields": [item["field"] for item in tags],
            "missing_fields": missing,
            "perspective_stats": perspective_stats,
            "extraction": {
                "engine": extraction["engine"],
                "fallback": extraction["fallback"],
            },
        },
    )
    return {"skill_dir": str(skill_dir), "name": f"biz-strategy-{slug}"}


def build_v1_skill(
    *,
    source_path: Path,
    output_root: Path,
    schema_path: Path,
    slug: str,
) -> dict[str, Any]:
    text = read_text(source_path)
    title = title_from_document(source_path, text)
    skill_dir = output_root / "biz-strategy" / slug
    refs_dir = skill_dir / "references"
    refs_dir.mkdir(parents=True, exist_ok=True)

    tags, missing = extract_v1_tags(text)
    payload = {
        "document_id": slug,
        "source_path": str(source_path),
        "schema_path": str(schema_path),
        "schema_version": SCHEMA_VERSION_V1,
        "tags": tags,
        "evidence": [
            {"field": item["field"], "quote": item["evidence_quote"]}
            for item in tags
        ],
        "missing_fields": missing,
        "open_questions": [f"文档未明确说明：{field}" for field in missing],
        "qa_index": build_v1_qa_index(tags),
    }

    (skill_dir / "SKILL.md").write_text(
        render_v1_skill_md(title, slug, source_path, missing),
        encoding="utf-8",
    )
    (refs_dir / "schema_tags.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (refs_dir / "source_digest.md").write_text(
        render_v1_digest(title, source_path, tags, missing),
        encoding="utf-8",
    )

    update_index(
        output_root,
        {
            "name": f"biz-strategy-{slug}",
            "title": title,
            "source_path": str(source_path),
            "skill_path": str(skill_dir),
            "schema_version": SCHEMA_VERSION_V1,
            "fields": [item["field"] for item in tags],
            "missing_fields": missing,
        },
    )
    return {"skill_dir": str(skill_dir), "name": f"biz-strategy-{slug}"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--schema", default=None, type=Path)
    parser.add_argument("--output-root", default="generated-skills", type=Path)
    parser.add_argument("--slug", default="")
    parser.add_argument("--extractor", default=None, type=Path)
    parser.add_argument("--extraction-work-root", default=None, type=Path)
    parser.add_argument("--extraction-mode", choices=("text", "technical"), default="text")
    parser.add_argument("--builder-version", choices=("v1", "v2"), default="v2")
    args = parser.parse_args()
    result = build_skill(
        source_path=args.source,
        output_root=args.output_root,
        schema_path=args.schema or default_schema_path(),
        slug=args.slug or None,
        extractor_path=args.extractor,
        extraction_work_root=args.extraction_work_root,
        extraction_mode=args.extraction_mode,
        builder_version=args.builder_version,
    )
    print(json.dumps({"success": True, **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
