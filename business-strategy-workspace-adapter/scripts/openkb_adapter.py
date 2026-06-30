#!/usr/bin/env python3
"""Normalize OpenKB builds for Strategy KB generation."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
from datetime import datetime, timezone
from importlib.util import find_spec
from pathlib import Path
from typing import Any

from collection_manifest import CollectionManifest


MANIFEST_CONTRACT_VERSION = "strategy-kb-manifest-v1"


class OpenKBAdapterError(RuntimeError):
    """Raised when OpenKB cannot be built or normalized."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _resolve_path(path: Path) -> Path:
    return path.expanduser().resolve()


def _find_entrypoint(openkb_root: Path, openkb_entrypoint: Path | None = None) -> Path:
    if openkb_entrypoint is not None:
        entrypoint = _resolve_path(openkb_entrypoint)
        if not entrypoint.exists():
            raise OpenKBAdapterError(f"OpenKB entrypoint does not exist: {entrypoint}")
        return entrypoint
    fake_entrypoint = openkb_root / "build_fake_openkb.py"
    if fake_entrypoint.exists():
        return fake_entrypoint
    raise OpenKBAdapterError(
        "Could not find an OpenKB entrypoint. Pass --openkb-entrypoint or install OpenKB under ./third_party/OpenKB."
    )


def _is_real_openkb_checkout(openkb_root: Path) -> bool:
    return (openkb_root / "openkb" / "cli.py").exists() and (openkb_root / "pyproject.toml").exists()


def _first_useful_line(path: Path) -> str:
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped == "---":
            continue
        return stripped
    return path.stem


def _source_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _copy_source_documents(collection: CollectionManifest, workspace: Path) -> None:
    raw_dir = workspace / "raw"
    sources_dir = workspace / "wiki" / "sources"
    raw_dir.mkdir(parents=True, exist_ok=True)
    sources_dir.mkdir(parents=True, exist_ok=True)
    for doc in collection.documents:
        target_name = f"{doc.id}__{doc.path.name}"
        shutil.copy2(doc.path, raw_dir / target_name)
        shutil.copy2(doc.path, sources_dir / target_name)


