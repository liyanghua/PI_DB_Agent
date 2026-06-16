# ApiAssetCard Specification

## 1. 定义

`ApiAssetCard` 是 DB Archaeologist Agent 的最小 API 资产单元。

它不是普通接口文档，而是包含业务语义、质量状态、领域归属、工具候选、字段映射和治理信息的机器可读卡片。

## 2. 字段规范

```yaml
api_id: string
source_seq: number
name: string
module: string
domain: string
capability: string
method: GET|POST|PUT|DELETE|PATCH
path: string
lifecycle_status: raw|draft|candidate|verified|agent_ready|deprecated|blocked
quality_score: number
issue_marker: string
request_schema:
  path: []
  query: []
  body: object|null
  headers: []
response_schema:
  root: string
  fields: []
entity_mapping: []
metric_mapping: []
tool_candidate: boolean
owner: string
notes: string
```

## 3. 质量分规则

- contract_score: 请求参数、路径、method 是否完整。
- response_score: 返回字段是否完整。
- example_score: 是否有可用返回样例。
- semantic_score: 字段中文名/说明是否明确。
- lineage_score: 是否能关联底层表或数据源。
- runtime_score: 是否 probe 成功。
- security_score: 是否有租户/权限/敏感信息策略。

MVP 质量分：

```text
quality_score =
  0.2 * contract_score +
  0.2 * response_score +
  0.15 * example_score +
  0.15 * semantic_score +
  0.1 * lineage_score +
  0.1 * runtime_score +
  0.1 * security_score
```

## 4. 降级规则

- 返回示例为空对象：最多 `candidate`。
- 返回字段说明为空：最多 `candidate`。
- 返回示例乱码：默认 `draft`。
- 请求路径重复：默认 `draft`，需要人工仲裁。
- 接口名称重复：默认降权，不一定阻塞。
- 路径含占位符 `{api-id}`：必须补环境映射后才可 verified。
