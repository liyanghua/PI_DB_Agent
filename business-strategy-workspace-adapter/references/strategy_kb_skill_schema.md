# Strategy KB Skill Schema

## Purpose

This document extends the existing V2 `schema_tags.json` contract for strategy
skills generated from an OpenKB-backed document collection.

The core business schema remains the two-perspective V2 schema from
`docs/biz_spec/strategy_skill_schema_v2.md`. The Strategy KB extension adds
knowledge-base provenance so every extracted field can be traced to a document,
KB page, and citation.

## Required Shape

Fusion-generated skills should keep `schema_version: biz-strategy-meta-v2` for
reader compatibility and add `knowledge_base.contract_version:
strategy-kb-provenance-v1`.

```json
{
  "document_id": "marketing-insight-kb-v1",
  "source_paths": ["docs/biz_spec/marketing_insight/20260519市场分析洞察元策略.md"],
  "schema_path": "docs/biz_spec/元策略规范.md",
  "schema_version": "biz-strategy-meta-v2",
  "extraction": {
    "engine": "openkb+business-schema",
    "fallback": false,
    "fallback_reason": ""
  },
  "knowledge_base": {
    "contract_version": "strategy-kb-provenance-v1",
    "backend": "openkb",
    "collection_manifest": "docs/biz_spec/marketing_insight/collection.yaml",
    "kb_manifest": "references/kb_manifest.json",
    "source_map": "references/source_map.json",
    "citations": "references/citations.json",
    "runtime_query": {
      "enabled": true,
      "tool": "strategy_kb_search",
      "default_mode": "local-artifact-search",
      "search_paths": [
        "references/schema_tags.json",
        "references/source_digest.md",
        "references/kb_manifest.json",
        "references/source_map.json",
        "references/citations.json"
      ]
    }
  },
  "perspectives": {
    "客户业务专家视角": {
      "tags": [],
      "missing_fields": [],
      "open_questions": []
    },
    "经营增长目标维度": {
      "tags": [],
      "missing_fields": [],
      "open_questions": []
    }
  },
  "tags": [],
  "missing_fields": [],
  "evidence": [],
  "open_questions": [],
  "qa_index": {}
}
```

## Knowledge Base Node

`knowledge_base` is required for OpenKB-backed runs.

| Field | Meaning |
| --- | --- |
| `contract_version` | Must be `strategy-kb-provenance-v1`. |
| `backend` | Knowledge backend, initially `openkb`. |
| `collection_manifest` | Source `collection.yaml`. |
| `kb_manifest` | Generated KB manifest copied into skill references. |
| `source_map` | Generated source id/path/page mapping. |
| `citations` | Generated citation registry. |
| `runtime_query` | Optional query capability metadata for long-tail Q&A. |

The paths should be relative to the generated skill directory when copied into a
self-contained strategy skill.

## Runtime Query Node

`runtime_query` is optional in `strategy-kb-provenance-v1` for backward
compatibility, but new OpenKB-backed generated skills should include it.

| Field | Meaning |
| --- | --- |
| `enabled` | Whether the skill may use runtime KB search after schema lookup. |
| `tool` | Stable query interface, initially `strategy_kb_search`. |
| `default_mode` | Retrieval mode, initially `local-artifact-search`. |
| `search_paths` | Reference files that can be searched without a live OpenKB process. |

Runtime query is a Q&A fallback only. It must not mutate `schema_tags.json`,
remove missing fields, or create new normalized tags during ordinary chat.

## KB-Aware Tag Object

Each tag keeps the existing V2 fields and adds KB provenance fields:

```json
{
  "scheme": "经营增长目标维度",
  "field": "判断标准",
  "value": "价格带机会需要同时看商品数量、销量/支付买家数、GMV、竞争强度、毛利空间。",
  "evidence_quote": "价格带分析不是看“卖多少钱”，而是看：哪个价格带有流量？哪个价格带竞争强？哪个价格带利润好？",
  "confidence": 0.78,
  "source_doc_id": "price-band-standard",
  "source_path": "docs/biz_spec/marketing_insight/价格带市场结构判断标准.md",
  "kb_page_id": "openkb-page-price-band-standard",
  "citation_id": "cite-price-band-standard-001"
}
```

Required provenance fields for OpenKB-backed tags:

| Field | Meaning |
| --- | --- |
| `source_doc_id` | Document id from `collection.yaml`. |
| `source_path` | Local source path. |
| `kb_page_id` | OpenKB page or normalized adapter page id. |
| `citation_id` | Citation id from `citations.json`. |

If a tag is produced from multiple supporting documents, the compiler may add
`supporting_citations`, but the primary `citation_id` must still identify the
main evidence.

## Missing Fields

Missing-field behavior remains conservative.

A schema field is present only when OpenKB retrieval returns source evidence
that supports the extracted value. A field should remain missing when:

- The KB has no relevant passage.
- The passage discusses the topic but not the normalized field.
- Evidence exists only in general business knowledge outside the collection.
- The relation hint suggests a likely document, but the document does not
  provide explicit support.

## Generated Reference Files

OpenKB-backed generated skills should include:

```text
references/
  schema_tags.json
  source_digest.md
  kb_manifest.json
  source_map.json
  citations.json
```

`source_digest.md` should be a readable projection of the same data:

- Collection summary.
- Parent-child document map.
- Per-perspective tags and evidence.
- Per-perspective missing fields.
- Notes about OpenKB build/query status.

`source_digest.md` must not introduce fields that are absent from
`schema_tags.json`.

Runtime query may return additional source passages for user questions, but
those passages are not part of the compiled schema contract unless a future
compile/update command writes a new `schema_tags.json`.

## Compatibility

Older readers can continue using top-level `tags`, `missing_fields`,
`evidence`, `open_questions`, and `qa_index`. New readers should prefer:

```text
perspectives.<name>.tags[*].source_doc_id
perspectives.<name>.tags[*].citation_id
knowledge_base
```

The existing single-document V2 path may omit `knowledge_base`. OpenKB-backed
runs must include it.

Older OpenKB-backed skills may omit `knowledge_base.runtime_query`. Readers
should then assume schema-only behavior and avoid attempting dynamic search
unless the host Agent has an explicit query tool configured for that skill.
