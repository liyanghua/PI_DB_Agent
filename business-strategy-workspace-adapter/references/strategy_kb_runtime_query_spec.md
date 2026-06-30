# Strategy KB Runtime Query Spec

## Purpose

This document defines the runtime query layer for OpenKB-backed business
strategy skills.

The current Strategy KB flow compiles an OpenKB document collection into a
self-contained skill. That is reliable for schema-backed answers, but it does
not cover every long-tail question a user may ask about the source collection.

The runtime query layer adds a conservative fallback:

```text
loaded strategy skill
  -> answer from schema_tags.json first
  -> if coverage is insufficient, query copied KB artifacts / OpenKB wiki pages
  -> return passages + citations
  -> synthesize an answer grounded in those passages
```

This remains explicit-trigger and skill-scoped. It must not change the Hermes
main conversation loop, memory system, or context engine.

## Design Goals

- Cover long-tail questions that are not represented in `schema_tags.json`.
- Preserve the deterministic schema answer path for core business fields.
- Keep generated strategy skills portable and useful without a live OpenKB
  process.
- Make citations visible enough for business users to trust the answer.
- Avoid making ordinary Hermes chat slower or dependent on OpenKB.

## Non-Goals

- Do not make OpenKB an always-on chat backend.
- Do not automatically query every loaded knowledge base on every turn.
- Do not write runtime query results back into `schema_tags.json`.
- Do not use runtime query to fill missing schema fields silently.
- Do not bypass business schema evidence rules during strategy compilation.

## Runtime Answer Policy

Generated OpenKB-backed strategy skills should answer in this order:

1. **Schema Tags**
   - Read `references/schema_tags.json`.
   - Prefer `perspectives.<name>.tags`.
   - Use this path for normalized business fields, missing-field questions,
     execution conditions, metrics, and known strategy decisions.

2. **Source Digest**
   - Read `references/source_digest.md` when the user asks for narrative flow,
     implementation summary, or a compact explanation of the strategy.

3. **Runtime KB Search**
   - Use only when `schema_tags.json` and `source_digest.md` do not contain
     enough evidence for the user question.
   - Search copied KB artifacts and OpenKB wiki/source pages associated with
     the loaded skill.
   - Return grounded passages with document/page/citation metadata.

4. **Explicit Unknown**
   - If runtime search also lacks evidence, say the collection does not provide
     enough support.
   - Do not answer from general ecommerce knowledge as if it came from the KB.

## When Runtime Search Should Trigger

Runtime KB search is appropriate when the user asks:

- A detailed question about a child document.
- A cross-document comparison not already represented in schema tags.
- A phrase, process, metric, or judgement standard that may exist in OpenKB wiki
  pages but not in schema fields.
- "Where does this come from?" or "which document says this?" and the compiled
  tag provenance is not enough.
- A follow-up that references a previous answer's citation or source document.

Runtime KB search should not trigger when:

- The answer is already available in `schema_tags.json`.
- The user asks about a missing schema field with no evidence.
- The user is in an ordinary chat without loading or invoking the strategy
  skill.
- The user asks for data/API execution; those should route to the future
  Strategy/Data Fusion and PI/Data Agent layer, not OpenKB text search.

## Tool Contract

The first implementation should add a portable local tool or script exposed to
compatible Agent runtimes.

Suggested tool name:

```text
strategy_kb_search
```

Suggested CLI shape:

```bash
python <business-strategy-skill-pack>/scripts/strategy_kb_query.py search \
  --skill-dir ~/.hermes/skills/biz-strategy/marketing-insight-kb-real \
  --query "价格带判断和竞品判断如何共同影响机会判断？" \
  --top-k 8
```

Optional direct KB mode:

```bash
python <business-strategy-skill-pack>/scripts/strategy_kb_query.py search \
  --kb .strategy-kb/marketing-insight/kb-openkb-real/kb_manifest.json \
  --query "流程2.5 的判断标准来自哪里？" \
  --top-k 8
```

### Input

| Field | Required | Meaning |
| --- | --- | --- |
| `skill_dir` | one of `skill_dir` or `kb` | Generated strategy skill directory. |
| `kb` | one of `skill_dir` or `kb` | `kb_manifest.json` path. |
| `query` | yes | User question or retrieval query. |
| `top_k` | no | Max passages to return. Default `8`. |
| `filters.doc_id` | no | Restrict to one or more collection document ids. |
| `filters.role` | no | Restrict by document role such as `parent_strategy`. |
| `filters.fields` | no | Optional schema-field hints. |

### Output

The tool must return JSON, not prose:

