#!/usr/bin/env python3
"""CLI for Strategy KB collection validation, build, and skill compilation."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from collection_manifest import CollectionManifestError, load_collection_manifest
from kb_schema_compiler import KBSchemaCompilerError, compile_skill_from_kb
from openkb_adapter import OpenKBAdapterError, build_kb


def _print_json(payload: dict) -> int:
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_validate_collection(args: argparse.Namespace) -> int:
    manifest = load_collection_manifest(args.collection)
    return _print_json(
        {
            "success": True,
            "collection_id": manifest.id,
            "documents": len(manifest.documents),
            "relations": len(manifest.relations),
            "entrypoint": manifest.entrypoint,
        }
    )


def cmd_build_kb(args: argparse.Namespace) -> int:
    manifest = load_collection_manifest(args.collection)
    started = time.time()
    print(
        (
            f"[strategy-kb] build-kb start collection={manifest.id} "
            f"documents={len(manifest.documents)} mode={args.openkb_mode} output={args.output}"
        ),
        file=sys.stderr,
        flush=True,
    )
    payload = build_kb(
        collection=manifest,
        openkb_root=args.openkb_root,
        output_dir=args.output,
        openkb_entrypoint=args.openkb_entrypoint,
        openkb_mode=args.openkb_mode,
        openkb_model=args.openkb_model,
        openkb_timeout=args.openkb_timeout,
    )
    elapsed = time.time() - started
    print(
        (
            f"[strategy-kb] build-kb done collection={payload['collection_id']} "
            f"pages={len(payload.get('pages', []))} elapsed={elapsed:.1f}s"
        ),
        file=sys.stderr,
        flush=True,
    )
    return _print_json(
        {
            "success": True,
            "collection_id": payload["collection_id"],
            "backend": payload["backend"],
            "kb_manifest": str(Path(args.output).expanduser().resolve() / "kb_manifest.json"),
        }
    )


def cmd_compile_skill(args: argparse.Namespace) -> int:
    result = compile_skill_from_kb(
        kb_manifest_path=args.kb,
        schema_path=args.schema,
        output_root=args.output_root,
        slug=args.slug,
    )
    return _print_json({"success": True, **result})


def cmd_inspect_kb(args: argparse.Namespace) -> int:
    kb_manifest = json.loads(Path(args.kb).expanduser().resolve().read_text(encoding="utf-8"))
    return _print_json(
        {
            "success": True,
            "collection_id": kb_manifest["collection_id"],
            "backend": kb_manifest["backend"],
            "documents": len(kb_manifest.get("documents", [])),
            "relations": len(kb_manifest.get("relations", [])),
            "pages": len(kb_manifest.get("pages", [])),
        }
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate-collection")
    validate.add_argument("--collection", required=True, type=Path)
    validate.set_defaults(func=cmd_validate_collection)

    build = subparsers.add_parser("build-kb")
    build.add_argument("--collection", required=True, type=Path)
    build.add_argument("--openkb-root", required=True, type=Path)
    build.add_argument("--output", required=True, type=Path)
    build.add_argument("--openkb-entrypoint", default=None, type=Path)
    build.add_argument(
        "--openkb-model",
        default=None,
        help="Model string for upstream OpenKB/LiteLLM, e.g. deepseek/deepseek-chat.",
    )
    build.add_argument(
        "--openkb-timeout",
        default=None,
        type=int,
        help="LiteLLM request timeout in seconds for upstream OpenKB ingestion.",
    )
    build.add_argument(
        "--openkb-mode",
        choices=("auto", "source-only", "cli-ingest"),
        default="auto",
        help=(
            "How to use a real OpenKB checkout. auto uses cli-ingest only when "
            "runtime dependencies and an LLM key are available; otherwise it "
            "exports source-backed normalized artifacts."
        ),
    )
    build.set_defaults(func=cmd_build_kb)

    compile_skill = subparsers.add_parser("compile-skill")
    compile_skill.add_argument("--kb", required=True, type=Path)
    compile_skill.add_argument("--schema", required=True, type=Path)
    compile_skill.add_argument("--output-root", required=True, type=Path)
    compile_skill.add_argument("--slug", required=True)
    compile_skill.set_defaults(func=cmd_compile_skill)

    inspect_kb = subparsers.add_parser("inspect-kb")
    inspect_kb.add_argument("--kb", required=True, type=Path)
    inspect_kb.set_defaults(func=cmd_inspect_kb)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.func(args))
    except (CollectionManifestError, OpenKBAdapterError, KBSchemaCompilerError, FileNotFoundError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
