# Strategy KB Collection Spec

## Purpose

This document defines the `collection.yaml` contract for compiling a business
document set into a knowledge base before applying the business strategy schema.

The collection manifest describes stable human-owned structure: which documents
belong to the collection, which document is the parent strategy, and which
parent-document anchors reference local child documents. It does not describe
OpenKB chunks, generated wiki pages, extracted evidence, or final schema field
values. Those are compile-time outputs.

## Granularity

`collection.yaml` should stop at document and anchor granularity.

Declare:

- Collection identity, domain, schema version, and default output slug.
- One parent strategy document.
- Each local child document with an explicit role and topic list.
- Parent-to-child relations discovered from the parent document.
- The parent anchor text and original external URL for each relation.
- Optional schema hints that help later retrieval prioritize likely fields.

Do not declare:

- Every Markdown section in each document.
- OpenKB chunks, pages, embeddings, or retrieval indexes.
- Evidence quotes or generated citations.
- Final values for `schema_tags.json` fields.
- Missing-field decisions.

OpenKB owns page, chunk, link, and citation generation. The business schema
compiler owns field extraction, evidence selection, and missing-field judgment.

## Recommended Location

In the scenario-directory input model, place each collection manifest inside
the scenario directory it describes:

```text
strategy-scenarios/<scenario_id>/collection.yaml
strategy-scenarios/<scenario_id>/docs/
```

Older single-collection projects may still place a collection manifest next to
the document set it describes:

```text
docs/biz_spec/marketing_insight/collection.yaml
```

In scenario-directory mode, the manifest `root` is resolved relative to the
scenario directory. In older single-collection mode, `root` is resolved relative
to the repository root unless a CLI explicitly provides a different base
directory. Individual document `path` values are always resolved relative to
`root`.

## Required Shape

```yaml
schema_version: strategy-kb-collection-v1
id: marketing-insight-meta-strategy
title: 市场分析洞察元策略
domain: ecommerce-market-insight
entrypoint: main
root: docs/biz_spec/marketing_insight
default_slug: marketing-insight-kb-v1
schema_path: docs/biz_spec/元策略规范.md

documents:
  - id: main
    path: 20260519市场分析洞察元策略.md
    title: 20260519市场分析洞察元策略
    role: parent_strategy
    topics: [market-insight, product-selection, ecommerce]

relations:
  - from: main
    to: seven-conclusions-flow
    type: procedure_detail
    anchor: 流程2.5 分析结论模板
    external_url: https://alidocs.dingtalk.com/i/nodes/7dx2rn0JbY0apqaXt2Ll61aBVMGjLRb3
    supports_fields: [执行步骤, 判断标准, 决策顺序, 建议动作]
```

## Collection Fields

Required top-level fields:

| Field | Meaning |
| --- | --- |
| `schema_version` | Must be `strategy-kb-collection-v1` for this contract. |
| `id` | Stable machine-readable collection id. Use lowercase kebab case. |
| `title` | Human-readable collection title. |
| `domain` | Business domain or analysis domain. |
| `entrypoint` | Document id of the parent strategy document. |
| `root` | Directory containing the local collection documents. |
| `documents` | List of local source documents. |
| `relations` | List of explicit document relations. |

Recommended top-level fields:

| Field | Meaning |
| --- | --- |
| `default_slug` | Default generated skill slug for this collection. |
| `schema_path` | Business schema source, normally `docs/biz_spec/元策略规范.md`. |
| `description` | Short summary of what the collection covers. |
| `owners` | Optional human owners or teams. |
| `tags` | Collection-level retrieval and discovery tags. |

## Document Fields

Required fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable local document id. Use lowercase kebab case. |
| `path` | Local path relative to `root`. |
| `title` | Human-readable title. |
| `role` | Document role in the collection. |
| `topics` | Retrieval hints for OpenKB and later schema compilation. |

Recommended roles:

| Role | Use |
| --- | --- |
| `parent_strategy` | Main strategy document and collection entrypoint. |
| `procedure_detail` | Detailed process or conclusion flow. |
| `judgement_standard` | Judgment thresholds, standards, and rules. |
| `prompt_template` | Prompt or classification template. |
| `method_detail` | Methodology expansion that supports a parent flow. |

## Relation Fields

Required fields:

| Field | Meaning |
| --- | --- |
| `from` | Source document id, usually the parent strategy. |
| `to` | Target child document id. |
| `type` | Relation type. |
| `anchor` | Parent-document text where the relation appears. |

Recommended fields:

| Field | Meaning |
| --- | --- |
| `external_url` | Original remote URL from the parent document. |
| `supports_fields` | Business schema fields likely supported by the target. |
| `notes` | Human-readable mapping note. |

Recommended relation types:

| Type | Meaning |
| --- | --- |
| `procedure_detail` | Child explains how to execute a parent flow. |
| `judgement_standard` | Child provides thresholds and standards. |
| `prompt_template` | Child provides prompts or classification instructions. |
| `method_detail` | Child expands a methodology or model. |

## Mapping External Links to Local Files

When the parent document links to a remote DingTalk document, map the remote
link to the local downloaded Markdown file through a relation.

Example parent fragment:

```markdown
### 2.5 分析结论模板[《7个结论的判断详细流程》](https://alidocs.dingtalk.com/i/nodes/...)
```

Corresponding relation:

```yaml
- from: main
  to: seven-conclusions-flow
  type: procedure_detail
  anchor: 流程2.5 分析结论模板
  external_url: https://alidocs.dingtalk.com/i/nodes/...
```

The `anchor` should be stable enough for humans and tools to find the parent
section. It does not need to reproduce the entire Markdown heading.

## Schema Hints

`supports_fields` is a retrieval hint, not a field extraction result. It tells
the compiler where to search first. A field listed in `supports_fields` is still
missing unless OpenKB retrieval returns explicit evidence.

Use normalized field names from `docs/biz_spec/元策略规范.md`, such as:

- `执行步骤`
- `判断依据/指标`
- `判断标准`
- `问题解决方法/执行动作`
- `方法是否有效的验证方式`
- `核心变量`
- `判断指标`
- `决策顺序`
- `建议动作`
- `验证方式`

## Validation Rules

A valid collection manifest must satisfy:

- `entrypoint` matches exactly one document id.
- Every relation `from` and `to` references an existing document id.
- Every document path resolves to an existing local file.
- Every remote URL from the parent document that has a local downloaded child
  should have a relation.
- The manifest must not contain generated chunks, evidence quotes, or final
  schema field values.