```json
{
  "success": true,
  "query": "流程2.5 的判断标准来自哪里？",
  "backend": "openkb",
  "mode": "local-artifact-search",
  "results": [
    {
      "rank": 1,
      "score": 0.84,
      "doc_id": "seven-conclusions-flow",
      "doc_title": "7个结论的判断详细流程",
      "source_path": "docs/biz_spec/marketing_insight/7个结论的判断详细流程.md",
      "kb_page_id": "openkb-page-seven-conclusions-flow",
      "citation_id": "cite-seven-conclusions-flow-001",
      "section": "分析结论模板",
      "passage": "......",
      "matched_terms": ["流程2.5", "判断标准"]
    }
  ],
  "warnings": []
}
```

The tool must not return a final user-facing answer. The Agent synthesizes the
answer after inspecting returned passages.

## Retrieval Modes

### `local-artifact-search` (Default)

Search the files copied into the generated skill:

```text
references/schema_tags.json
references/source_digest.md
references/kb_manifest.json
references/source_map.json
references/citations.json
```

If `kb_manifest.json` includes `pages[*].full_text`, search those pages too.
This mode keeps the skill portable and does not require OpenKB to be installed.

### `openkb-workspace-search` (Optional)

If the original `openkb_workspace` still exists and the runtime is allowed to
read it, search:

```text
openkb_workspace/wiki/summaries/*.md
openkb_workspace/wiki/concepts/*.md
openkb_workspace/wiki/entities/*.md
openkb_workspace/wiki/sources/*.md
```

This mode can expose richer OpenKB wiki pages. It is optional because generated
skills should still work after being moved to another Agent runtime.

### `openkb-cli-query` (Future)

If upstream OpenKB exposes a stable query API/CLI, an adapter can call it. This
mode must stay behind the same `strategy_kb_search` contract so generated
skills do not depend on OpenKB internals.

## Retrieval Method

The first implementation should be deterministic and dependency-light:

- Normalize Chinese and English punctuation.
- Tokenize by:
  - exact Chinese phrase windows,
  - markdown headings,
  - schema field names,
  - document titles,
  - relation anchors,
  - ASCII tokens.
- Score candidates with:
  - query term overlap,
  - title/heading match,
  - relation anchor match,
  - schema hint match,
  - citation/source document role boost.
- Return compact passages around matched sections.

Embeddings can be added later, but they should be optional. The runtime query
layer should not require a remote embedding provider for baseline operation.

## Generated Skill Instructions

OpenKB-backed generated `SKILL.md` files should include:

```text
When answering:
1. Use references/schema_tags.json first.
2. If the question is not covered by schema tags or source_digest.md, call
   strategy_kb_search scoped to this skill directory.
3. Answer only from returned passages and cite doc_id / source title /
   citation_id.
4. If search returns no relevant passages, say the KB does not contain enough
   evidence.
```

The skill should not instruct the Agent to call OpenKB directly. It should call
the stable `strategy_kb_search` interface.

## UX Rules

- Runtime search may be automatic only inside a loaded/generated Strategy KB
  skill.
- Activity should be visible in GUI/TUI:
  - `Searching Strategy KB...`
  - `Found 5 passages from 3 documents`
  - `No supporting KB passage found`
- Search should have a short timeout for local artifact mode.
- Slow OpenKB CLI/query modes must show activity and be cancelable when the
  host runtime supports cancellation.
- Answers should disclose when they used runtime KB search rather than only
  schema tags.

## Safety and Correctness Rules

- Never promote runtime search results into schema fields without a compile
  step.
- Never treat OpenKB-generated concept pages as stronger evidence than source
  documents. Prefer source pages and citations when available.
- If source document and generated wiki page conflict, cite both and mark the
  conflict.
- Do not expose API keys, model config, or OpenKB logs in user-facing answers.
- Keep passages short enough to avoid flooding the context window.

## Acceptance Questions

Runtime search passes when a generated skill can answer questions like:

- `这篇集合里有没有讲“跨类目迁移”？在哪些文档里？`
- `流程2.5 分析结论模板有哪些判断步骤？`
- `价格带判断和竞品判断有哪些共同变量？`
- `机会可落地性判断里，有哪些资源或执行条件？`
- `父文档没直接写，但子文档里补充了哪些判断标准？`

For each answer, the Agent should cite at least:

- `doc_id`
- source document title or path
- `citation_id` or KB page id
- a short evidence quote or passage

## Implementation Plan Pointer

Implementation should add:

- `local-skills/business-strategy-skill-pack/scripts/strategy_kb_query.py`
- tests for local artifact retrieval, doc filters, empty results, and generated
  skill instructions
- generated SKILL.md updates for OpenKB-backed skills
- optional Hermes plugin/tool wrapper only after the portable script contract is
  stable
