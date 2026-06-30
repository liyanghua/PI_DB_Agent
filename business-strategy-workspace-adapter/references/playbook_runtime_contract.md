# Playbook Runtime Contract

## Purpose

This contract defines how a scenario playbook node declares its runtime,
inputs, outputs, gates, failure behavior, and audit requirements.

It is designed for a workspace where Hermes Runtime and PI-Agent Runtime are
parallel execution layers behind a shared UI orchestrator.

## Runtime Types

```text
strategy
pi_agent
human
external_tool
```

### `strategy`

Use for strategy explanation, OpenKB-backed retrieval, business schema
interpretation, and cross-node synthesis.

The runtime request may be handled by Hermes, a generated strategy skill, or a
portable strategy KB query script.

### `pi_agent`

Use for data tool selection, data analysis, KOIF Router, analysis packs, and PI
Decision Layer proposals.

PI-Agent can return objective evidence, score vectors, neutral next actions,
and decision proposals. Decision proposals are not automatic execution
authority.

### `human`

Use when a node requires user or operator confirmation.

Human nodes usually represent a review gate, missing parameter request, or final
approval.

### `external_tool`

Use for browser, mobile, computer, or API execution tools.

Default behavior is preview-only unless an approval gate has passed.

## Node Schema

```json
{
  "node_id": "keyword_demand_analysis",
  "title": "关键词需求分析",
  "description": "Identify demand strength and demand clusters.",
  "runtime": "pi_agent",
  "depends_on": ["define_scope"],
  "input_schema": {
    "required": ["category", "date_range"],
    "properties": {
      "category": { "type": "string" },
      "date_range": { "type": "string" }
    }
  },
  "runtime_request": {
    "kind": "pi_agent_request",
    "capability": "keyword_demand",
    "tool": "analyze_keyword_demand",
    "params_from": ["task.inputs.category", "task.inputs.date_range"]
  },
  "output_schema": {
    "artifacts": ["keyword_demand_summary", "keyword_demand_table"],
    "required_fields": ["summary", "evidence", "run_id"]
  },
  "artifact_templates": [
    {
      "artifact_id": "keyword_demand_summary",
      "content_type": "markdown"
    }
  ],
  "gates": [],
  "failure_policy": "record_failure_and_continue",
  "rerun_policy": "allowed"
}
```

## Runtime Request Kinds

### Hermes Request

```json
{
  "kind": "hermes_request",
  "skill": "biz-strategy/marketing-insight-kb-real",
  "query": "根据新品开发 playbook，解释为什么需要先明确分析边界。",
  "expected_output": "strategy_explanation"
}
```

Use this for strategy and narrative reasoning. The response must cite strategy
source evidence when available.

### PI-Agent Request

```json
{
  "kind": "pi_agent_request",
  "capability": "koif_router",
  "tool": "propose_koif_strategy",
  "params": {
    "entity": "刘海片",
    "entity_kind": "category",
    "capabilities": ["keyword_demand", "keyword_trend", "keyword_competition"],
    "live": false
  }
}
```

PI-Agent responses should include run ids and lineage when possible.

### Decision Proposal Request

```json
{
  "kind": "pi_agent_request",
  "capability": "koif_decision_layer",
  "tool": "propose_koif_decision",
  "params": {
    "router_run_id": "router_v1__...",
    "decision_kind": "sku_supply_plan",
    "risk_tolerance": "medium"
  }
}
```

If the decision layer is a stub or lacks required score dimensions, the node
status should become `blocked_by_pi_capability`, not `failed`.

### Tool Execution Request

```json
{
  "kind": "tool_execution_request",
  "tool_family": "browser",
  "mode": "preview",
  "action": "open_product_backend",
  "approval_required": true
}
```

Execution requests must not mutate external state without explicit approval.

## Gate Rules

Gate schema:

```json
{
  "gate_id": "launch_brief_approval",
  "gate_type": "human_review_gate",
  "required_before": ["link_planning"],
  "question": "是否确认进入新品链接规划？",
  "approval_options": ["approve", "reject", "request_changes"]
}
```

The orchestrator must not run nodes listed in `required_before` until the gate
is approved.

## Failure Policies

Allowed policies:

```text
record_failure_and_continue
record_failure_and_block_dependents
mark_blocked_by_capability
request_user_input
skip_with_reason
```

For v1, node execution is manual. A failed node does not automatically trigger
all downstream reruns.

## Rerun Rules

A rerun must include:

- `reason`
- `requested_by`
- optional `from_artifact_id`
- optional input overrides

The rerun creates new artifact versions and a `node_rerun_completed` audit
event. It must not overwrite old outputs.

## Security And Responsibility

- Strategy runtime explains and synthesizes.
- PI-Agent runtime selects tools, analyzes data, and proposes data-side
  decisions.
- External tool runtime previews and executes only after approval.
- UI orchestrator records state and dispatches work.
- Human reviewers approve state-changing business actions.

