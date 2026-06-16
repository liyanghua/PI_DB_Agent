# TECH SPEC — DB Archaeologist Agent

## 1. 总体架构

```text
Source Docs
  -> Extractor
  -> Normalizer
  -> ApiAsset Registry
  -> Domain Mapping
  -> Tool Registry
  -> Knowledge Graph
  -> QA / Tool Selection
  -> Pi Runtime Tools
```

## 2. 核心模块

### 2.1 Markdown API Extractor

输入：`sources/api_docs/*.md`

输出：

- `api_index_seed.json`
- `api_asset_cards.raw.json`
- `api_parse_report.md`

必须抽取：

- seq
- module
- name
- method
- path
- issue_marker
- request params
- body schema
- response json
- response fields
- source line no

### 2.2 ApiAssetCard Normalizer

职责：

- 标准化 method/path。
- 分离 query/body/header/path params。
- 标准化返回字段路径。
- 标记空返回、字段缺失、乱码、重复接口。
- 计算质量分。

### 2.3 Domain Mapper

规则优先，LLM 辅助。

领域枚举：

- 商品域
- 店铺域
- 类目域
- 关键词域
- 竞争域
- 价格带域
- 投流域
- 流量域
- 指标域
- 任务域
- 视觉素材域
- 评论口碑域
- 公共基础域
- 租户连接域
- 未分类域

### 2.4 Tool Registry Builder

ApiAssetCard 只有满足以下条件才能成为 Tool：

- `quality_score >= 0.75`
- `lifecycle_status in [verified, agent_ready]`
- 有明确 input schema。
- 有明确 output schema。
- 有业务化 tool description。
- 有 contract test。

MVP 可允许 `candidate` 生成 `tool_candidate`，但不能进入生产 Agent runtime。

### 2.5 Knowledge Graph Builder

核心节点：

- `BusinessQuestion`
- `Scenario`
- `Domain`
- `Capability`
- `Tool`
- `API`
- `Entity`
- `Metric`
- `Field`
- `Issue`

核心边：

- `QUESTION_NEEDS_CAPABILITY`
- `CAPABILITY_USES_TOOL`
- `TOOL_WRAPS_API`
- `API_RETURNS_FIELD`
- `FIELD_MAPS_TO_METRIC`
- `API_BELONGS_TO_DOMAIN`
- `API_HAS_ISSUE`
- `TOOL_REQUIRES_PARAM`

### 2.6 API QA

检索策略：

1. query rewrite：业务问题 → 领域/能力/指标/实体关键词。
2. structured filter：domain/status/quality/path/module。
3. hybrid score：keyword + semantic + graph proximity + quality score。
4. rerank：优先 agent_ready/verified，降权 draft/test/empty response。

### 2.7 Tool Selector

输入：业务任务 + 已知参数。

输出：

- recommended_tools
- call_order
- required_params
- missing_params
- fallback_tools
- blocked_apis
- reasoning_summary

## 3. 存储建议

MVP：JSON/YAML + SQLite。

P1：SQLite + LanceDB/Chroma 做语义检索。

P2：Neo4j/Kuzu/SurrealDB 做图谱查询。

## 4. Pi Runtime 接入

通过 Pi custom tools 暴露：

- `ask_api_catalog`
- `select_tools_for_task`
- `get_api_asset_card`
- `explain_tool_lineage`

Pi extension 只做 runtime adapter，不承载业务规则。业务规则放在 registry 和 normalizer 内。
