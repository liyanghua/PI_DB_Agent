# Knowledge Graph Specification

## 1. 目标

KG 用来解释：为什么某个业务问题需要某些工具，工具背后封装了哪些 API，API 返回哪些字段，这些字段对应什么指标和实体。

## 2. 节点类型

```yaml
node_types:
  BusinessQuestion:
    keys: [question_id, text, scenario]
  Domain:
    keys: [domain_id, name]
  Capability:
    keys: [capability_id, name]
  Tool:
    keys: [tool_id, name]
  API:
    keys: [api_id, method, path]
  Entity:
    keys: [entity_id, name]
  Metric:
    keys: [metric_id, cn_name, aliases]
  Field:
    keys: [field_path, name, type]
  Issue:
    keys: [issue_type, severity]
```

## 3. 边类型

```yaml
edge_types:
  QUESTION_NEEDS_CAPABILITY
  CAPABILITY_USES_TOOL
  TOOL_WRAPS_API
  API_BELONGS_TO_DOMAIN
  API_RETURNS_FIELD
  FIELD_MAPS_TO_METRIC
  FIELD_DESCRIBES_ENTITY
  API_HAS_ISSUE
  TOOL_REQUIRES_PARAM
  TOOL_FALLBACK_TO_TOOL
```

## 4. MVP 存储

MVP 可用 JSONL：

- `kg_nodes.jsonl`
- `kg_edges.jsonl`

P1 再接 Kuzu / Neo4j。