def _env_file_values(openkb_root: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    env_file = openkb_root / ".env"
    if not env_file.exists():
        return values
    for line in env_file.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def _openkb_model(openkb_root: Path, openkb_model: str | None = None) -> str:
    if openkb_model:
        return openkb_model
    if os.environ.get("OPENKB_MODEL"):
        return str(os.environ["OPENKB_MODEL"])
    env_values = _env_file_values(openkb_root)
    return env_values.get("OPENKB_MODEL", "gpt-5.4-mini")


def _yaml_scalar(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _header_name_from_env_suffix(suffix: str) -> str:
    aliases = {
        "HTTP_REFERER": "HTTP-Referer",
        "REFERER": "HTTP-Referer",
        "X_TITLE": "X-OpenRouter-Title",
        "X_OPENROUTER_TITLE": "X-OpenRouter-Title",
    }
    normalized = suffix.strip("_").upper()
    if normalized in aliases:
        return aliases[normalized]
    return "-".join(part.capitalize() for part in normalized.split("_") if part)


def _openkb_extra_headers(openkb_root: Path) -> dict[str, str]:
    values = _env_file_values(openkb_root)
    values.update({key: value for key, value in os.environ.items() if value})

    headers: dict[str, str] = {}
    referer = values.get("OPENROUTER_HTTP_REFERER") or values.get("OR_SITE_URL")
    if referer:
        headers["HTTP-Referer"] = referer
    title = values.get("OPENROUTER_X_TITLE") or values.get("OPENROUTER_APP_NAME") or values.get("OR_APP_NAME")
    if title:
        headers["X-OpenRouter-Title"] = title

    prefix = "OPENKB_EXTRA_HEADER_"
    for key, value in sorted(values.items()):
        if key.startswith(prefix) and value:
            headers[_header_name_from_env_suffix(key[len(prefix) :])] = value
    return headers


def _secret_values(openkb_root: Path) -> list[str]:
    values = []
    for source in (os.environ, _env_file_values(openkb_root)):
        for key, value in source.items():
            if not value:
                continue
            upper = key.upper()
            if upper.endswith("API_KEY") or upper in {"LLM_API_KEY", "OPENKB_API_KEY"}:
                values.append(str(value))
    return sorted(set(values), key=len, reverse=True)


def _redact(text: str, openkb_root: Path) -> str:
    redacted = text
    for value in _secret_values(openkb_root):
        redacted = redacted.replace(value, "[REDACTED]")
    redacted = re.sub(r"sk-[A-Za-z0-9_-]{8,}", "[REDACTED]", redacted)
    return redacted


def _append_log(log_path: Path, message: str, openkb_root: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(_redact(message, openkb_root))
        if not message.endswith("\n"):
            handle.write("\n")


def _progress(message: str) -> None:
    print(f"[strategy-kb] {message}", file=sys.stderr, flush=True)


def _write_openkb_workspace_seed(
    collection: CollectionManifest,
    workspace: Path,
    *,
    openkb_root: Path,
    openkb_model: str | None = None,
) -> None:
    if workspace.exists():
        shutil.rmtree(workspace)
    (workspace / ".openkb").mkdir(parents=True)
    for rel in ("wiki/sources/images", "wiki/summaries", "wiki/concepts", "wiki/entities", "wiki/reports"):
        (workspace / rel).mkdir(parents=True, exist_ok=True)
    model = _openkb_model(openkb_root, openkb_model)
    config_lines = [
        f"model: {model}",
        "language: zh",
        "pageindex_threshold: 20",
    ]
    extra_headers = _openkb_extra_headers(openkb_root)
    if extra_headers:
        config_lines.append("extra_headers:")
        for key, value in extra_headers.items():
            config_lines.append(f"  {key}: {_yaml_scalar(value)}")
    (workspace / ".openkb" / "config.yaml").write_text("\n".join(config_lines) + "\n", encoding="utf-8")
    (workspace / ".openkb" / "hashes.json").write_text("{}\n", encoding="utf-8")
    (workspace / "wiki" / "AGENTS.md").write_text(
        f"# OpenKB Wiki Schema\n\nCollection: {collection.title}\n",
        encoding="utf-8",
    )
    (workspace / "wiki" / "index.md").write_text(
        f"# {collection.title}\n\nStrategy KB workspace generated from `{collection.manifest_path}`.\n",
        encoding="utf-8",
    )
    (workspace / "wiki" / "log.md").write_text("# Operations Log\n\n", encoding="utf-8")
    _copy_source_documents(collection, workspace)


def _source_pages_and_citations(collection: CollectionManifest) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    pages: list[dict[str, Any]] = []
    citations: list[dict[str, Any]] = []
    for doc in collection.documents:
        page_id = f"openkb-page-{doc.id}"
        chunk_id = f"chunk-{doc.id}-001"
        pages.append(
            {
                "page_id": page_id,
                "doc_id": doc.id,
                "title": doc.title,
                "source_path": str(doc.path),
                "chunk_ids": [chunk_id],
                "full_text": _source_text(doc.path),
                "page_type": "source",
            }
        )
        citations.append(
            {
                "citation_id": f"cite-{doc.id}-001",
                "doc_id": doc.id,
                "source_path": str(doc.path),
                "kb_page_id": page_id,
                "chunk_id": chunk_id,
                "quote": _first_useful_line(doc.path),
                "anchor": doc.title,
                "score": 0.95,
            }
        )
    return pages, citations


def _collect_compiled_wiki_pages(workspace: Path) -> list[dict[str, Any]]:
    wiki = workspace / "wiki"
    pages: list[dict[str, Any]] = []
    for subdir in ("summaries", "concepts", "entities"):
        root = wiki / subdir
        if not root.exists():
            continue
        for path in sorted(root.rglob("*.md")):
            rel = path.relative_to(wiki)
            page_id = "openkb-wiki-" + str(rel.with_suffix("")).replace(os.sep, "-")
            pages.append(
                {
                    "page_id": page_id,
                    "doc_id": f"wiki:{rel.with_suffix('')}",
                    "title": path.stem,
                    "source_path": str(path),
                    "chunk_ids": [f"chunk-{page_id}-001"],
                    "full_text": _source_text(path),
                    "page_type": subdir.rstrip("s"),
                }
            )
    return pages


def _write_raw_artifacts(
    *,
    raw_dir: Path,
    pages: list[dict[str, Any]],
    citations: list[dict[str, Any]],
    build_payload: dict[str, Any],
) -> None:
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / "pages.json").write_text(json.dumps(pages, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (raw_dir / "citations.json").write_text(json.dumps(citations, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (raw_dir / "build.json").write_text(json.dumps(build_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _provider_key_present(openkb_root: Path | None = None) -> bool:
    provider_keys = (
        "LLM_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "OPENROUTER_API_KEY",
        "DEEPSEEK_API_KEY",
        "MISTRAL_API_KEY",
        "MOONSHOT_API_KEY",
        "ZHIPUAI_API_KEY",
        "DASHSCOPE_API_KEY",
    )
    if any(os.environ.get(key) for key in provider_keys):
        return True
    if openkb_root is None:
        return False
    env_values = _env_file_values(openkb_root)
    return any(env_values.get(key) for key in provider_keys)


def _openkb_runtime_dependencies_available() -> bool:
    return all(find_spec(name) is not None for name in ("click", "yaml", "dotenv", "litellm", "agents", "markitdown", "pageindex"))


def _openkb_env(openkb_root: Path) -> dict[str, str]:
    env = os.environ.copy()
    for key, value in _env_file_values(openkb_root).items():
        env.setdefault(key, value)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(openkb_root) + (os.pathsep + existing if existing else "")
    return env


def _timeout_value(openkb_timeout: int | None = None) -> int | None:
    if openkb_timeout is not None:
        return int(openkb_timeout)
    raw = os.environ.get("OPENKB_LITELLM_TIMEOUT") or os.environ.get("OPENKB_TIMEOUT")
    if not raw:
        return None
    return int(raw)


def _run_openkb_cli(
    *,
    openkb_root: Path,
    workspace: Path,
    args: list[str],
    input_text: str | None = None,
    openkb_timeout: int | None = None,
    log_path: Path | None = None,
    doc_id: str | None = None,
) -> subprocess.CompletedProcess[str]:
    env = _openkb_env(openkb_root)
    timeout = _timeout_value(openkb_timeout)
    if timeout is not None:
        env["OPENKB_LITELLM_TIMEOUT"] = str(timeout)
    if log_path is not None:
        env["OPENKB_STRATEGY_KB_LOG"] = str(log_path)

    process = subprocess.Popen(
        [sys.executable, "-m", "openkb", *args],
        cwd=str(workspace),
        env=env,
        stdin=subprocess.PIPE if input_text is not None else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if input_text is not None and process.stdin is not None:
        process.stdin.write(input_text)
        process.stdin.close()

    stdout_lines: list[str] = []
    stderr_lines: list[str] = []

    def consume_stream(stream, sink: list[str], stream_name: str) -> None:
        if stream is None:
            return
        for line in stream:
            sink.append(line)
            if log_path is not None:
                _append_log(
                    log_path,
                    f"[{_utc_now()}] {stream_name} stream doc_id={doc_id or ''} {line}",
                    openkb_root,
                )

    stdout_thread = threading.Thread(target=consume_stream, args=(process.stdout, stdout_lines, "stdout"), daemon=True)
    stderr_thread = threading.Thread(target=consume_stream, args=(process.stderr, stderr_lines, "stderr"), daemon=True)
    stdout_thread.start()
    stderr_thread.start()
    returncode = process.wait()
    stdout_thread.join()
    stderr_thread.join()
    return subprocess.CompletedProcess(
        args=[sys.executable, "-m", "openkb", *args],
        returncode=returncode,
        stdout="".join(stdout_lines),
        stderr="".join(stderr_lines),
    )


def _build_real_source_only(
    *,
    collection: CollectionManifest,
    openkb_root: Path,
    raw_dir: Path,
    workspace: Path,
    openkb_model: str | None,
) -> dict[str, Any]:
    _write_openkb_workspace_seed(collection, workspace, openkb_root=openkb_root, openkb_model=openkb_model)
    _progress(f"source-only normalize {len(collection.documents)} documents")
    pages, citations = _source_pages_and_citations(collection)
    build_payload = {
        "backend": "openkb",
        "runtime": "real-openkb",
        "adapter_mode": "source-only",
        "status": "success",
        "openkb_root": str(openkb_root),
        "openkb_workspace": str(workspace),
        "model": _openkb_model(openkb_root, openkb_model),
        "documents": len(collection.documents),
        "pages": len(pages),
        "citations": len(citations),
        "note": "OpenKB checkout detected; source documents were normalized without LLM ingestion.",
    }
    _write_raw_artifacts(raw_dir=raw_dir, pages=pages, citations=citations, build_payload=build_payload)
    _progress(f"source-only artifacts written pages={len(pages)} citations={len(citations)}")
    return build_payload


def _build_real_cli_ingest(
    *,
    collection: CollectionManifest,
    openkb_root: Path,
    raw_dir: Path,
    workspace: Path,
    output_dir: Path,
    openkb_model: str | None,
    openkb_timeout: int | None,
) -> dict[str, Any]:
    if not _openkb_runtime_dependencies_available():
        raise OpenKBAdapterError(
            "OpenKB CLI dependencies are not installed in this Python environment. "
            "Install third_party/OpenKB dependencies or use --openkb-mode source-only."
        )

    if workspace.exists():
        shutil.rmtree(workspace)
    _write_openkb_workspace_seed(collection, workspace, openkb_root=openkb_root, openkb_model=openkb_model)

    log_dir = output_dir / "logs"
    log_path = log_dir / "openkb_adapter.log"
    model = _openkb_model(openkb_root, openkb_model)
    timeout = _timeout_value(openkb_timeout)
    _progress(f"cli-ingest logs: {log_path}")
    _progress(f"cli-ingest model={model} timeout_seconds={timeout or 'default'} documents={len(collection.documents)}")
    _append_log(
        log_path,
        f"[{_utc_now()}] start cli-ingest collection={collection.id} model={model} timeout_seconds={timeout or ''} workspace={workspace}\n",
        openkb_root,
    )

    add_outputs: list[dict[str, str]] = []
    for index, doc in enumerate(collection.documents, start=1):
        started_at = _utc_now()
        _progress(f"openkb add {index}/{len(collection.documents)} doc_id={doc.id} title={doc.title}")
        _append_log(log_path, f"[{started_at}] add start {index}/{len(collection.documents)} doc_id={doc.id} path={doc.path}\n", openkb_root)
        result = _run_openkb_cli(
            openkb_root=openkb_root,
            workspace=workspace,
            args=["add", str(doc.path)],
            openkb_timeout=timeout,
            log_path=log_path,
            doc_id=doc.id,
        )
        safe_stdout = _redact(result.stdout, openkb_root)
        safe_stderr = _redact(result.stderr, openkb_root)
        stdout_path = log_dir / f"add_{index:02d}_{doc.id}_stdout.log"
        stderr_path = log_dir / f"add_{index:02d}_{doc.id}_stderr.log"
        stdout_path.write_text(safe_stdout, encoding="utf-8")
        stderr_path.write_text(safe_stderr, encoding="utf-8")
        add_outputs.append(
            {
                "doc_id": doc.id,
                "stdout_log": str(stdout_path),
                "stderr_log": str(stderr_path),
                "stdout": safe_stdout[-2000:],
                "stderr": safe_stderr[-2000:],
            }
        )
        combined = f"{result.stdout}\n{result.stderr}"
        _append_log(
            log_path,
            f"[{_utc_now()}] add finish doc_id={doc.id} exit={result.returncode} stdout_log={stdout_path} stderr_log={stderr_path}\n",
            openkb_root,
        )
        _progress(f"openkb add {index}/{len(collection.documents)} finished exit={result.returncode} stdout_log={stdout_path.name}")
        if safe_stdout.strip():
            _append_log(log_path, f"[{_utc_now()}] stdout doc_id={doc.id}\n{safe_stdout[-1200:]}\n", openkb_root)
        if safe_stderr.strip():
            _append_log(log_path, f"[{_utc_now()}] stderr doc_id={doc.id}\n{safe_stderr[-1200:]}\n", openkb_root)
        if result.returncode != 0 or "[ERROR]" in combined:
            _append_log(log_path, f"[{_utc_now()}] add failed doc_id={doc.id}\n{safe_stdout}\n{safe_stderr}\n", openkb_root)
            _progress(f"openkb add failed doc_id={doc.id}; see {log_path}")
            raise OpenKBAdapterError(
                f"OpenKB add failed for {doc.id} with exit {result.returncode}. "
                f"See backend logs: {log_path}"
            )

    pages, citations = _source_pages_and_citations(collection)
    pages.extend(_collect_compiled_wiki_pages(workspace))
    build_payload = {
        "backend": "openkb",
        "runtime": "real-openkb",
        "adapter_mode": "cli-ingest",
        "status": "success",
        "openkb_root": str(openkb_root),
        "openkb_workspace": str(workspace),
        "model": model,
        "timeout_seconds": timeout,
        "log_path": str(log_path),
        "documents": len(collection.documents),
        "pages": len(pages),
        "citations": len(citations),
        "add_outputs": add_outputs,
    }
    _write_raw_artifacts(raw_dir=raw_dir, pages=pages, citations=citations, build_payload=build_payload)
    _progress(f"cli-ingest artifacts written pages={len(pages)} citations={len(citations)}")
    return build_payload


def _build_real_openkb_raw(
    *,
    collection: CollectionManifest,
    openkb_root: Path,
    output_dir: Path,
    raw_dir: Path,
    openkb_mode: str,
    openkb_model: str | None,
    openkb_timeout: int | None,
) -> dict[str, Any]:
    workspace = output_dir / "openkb_workspace"
    if openkb_mode not in {"auto", "source-only", "cli-ingest"}:
        raise OpenKBAdapterError("openkb_mode must be one of: auto, source-only, cli-ingest")
    if openkb_mode == "cli-ingest":
        return _build_real_cli_ingest(
            collection=collection,
            openkb_root=openkb_root,
            raw_dir=raw_dir,
            workspace=workspace,
            output_dir=output_dir,
            openkb_model=openkb_model,
            openkb_timeout=openkb_timeout,
        )
    if openkb_mode == "auto" and _provider_key_present(openkb_root) and _openkb_runtime_dependencies_available():
        return _build_real_cli_ingest(
            collection=collection,
            openkb_root=openkb_root,
            raw_dir=raw_dir,
            workspace=workspace,
            output_dir=output_dir,
            openkb_model=openkb_model,
            openkb_timeout=openkb_timeout,
        )
    return _build_real_source_only(
        collection=collection,
        openkb_root=openkb_root,
        raw_dir=raw_dir,
        workspace=workspace,
        openkb_model=openkb_model,
    )


def _collection_payload(collection: CollectionManifest) -> dict[str, Any]:
    return {
        "schema_version": collection.schema_version,
        "id": collection.id,
        "title": collection.title,
        "domain": collection.domain,
        "entrypoint": collection.entrypoint,
        "root": str(collection.root),
        "default_slug": collection.default_slug,
        "schema_path": str(collection.schema_path),
        "manifest_path": str(collection.manifest_path),
        "documents": [
            {
                "id": doc.id,
                "path": str(doc.path),
                "title": doc.title,
                "role": doc.role,
                "topics": doc.topics,
            }
            for doc in collection.documents
        ],
        "relations": [
            {
                "from": rel.from_id,
                "to": rel.to_id,
                "type": rel.type,
                "anchor": rel.anchor,
                "external_url": rel.external_url,
                "supports_fields": rel.supports_fields,
            }
            for rel in collection.relations
        ],
    }


def _load_json(path: Path) -> Any:
    if not path.exists():
        raise OpenKBAdapterError(f"OpenKB raw artifact missing: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _page_ids_by_doc(pages: list[dict[str, Any]]) -> dict[str, list[str]]:
    page_ids: dict[str, list[str]] = {}
    for page in pages:
        doc_id = str(page.get("doc_id", ""))
        page_id = str(page.get("page_id", ""))
        if not doc_id or not page_id:
            continue
        page_ids.setdefault(doc_id, []).append(page_id)
    return page_ids


def _linked_from(collection: CollectionManifest) -> dict[str, list[dict[str, Any]]]:
    linked: dict[str, list[dict[str, Any]]] = {}
    for rel in collection.relations:
        linked.setdefault(rel.to_id, []).append(
            {
                "from": rel.from_id,
                "type": rel.type,
                "anchor": rel.anchor,
                "external_url": rel.external_url,
                "supports_fields": rel.supports_fields,
            }
        )
    return linked


def build_kb(
    *,
    collection: CollectionManifest,
    openkb_root: Path,
    output_dir: Path,
    openkb_entrypoint: Path | None = None,
    openkb_mode: str = "auto",
    openkb_model: str | None = None,
    openkb_timeout: int | None = None,
) -> dict[str, Any]:
    openkb_root = _resolve_path(openkb_root)
    if not openkb_root.exists():
        raise OpenKBAdapterError(f"OpenKB root does not exist: {openkb_root}")
    output_dir = _resolve_path(output_dir)
    raw_dir = output_dir / "openkb_raw"
    output_dir.mkdir(parents=True, exist_ok=True)
    if raw_dir.exists():
        shutil.rmtree(raw_dir)
    raw_dir.mkdir(parents=True)

    collection_json = output_dir / "collection.normalized.json"
    collection_json.write_text(json.dumps(_collection_payload(collection), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    started_at = _utc_now()
    build_payload: dict[str, Any] = {}
    entrypoint_label = ""
    if openkb_entrypoint is None and _is_real_openkb_checkout(openkb_root):
        build_payload = _build_real_openkb_raw(
            collection=collection,
            openkb_root=openkb_root,
            output_dir=output_dir,
            raw_dir=raw_dir,
            openkb_mode=openkb_mode,
            openkb_model=openkb_model,
            openkb_timeout=openkb_timeout,
        )
        entrypoint_label = "openkb.cli"
        result_returncode = 0
        result_output = ""
    else:
        entrypoint = _find_entrypoint(openkb_root, openkb_entrypoint)
        entrypoint_label = str(entrypoint)
        result = subprocess.run(
            [
                sys.executable,
                str(entrypoint),
                "--collection",
                str(collection_json),
                "--output",
                str(raw_dir),
            ],
            cwd=str(openkb_root),
            text=True,
            capture_output=True,
            check=False,
        )
        result_returncode = result.returncode
        result_output = result.stderr or result.stdout
    finished_at = _utc_now()
    if result_returncode != 0:
        raise OpenKBAdapterError(
            f"OpenKB build failed with exit {result_returncode}: {result_output}"
        )

    pages = _load_json(raw_dir / "pages.json")
    raw_citations = _load_json(raw_dir / "citations.json")
    if not isinstance(pages, list):
        raise OpenKBAdapterError("OpenKB pages artifact must be a list")
    if not isinstance(raw_citations, list):
        raise OpenKBAdapterError("OpenKB citations artifact must be a list")

    page_ids = _page_ids_by_doc(pages)
    linked = _linked_from(collection)
    documents = [
        {
            "id": doc.id,
            "title": doc.title,
            "path": str(doc.path),
            "role": doc.role,
            "topics": doc.topics,
            "page_ids": page_ids.get(doc.id, []),
            "full_text": next((str(page.get("full_text", "")) for page in pages if page.get("doc_id") == doc.id), ""),
        }
        for doc in collection.documents
    ]
    relations = [
        {
            "from": rel.from_id,
            "to": rel.to_id,
            "type": rel.type,
            "anchor": rel.anchor,
            "external_url": rel.external_url,
            "supports_fields": rel.supports_fields,
        }
        for rel in collection.relations
    ]
    citations = [
        {
            "citation_id": str(item["citation_id"]),
            "doc_id": str(item["doc_id"]),
            "source_path": str(item["source_path"]),
            "kb_page_id": str(item["kb_page_id"]),
            "chunk_id": str(item["chunk_id"]),
            "quote": str(item["quote"]),
            "anchor": str(item["anchor"]),
            "score": float(item.get("score", 0.0)),
        }
        for item in raw_citations
    ]

    source_map = {
        "contract_version": "strategy-kb-source-map-v1",
        "collection_id": collection.id,
        "documents": [
            {
                **doc,
                "linked_from": linked.get(doc["id"], []),
            }
            for doc in documents
        ],
    }
    citations_payload = {
        "contract_version": "strategy-kb-citations-v1",
        "collection_id": collection.id,
        "citations": citations,
    }
    manifest = {
        "contract_version": MANIFEST_CONTRACT_VERSION,
        "backend": "openkb",
        "backend_root": str(openkb_root),
        "collection_id": collection.id,
        "collection_title": collection.title,
        "collection_manifest": str(collection.manifest_path),
        "schema_path": str(collection.schema_path),
        "entrypoint_doc_id": collection.entrypoint,
        "documents": documents,
        "relations": relations,
        "pages": pages,
        "artifact_paths": {
            "source_map": str(output_dir / "source_map.json"),
            "citations": str(output_dir / "citations.json"),
            "openkb_raw": str(raw_dir),
        },
        "build": {
            "status": "success",
            "started_at": started_at,
            "finished_at": finished_at,
            "entrypoint": entrypoint_label,
            **build_payload,
        },
    }

    (output_dir / "source_map.json").write_text(json.dumps(source_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "citations.json").write_text(json.dumps(citations_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "kb_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest
