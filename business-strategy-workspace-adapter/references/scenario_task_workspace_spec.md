# Scenario Task Workspace Spec

## Purpose

This spec defines the task workspace that turns a compiled business strategy
playbook into a visible, editable, and rerunnable work process.

The workspace is not a chat transcript and not a simple TODO list. It is a
scenario-bound execution surface:

```text
scenario
  -> playbook
  -> task run
  -> node runs
  -> artifacts
  -> gates
  -> audit log

mission
  -> child task runs
  -> artifact handoffs
  -> cross-scenario gates
  -> mission audit log
```

## Product Shape

The default UI is a two-pane workspace:

```text
left:  scenario task list, node status, artifacts, gates
right: agent chat, node explanation, execution trace, rerun controls
```

The left pane owns the business process. The right pane helps the user inspect,
edit, explain, and rerun that process.

## Core Objects

### Scenario

A business situation that a user wants to complete, such as:

- `new_product_launch`
- `competitor_analysis`
- `price_band_layout`
- `visual_creative_planning`

Scenario metadata includes:

```json
{
  "scenario_id": "new_product_launch",
  "title": "淘宝/天猫新品开发",
  "description": "Use when planning a new product from market insight evidence.",
  "source": "market_insight_strategy_kb",
  "coverage_status": "explicit"
}
```

### Playbook

The ordered operating procedure generated from OpenKB, business schema tags,
and scenario-specific strategy evidence.

A playbook defines what should happen. It is stable strategy structure, not a
single user run.

### TaskRun

A concrete user job created from a playbook.

Example:

```json
{
  "task_run_id": "20260621__new_product_launch__liuhai_piece__sha8",
  "scenario_id": "new_product_launch",
  "title": "刘海片新品开发",
  "status": "running",
  "inputs": {
    "category": "刘海片",
    "date_range": "last_30_days"
  },
  "nodes": [],
  "created_at": "2026-06-21T10:00:00.000Z",
  "updated_at": "2026-06-21T10:00:00.000Z"
}
```

### MissionRun

A larger user job created from a mission manifest. It composes multiple
scenario TaskRuns and records orchestration state.

Example:

```json
{
  "mission_run_id": "20260621__new_product_end_to_end__liuhai_piece__sha8",
  "mission_id": "new_product_end_to_end",
  "title": "刘海片新品开发全流程",
  "status": "running",
  "inputs": {
    "category": "刘海片",
    "date_range": "last_30_days"
  },
  "child_task_runs": [
    {
      "scenario_id": "category_market_analysis",
      "task_run_id": "task_run_category_xxx",
      "status": "done"
    },
    {
      "scenario_id": "new_product_launch",
      "task_run_id": "task_run_launch_xxx",
      "status": "ready"
    }
  ],
  "artifact_handoffs": [],
  "created_at": "2026-06-21T10:00:00.000Z",
  "updated_at": "2026-06-21T10:00:00.000Z"
}
```

MissionRun state does not replace child TaskRun state. It only tracks
orchestration, cross-scenario gates, and artifact handoff.

### NodeRun

A task node is a work unit, not just a checklist item. Every node must have
input, execution, output, artifact, and audit shape.

Allowed statuses:

```text
pending
ready
running
needs_input
needs_review
done
failed
skipped
rerun_requested
blocked_by_pi_capability
```

Example:

```json
{
  "node_id": "keyword_demand_analysis",
  "title": "关键词需求分析",
  "status": "done",
  "runtime": "pi_agent",
  "inputs": {
    "category": "刘海片",
    "date_range": "last_30_days"
  },
  "execution": {
    "tool": "analyze_keyword_demand",
    "run_id": "keyword_run_xxx"
  },
  "outputs": {
    "summary": "刘海片存在明确搜索需求...",
    "artifact_ids": ["keyword_demand_table"]
  },
  "updated_at": "2026-06-21T10:05:00.000Z"
}
```

### Artifact

An artifact is a durable intermediate or final work product. It can be edited
and rerun from.

Artifact sources:

```text
agent
user_edit
rerun
imported
approved_snapshot
```

Versioning rules:

- Agent first draft writes `v1`.
- User edit appends `vN+1`.
- Rerun appends `vN+1`.
- Old versions must not be overwritten.
- Each version records source, editor, timestamp, and node id.

Example:

```json
{
  "artifact_id": "keyword_demand_summary",
  "node_id": "keyword_demand_analysis",
  "version": 2,
  "source": "user_edit",
  "content_type": "markdown",
  "content": "人工修正后的关键词需求结论...",
  "created_at": "2026-06-21T10:08:00.000Z"
}
```

### ArtifactHandoff

An artifact handoff passes a versioned artifact from one scenario TaskRun to
another.

Example:

```json
{
  "handoff_id": "handoff_price_band_to_launch",
  "from_task_run_id": "task_run_price_band_xxx",
  "from_artifact_id": "price_band_opportunity_map",
  "from_artifact_version": 3,
  "to_task_run_id": "task_run_launch_xxx",
  "to_input_key": "target_price_band_context",
  "relation_id": "price_band_to_launch",
  "status": "active",
  "created_at": "2026-06-21T10:30:00.000Z"
}
```

Handoffs must reference artifact versions. They must not pass hidden runtime
state, raw chat transcript memory, or unversioned variables.

### Gate

A gate blocks later action until a condition is satisfied.

Gate types:

```text
strategy_gate
data_evidence_gate
pi_decision_gate
human_review_gate
execution_approval_gate
cross_scenario_gate
```

All budget, price, campaign, publish, listing edit, backend mutation, browser
automation, mobile operation, and production API mutation steps require a human
or execution approval gate.

### AuditLog

Audit logs are append-only JSONL records.

Required event types:

```text
task_run_created
node_run_started
node_run_completed
node_run_failed
artifact_created
artifact_edited
node_rerun_requested
node_rerun_completed
gate_requested
gate_approved
gate_rejected
runtime_request_sent
runtime_response_received
```

Every event must include:

```json
{
  "event": "node_run_completed",
  "task_run_id": "...",
  "node_id": "keyword_demand_analysis",
  "timestamp": "2026-06-21T10:05:00.000Z",
  "actor": "system",
  "details": {}
}
```

## Storage Contract

Default local storage:

```text
registry/derived/scenario_workspace/
  mission_runs/<mission_run_id>/
    mission_run.json
    artifact_handoffs.json
    audit_log.jsonl
  task_runs/<task_run_id>/
    task_run.json
    node_runs/<node_id>.json
    artifacts/<artifact_id>/v1.json
    artifacts/<artifact_id>/v2.json
    audit_log.jsonl
```

The workspace writes only derived artifacts. Source strategy documents,
OpenKB outputs, business schema definitions, and PI registries remain separate
sources of truth.

## UX Rules

- The user starts from a scenario, not from a tool.
- The user may start from a mission when the job spans several scenarios.
- The task list comes from a playbook, not from ad hoc chat.
- A mission timeline comes from `mission.json`, not from ad hoc chat.
- A node cannot be marked done without an output or an explicit skipped reason.
- A failed data/tool node should not crash the entire task run.
- The user can edit any artifact version and rerun the node from that version.
- The UI should show business state first and technical trace second.
- Chat can explain or modify a node, but chat is not the state store.
- Cross-scenario context must flow through versioned artifacts.
