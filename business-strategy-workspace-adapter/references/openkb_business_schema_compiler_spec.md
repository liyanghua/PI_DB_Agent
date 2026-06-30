# OpenKB Business Schema Compiler Spec

## Purpose

This document defines the fusion architecture for compiling a business document
collection into a knowledge base first, then compiling that knowledge base into
a business strategy skill.

For the implementation-facing file, CLI, and test plan, see
`docs/biz_spec/strategy_kb_generation_technical_plan.md`.

For runtime query behavior after a strategy skill has been generated, see
`docs/biz_spec/strategy_kb_runtime_query_spec.md`.

The goal is to combine two strengths:

- OpenKB turns a document set into a queryable wiki/knowledge base with links
  and citations.
- The business schema compiler turns knowledge into a stable, evidence-backed
  strategy skill using `docs/biz_spec/元策略规范.md`.

## End-to-End Flow

```text
collection.yaml
  -> OpenKB Adapter
  -> kb_manifest.json + source_map.json + citations.json
  -> Strategy KB Compiler
  -> schema_tags.json + source_digest.md
  -> biz-strategy/<slug>/SKILL.md
  -> optional runtime query through strategy_kb_search
```

This flow is explicit-trigger only. It must not modify the Hermes conversation
loop or automatically compile documents during ordinary chat.

## Component Responsibilities

### `collection.yaml`

The collection manifest records human-owned structure:

- Parent strategy document.
- Local child documents.
- Parent anchors that reference child documents.
- Original external URLs.
- Optional schema-field retrieval hints.

It does not store OpenKB chunks, embeddings, generated pages, evidence quotes,
or final schema values.

### OpenKB

Default local checkout location:

```text
./third_party/OpenKB
```

OpenKB is treated as an external knowledge-base runtime, not as a Hermes local
skill. It should not be placed under `local-skills/`, because `local-skills/`
contains Agent-readable skill packs while OpenKB is a build-time KB engine.

OpenKB responsibilities:

- Import every document listed in `collection.yaml`.
- Preserve document identity from the manifest.
- Build wiki/KB pages, chunks, links, and citations.
- Support query or export operations that return source-grounded passages.

### OpenKB Adapter

The adapter isolates the rest of the pipeline from OpenKB CLI/API changes.

Minimum adapter contract:

```text
build(collection.yaml, output_dir) -> kb_manifest.json
query(kb_manifest.json, question, filters) -> passages + citations
export(kb_manifest.json) -> source_map.json + citations.json
```

If OpenKB's upstream CLI shape changes, only this adapter should change. The
business schema compiler should continue reading the adapter's normalized
outputs.

Runtime query should also go through the adapter contract or a stable portable
tool such as `strategy_kb_search`. Generated skills must not call OpenKB
internals directly.

### Strategy KB Compiler

The compiler uses the KB as its retrieval substrate.

Responsibilities:

- Read `kb_manifest.json`.
- Read the authoritative schema from `docs/biz_spec/元策略规范.md`.
- For each schema field, query OpenKB for candidate evidence.
- Extract tags across both required perspectives:
  - `客户业务专家视角`
  - `经营增长目标维度`
- Preserve source document ids, paths, KB page ids, and citation ids.
- Mark unsupported fields as missing rather than filling from general business
  knowledge.

### Generated Strategy Skill

Generated output remains compatible with the existing strategy skill shape:

```text
biz-strategy/<slug>/
  SKILL.md
  references/
    schema_tags.json
    source_digest.md
    kb_manifest.json
    source_map.json
    citations.json
```

The generated skill should answer from `schema_tags.json.perspectives` first.
When a user asks for deeper provenance, it can use `kb_manifest.json`,
`source_map.json`, and `citations.json` to trace evidence back to child
documents.

When `schema_tags.json` and `source_digest.md` do not cover a long-tail user
question, the generated skill may call the runtime query interface defined in
`strategy_kb_runtime_query_spec.md`. Runtime search is a fallback for answering
questions, not a way to silently mutate schema tags or missing fields.

## Public CLI Shape

The future CLI should expose a two-step flow so agents can inspect either stage:

```bash
strategy-kb build-kb \
  --collection docs/biz_spec/marketing_insight/collection.yaml \
  --openkb-root ./third_party/OpenKB \
  --output .strategy-kb/marketing-insight/kb
```

```bash
strategy-kb compile-skill \
  --kb .strategy-kb/marketing-insight/kb/kb_manifest.json \
  --schema docs/biz_spec/元策略规范.md \
  --output-root generated-skills \
  --slug marketing-insight-kb-v1
```

Hermes can be targeted explicitly:

```bash
strategy-kb compile-skill \
  --kb .strategy-kb/marketing-insight/kb/kb_manifest.json \
  --schema docs/biz_spec/元策略规范.md \
  --output-root ~/.hermes/skills \
  --slug marketing-insight-kb-v1
```

Runtime query should be exposed separately:

```bash
strategy-kb query \
  --skill-dir ~/.hermes/skills/biz-strategy/marketing-insight-kb-v1 \
  --query "流程2.5 的判断标准来自哪里？"
```

The query command should return passages and citations as JSON. It should not
return a final answer; the Agent synthesizes the answer from returned evidence.

## Failure and Fallback Rules

OpenKB failures must be visible in generated metadata. A run that cannot build
or query the KB must not be reported as a successful `openkb+business-schema`
compile.

Recommended behavior:

- If OpenKB is missing, stop with an actionable error that points to
  `./third_party/OpenKB`.
- If a child document is missing, fail collection validation before invoking
  OpenKB.
- If OpenKB builds but query/export fails, record the failing stage and do not
  silently fall back to direct Markdown extraction.
- Direct `book-to-skill` extraction can remain a separate legacy path, but it
  should not be counted as OpenKB evidence.

## Relationship to Existing V2 Builder

Existing V2:

```text
source markdown -> book-to-skill extraction -> schema compiler -> strategy skill
```

Fusion path:

```text
collection.yaml -> OpenKB KB -> schema compiler -> strategy skill
```

The fusion path does not remove V2. V2 remains useful for single-document or
portable extraction cases. The OpenKB path is preferred when the source is a
document collection with parent-child references and cross-document evidence.

## Non-Goals

- Do not implement a generic multi-KB provider abstraction in the first version.
- Do not change Hermes memory, context, or conversation loop.
- Do not make OpenKB an always-on chat dependency.
- Do not infer schema fields without source-backed KB evidence.
- Do not use runtime query results to rewrite generated schema tags outside an
  explicit compile/update command.
