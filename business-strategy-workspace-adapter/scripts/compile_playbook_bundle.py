#!/usr/bin/env python3
"""Compile a portable scenario playbook bundle from Strategy KB artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "business-strategy-playbook-bundle-v1"
PLAYBOOK_VERSION = "business-strategy-playbook-v1"


def _load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.expanduser().resolve().read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _new_product_nodes() -> list[dict[str, Any]]:
    return [
        {
            "node_id": "define_scope",
            "title": "明确分析边界",
            "runtime": "strategy",
            "depends_on": [],
            "input_schema": {"required": ["category", "date_range"]},
            "runtime_request": {"kind": "hermes_request", "expected_output": "analysis_scope"},
            "artifact_templates": ["analysis_scope"],
            "failure_policy": "request_user_input",
            "rerun_policy": "allowed",
        },
        {
            "node_id": "industry_top300_analysis",
            "title": "行业TOP300分析",
            "runtime": "pi_agent",
            "depends_on": ["define_scope"],
            "input_schema": {"required": ["category", "date_range"]},
            "runtime_request": {"kind": "pi_agent_request", "capability": "category_market_analysis"},
            "artifact_templates": ["industry_top300_summary", "mainstream_product_structure"],
            "failure_policy": "record_failure_and_continue",
            "rerun_policy": "allowed",
        },
        {
            "node_id": "keyword_demand_analysis",
            "title": "关键词需求分析",
            "runtime": "pi_agent",
            "depends_on": ["define_scope"],
            "input_schema": {"required": ["category", "date_range"]},
            "runtime_request": {
                "kind": "pi_agent_request",
                "capability": "keyword_demand",
                "tool": "analyze_keyword_demand",
            },
            "artifact_templates": ["keyword_demand_table", "keyword_demand_summary"],
            "failure_policy": "record_failure_and_block_dependents",
            "rerun_policy": "allowed",
        },
        {
            "node_id": "review_qa_pain_analysis",
            "title": "评价/问大家痛点分析",
            "runtime": "pi_agent",
            "depends_on": ["define_scope"],
            "input_schema": {"required": ["category", "date_range"]},
            "runtime_request": {"kind": "pi_agent_request", "capability": "review_qa_pain_analysis"},
            "artifact_templates": ["pain_point_table", "upgrade_opportunity_summary"],
            "failure_policy": "mark_blocked_by_capability",
            "rerun_policy": "allowed",
        },
        {
            "node_id": "price_band_opportunity",
            "title": "价格带机会判断",
            "runtime": "pi_agent",
            "depends_on": ["industry_top300_analysis", "keyword_demand_analysis"],
            "input_schema": {"required": ["category", "date_range"]},
            "runtime_request": {"kind": "pi_agent_request", "capability": "price_band_opportunity"},
            "artifact_templates": ["price_band_opportunity_table", "price_role_recommendation"],
            "failure_policy": "record_failure_and_continue",
            "rerun_policy": "allowed",
        },
        {
            "node_id": "competitor_analysis",
            "title": "竞品分析",
            "runtime": "pi_agent",
            "depends_on": ["define_scope", "keyword_demand_analysis"],
            "input_schema": {"required": ["category", "date_range"]},
            "runtime_request": {
                "kind": "pi_agent_request",
                "capability": "keyword_competition",
                "tool": "analyze_keyword_competition",
            },
            "artifact_templates": ["competitor_breakthrough_table", "competitor_analysis_summary"],
            "failure_policy": "record_failure_and_continue",
            "rerun_policy": "allowed",
        },
        {
            "node_id": "opportunity_score",
            "title": "机会评分",
            "runtime": "pi_agent",
            "depends_on": ["keyword_demand_analysis", "price_band_opportunity", "competitor_analysis"],
            "input_schema": {"required": ["category", "date_range"]},
            "runtime_request": {
                "kind": "pi_agent_request",
                "capability": "koif_router",
                "tool": "propose_koif_strategy",
            },
            "artifact_templates": ["opportunity_scorecard", "opportunity_score_summary"],
            "failure_policy": "mark_blocked_by_capability",
            "rerun_policy": "allowed",
        },
        {
            "node_id": "launch_brief",
            "title": "新品立项表",
            "runtime": "strategy",
            "depends_on": ["opportunity_score"],
            "input_schema": {"required": ["category"]},
            "runtime_request": {"kind": "hermes_request", "expected_output": "launch_brief"},
            "artifact_templates": ["new_product_launch_brief"],
            "failure_policy": "record_failure_and_block_dependents",
            "rerun_policy": "allowed",
        },
        {
            "node_id": "link_planning",
            "title": "链接规划",
            "runtime": "strategy",
            "depends_on": ["launch_brief"],
            "input_schema": {"required": ["category"]},
            "runtime_request": {"kind": "hermes_request", "expected_output": "link_planning"},
            "artifact_templates": ["link_planning_table", "link_planning_summary"],
            "failure_policy": "record_failure_and_block_dependents",
            "rerun_policy": "allowed",
        },
        {
            "node_id": "human_approval",
            "title": "人审确认",
            "runtime": "human",
            "depends_on": ["launch_brief", "link_planning"],
            "input_schema": {"required": []},
            "runtime_request": {"kind": "human_review_gate"},
            "artifact_templates": ["approval_record"],
            "failure_policy": "request_user_input",
            "rerun_policy": "allowed",
        },
    ]


def _artifact_templates() -> dict[str, dict[str, Any]]:
    ids = [
        "analysis_scope",
        "industry_top300_summary",
        "mainstream_product_structure",
        "keyword_demand_table",
        "keyword_demand_summary",
        "pain_point_table",
        "upgrade_opportunity_summary",
        "price_band_opportunity_table",
        "price_role_recommendation",
        "competitor_breakthrough_table",
        "competitor_analysis_summary",
        "opportunity_scorecard",
        "opportunity_score_summary",
        "new_product_launch_brief",
        "link_planning_table",
        "link_planning_summary",
        "approval_record",
    ]
    return {
        artifact_id: {
            "artifact_id": artifact_id,
            "title": artifact_id.replace("_", " "),
            "content_type": "json" if artifact_id.endswith(("table", "scorecard", "record", "structure")) else "markdown",
            "versioning": "append_only",
            "editable": True,
        }
        for artifact_id in ids
    }


def compile_bundle(*, kb_path: Path, schema_tags_path: Path, output: Path, bundle_id: str) -> dict[str, Any]:
    kb = _load_json(kb_path)
    schema_tags = _load_json(schema_tags_path)
    output = output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)

    scenario = {
        "scenario_id": "new_product_launch",
        "title": "淘宝/天猫新品开发",
        "coverage_status": "explicit",
        "playbook_path": "playbooks/new_product_launch/playbook.json",
        "runtime_targets": ["strategy", "pi_agent", "human"],
    }
    catalog = {
        "schema_version": SCHEMA_VERSION,
        "bundle_id": bundle_id,
        "title": kb.get("collection_title") or kb.get("collection_id") or bundle_id,
        "source_kb": str(kb_path.expanduser().resolve()),
        "source_schema_tags": str(schema_tags_path.expanduser().resolve()),
        "scenarios": [scenario],
    }
    nodes = _new_product_nodes()
    playbook = {
        "schema_version": PLAYBOOK_VERSION,
        "scenario_id": "new_product_launch",
        "title": "淘宝/天猫新品开发",
        "source_collection_id": kb.get("collection_id"),
        "source_schema_version": schema_tags.get("schema_version"),
        "nodes": nodes,
        "gates": [
            {
                "gate_id": "human_approval",
                "gate_type": "human_review_gate",
                "required_before": ["external_tool_execution"],
                "question": "是否确认进入新品执行阶段？",
                "approval_options": ["approve", "reject", "request_changes"],
            }
        ],
    }
    _write_json(output / "scenario_catalog.json", catalog)
    _write_json(output / "playbooks/new_product_launch/playbook.json", playbook)
    _write_json(
        output / "shared_node_library.json",
        {
            "schema_version": "business-strategy-shared-node-library-v1",
            "nodes": {node["node_id"]: node for node in nodes},
        },
    )
    _write_json(
        output / "data_agent_request_templates.json",
        {
            "schema_version": "business-strategy-data-agent-templates-v1",
            "templates": {
                node["node_id"]: node["runtime_request"]
                for node in nodes
                if node["runtime"] == "pi_agent"
            },
        },
    )
    (output / "business_signal_mapping.yaml").write_text(
        "schema_version: business-signal-mapping-v1\n"
        "signals:\n"
        "  demand_strength_signal: [keyword_demand_analysis]\n"
        "  price_band_opportunity: [price_band_opportunity]\n"
        "  competitor_gap_signal: [competitor_analysis]\n"
        "  launch_readiness_signal: [opportunity_score]\n",
        encoding="utf-8",
    )
    _write_json(
        output / "gate_policy.json",
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
    for artifact_id, template in _artifact_templates().items():
        _write_json(output / "artifact_templates" / f"{artifact_id}.json", template)
    return {
        "success": True,
        "bundle_id": bundle_id,
        "output": str(output),
        "scenario_count": 1,
        "node_count": len(nodes),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kb", required=True, type=Path)
    parser.add_argument("--schema-tags", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--bundle-id", required=True)
    args = parser.parse_args()
    result = compile_bundle(
        kb_path=args.kb,
        schema_tags_path=args.schema_tags,
        output=args.output,
        bundle_id=args.bundle_id,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

