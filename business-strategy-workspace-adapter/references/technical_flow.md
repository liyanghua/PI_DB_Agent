# Portable Business Strategy Skill Flow

## Purpose

This reference describes how the portable pack compiles a business strategy
document into a self-contained strategy skill.

```text
strategy document
  -> scripts/extract_document.py
  -> full_text.txt + metadata.json
  -> bundled schema tagging
  -> biz-strategy/<slug>/SKILL.md
  -> references/schema_tags.json + source_digest.md
```

## Runtime Contract

The pack must work from any Agent runtime that can read a skill folder and run
Python scripts. It does not require a fixed repository layout or a Hermes home
directory.

Default paths:

- Extractor: `scripts/extract_document.py`
- Schema: `references/meta_strategy_schema.md`
- Output root: `./generated-skills`

All relative paths are resolved from the caller's current working directory.

## CLI

```bash
python <business-strategy-skill-pack>/scripts/build_strategy_skill.py \
  --source docs/path/to/strategy.md \
  --output-root ./generated-skills \
  --slug my-strategy-v2
```

Hermes remains a supported output target when chosen explicitly:

```bash
python <business-strategy-skill-pack>/scripts/build_strategy_skill.py \
  --source docs/path/to/strategy.md \
  --output-root ~/.hermes/skills \
  --slug my-strategy-v2
```

## Extraction

The portable extractor writes:

```text
<workdir>/full_text.txt
<workdir>/metadata.json
```

`schema_tags.json.extraction.engine` remains `book-to-skill` for compatibility
with existing V2 acceptance, while metadata records `portable: true` and
`extraction_method: portable-text`.

## Schema Tagging

The builder extracts fields in this order:

1. Direct `字段：值` lines.
2. Matching heading sections.
3. Evidence-backed semantic mapping.
4. Missing-field recording.

Required perspectives:

- `客户业务专家视角`
- `经营增长目标维度`

Absent fields must remain missing. Do not infer `页面截图` without page or image
evidence. Do not infer `迭代日期` from filenames.

## Generated Skill Contract

Each generated skill contains:

```text
biz-strategy/<slug>/
  SKILL.md
  references/
    schema_tags.json
    source_digest.md
```

`schema_tags.json` must include:

- `schema_version: biz-strategy-meta-v2`
- `extraction.engine: book-to-skill`
- `extraction.fallback`
- `perspectives.客户业务专家视角`
- `perspectives.经营增长目标维度`

Full V2 acceptance requires `extraction.fallback: false`.

## Collection KB Path

The single-document flow above remains the default portable path. A second path
can compile a document collection:

```text
collection.yaml
  -> scripts/strategy_kb.py validate-collection
  -> scripts/strategy_kb.py build-kb
  -> kb_manifest.json + source_map.json + citations.json
  -> scripts/strategy_kb.py compile-skill
  -> generated strategy skill
```

The collection path uses the OpenKB adapter instead of `extract_document.py`,
and generated skills add these copied reference files:

- `references/kb_manifest.json`
- `references/source_map.json`
- `references/citations.json`

Generated OpenKB-backed skills answer from `schema_tags.json` first. A future
runtime query path may search the copied KB artifacts when a user asks a
long-tail question that is not covered by compiled schema tags.

### OpenKB Adapter Modes

`scripts/strategy_kb.py build-kb` supports:

- `--openkb-mode auto` (default): detects a real OpenKB checkout. If OpenKB
  runtime dependencies and an LLM key are available, it may run upstream
  `openkb init/add`; otherwise it writes source-backed normalized artifacts.
- `--openkb-mode source-only`: requires no OpenKB Python dependencies beyond
  the checkout shape. It creates an OpenKB-compatible workspace and normalizes
  source documents into `pages.json` and `citations.json`.
- `--openkb-mode cli-ingest`: requires upstream OpenKB dependencies and an LLM
  key. It runs native OpenKB ingestion and fails fast if the environment cannot
  support it.

The normalized contract stays the same in all modes:

```text
kb_manifest.json
source_map.json
citations.json
openkb_raw/pages.json
openkb_raw/citations.json
```

### OpenRouter Configuration

When OpenKB runs through LiteLLM, the model string selects the provider. For
OpenRouter, use an `openrouter/...` model name. A separate base URL is normally
not required for this path.

Recommended `third_party/OpenKB/.env` shape:

```bash
LLM_API_KEY=sk-or-...
OPENROUTER_API_KEY=sk-or-...
OPENKB_MODEL=openrouter/deepseek/deepseek-chat
OPENKB_LITELLM_TIMEOUT=300
OPENROUTER_HTTP_REFERER=https://hermes.local
OPENROUTER_X_TITLE=Hermes Strategy KB
```

`LLM_API_KEY` keeps upstream OpenKB happy; `OPENROUTER_API_KEY` keeps provider
detection explicit. `OPENKB_MODEL` can also be supplied with
`--openkb-model`, which takes precedence over `.env`.

The adapter writes `OPENROUTER_HTTP_REFERER` and `OPENROUTER_X_TITLE` into the
generated OpenKB workspace as `extra_headers`. For non-OpenRouter headers, use:

```bash
OPENKB_EXTRA_HEADER_X_TRACE_ID=trace-123
```

### Runtime KB Query

Runtime query is a planned fallback for generated OpenKB-backed skills:

```text
schema_tags.json first
  -> source_digest.md
  -> strategy_kb_search over copied KB artifacts
  -> cited answer or explicit unknown
```

The query tool should return JSON passages and citations. It should not return
a final prose answer and should not rewrite `schema_tags.json`.

Planned CLI shape:

```bash
python <business-strategy-skill-pack>/scripts/strategy_kb_query.py search \
  --skill-dir ~/.hermes/skills/biz-strategy/marketing-insight-kb-real \
  --query "流程2.5 的判断标准来自哪里？" \
  --top-k 8
```

See `docs/biz_spec/strategy_kb_runtime_query_spec.md` for the full contract.

## Troubleshooting

If `fallback: true`, inspect `fallback_reason`. The most common causes are an
unreadable source path, unsupported source format, or an extractor crash.

If many fields are missing, inspect whether the document contains explicit
schema evidence. Semantic mapping is conservative and only uses source-backed
phrases.
