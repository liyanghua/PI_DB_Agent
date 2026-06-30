#!/usr/bin/env python3
"""Portable document extractor for business strategy skill generation."""

from __future__ import annotations

import argparse
import glob
import html
import json
import os
import re
import sys
import tempfile
from pathlib import Path


TEXT_EXTENSIONS = {".txt", ".text", ".md", ".markdown", ".rst", ".adoc", ".asciidoc"}
HTML_EXTENSIONS = {".html", ".htm", ".xhtml"}
SUPPORTED_EXTENSIONS = TEXT_EXTENSIONS | HTML_EXTENSIONS
WORDS_PER_TOKEN = 0.75


def _workdir() -> Path:
    return Path(os.environ.get("BOOK_SKILL_WORKDIR", str(Path(tempfile.gettempdir()) / "book_skill_work")))


def _read_text(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="utf-8", errors="replace")


def _strip_html(value: str) -> str:
    value = re.sub(r"(?is)<(script|style).*?</\1>", "\n", value)
    value = re.sub(r"(?s)<[^>]+>", "\n", value)
    value = html.unescape(value)
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def _estimate_tokens(text: str) -> int:
    return int(len(text.split()) / WORDS_PER_TOKEN)


def _heading_sample(text: str) -> list[str]:
    headings: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if re.match(r"^#{1,6}\s+\S", stripped):
            headings.append(stripped)
        if len(headings) >= 10:
            break
    return headings


def _detect_structure(text: str) -> dict[str, object]:
    headings = _heading_sample(text)
    return {
        "chapters_detected": len([line for line in headings if line.startswith("# ")]),
        "chapter_headings_sample": headings,
        "has_toc": bool(re.search(r"^\s*(目录|目錄|table of contents|contents)\s*$", text[:30000], re.I | re.M)),
    }


def _resolve_inputs(patterns: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw in patterns:
        if any(char in raw for char in ("*", "?", "[")):
            matches = sorted(glob.glob(raw, recursive=True), key=str.lower)
            files.extend(Path(match).resolve() for match in matches if Path(match).is_file())
            continue
        path = Path(raw)
        if path.is_dir():
            nested = sorted(
                (item for item in path.rglob("*") if item.is_file()),
                key=lambda item: str(item).lower(),
            )
            files.extend(item.resolve() for item in nested)
        else:
            files.append(path.resolve())
    unique: list[Path] = []
    seen: set[Path] = set()
    for path in files:
        if path in seen:
            continue
        seen.add(path)
        unique.append(path)
    return unique


def _extract_one(path: Path, mode: str) -> dict[str, object]:
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported format '{suffix or '<none>'}'. Portable extractor supports: "
            f"{', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )
    text = _read_text(path)
    method = "portable-text"
    if suffix in HTML_EXTENSIONS:
        text = _strip_html(text)
        method = "portable-html"
    if not text.strip():
        raise ValueError(f"Could not extract text from empty source: {path}")
    stat = path.stat()
    return {
        "source_file": str(path.resolve()),
        "filename": path.name,
        "format": suffix.lstrip("."),
        "extraction_method": method,
        "extraction_mode": mode,
        "file_size_mb": round(stat.st_size / (1024 * 1024), 2),
        "pages": 0,
        "chars": len(text),
        "words": len(text.split()),
        "estimated_tokens": _estimate_tokens(text),
        "text": text,
        **_detect_structure(text),
    }


def extract_documents(input_paths: list[str], *, mode: str = "text", workdir: Path | None = None) -> dict[str, object]:
    workdir = workdir or _workdir()
    files = _resolve_inputs(input_paths)
    if not files:
        raise ValueError("No input document, folder, or glob pattern specified.")

    extracted: list[dict[str, object]] = []
    errors: list[dict[str, str]] = []
    combined: list[str] = []
    for path in files:
        try:
            item = _extract_one(path, mode)
        except Exception as exc:
            errors.append({"source_file": str(path), "error": str(exc)})
            continue
        extracted.append(item)
        combined.append(
            "\n\n"
            + "=" * 80
            + f"\nSOURCE: {item['filename']} (Path: {item['source_file']})\n"
            + "=" * 80
            + "\n\n"
            + str(item["text"])
        )

    if not extracted:
        raise RuntimeError(f"All {len(errors)} source(s) failed extraction: {errors}")

    full_text = "".join(combined).strip()
    workdir.mkdir(parents=True, exist_ok=True)
    full_text_path = workdir / "full_text.txt"
    metadata_path = workdir / "metadata.json"
    full_text_path.write_text(full_text, encoding="utf-8")

    metadata = {
        "engine": "book-to-skill",
        "portable": True,
        "extraction_method": "portable-text",
        "extraction_mode": mode,
        "total_sources": len(extracted),
        "sources": [
            {key: value for key, value in item.items() if key != "text"}
            for item in extracted
        ],
        "errors": errors,
        "chars": len(full_text),
        "words": len(full_text.split()),
        "estimated_tokens": _estimate_tokens(full_text),
        "estimated_tokens_human": f"~{max(1, round(_estimate_tokens(full_text) / 1000))}K",
        **_detect_structure(full_text),
        "output_text": str(full_text_path),
    }
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*")
    parser.add_argument("--mode", choices=("text", "technical"), default="text")
    parser.add_argument("--install-missing", default="no")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        print("portable extractor: ok")
        return 0
    if not args.paths:
        parser.error("at least one source path is required")
    try:
        extract_documents(args.paths, mode=args.mode)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
