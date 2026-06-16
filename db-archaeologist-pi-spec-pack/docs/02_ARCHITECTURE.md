# Architecture — DB Archaeologist Agent

## 1. 逻辑架构

```text
┌─────────────────────────────────────────────────────────────┐
│                    Pi Agent Runtime                         │
│  custom tools / extensions / skills / state / tool calling   │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│              DB Archaeologist Agent Service                  │
│  API QA | Tool Selector | Asset Card Reader | KG Explain      │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                  Asset Intelligence Layer                    │
│ ApiAsset Registry | Domain Mapping | Tool Registry | KG       │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                    Extraction Pipeline                       │
│ Markdown Extractor | Contract Probe | Quality Auditor         │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                       Source Assets                          │
│ API Markdown | OpenAPI | Apifox Export | Logs | SQL | DDL     │
└─────────────────────────────────────────────────────────────┘
```

## 2. 调用链路

### API 问答

```text
User Question
  -> Pi Agent
  -> ask_api_catalog tool
  -> Query Rewrite
  -> Registry Search
  -> KG Expand
  -> Quality-aware Rerank
  -> Answer with API/Tool candidates
```

### Agent 自动选工具

```text
Business Task
  -> Pi Agent
  -> select_tools_for_task tool
  -> Intent Parse
  -> Required Capability Plan
  -> Tool Registry Match
  -> Param Gap Check
  -> Risk Check
  -> Tool Chain Plan
```

## 3. 核心设计原则

- Source docs are evidence, not truth.
- API is not Tool; Tool is business-safe API wrapper.
- Domain Mapping must be explicit and versioned.
- Quality score controls runtime exposure.
- Knowledge Graph explains why a tool is selected.
- Pi is runtime harness; registry is the decision substrate.
