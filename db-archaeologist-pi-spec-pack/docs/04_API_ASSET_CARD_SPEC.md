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
verified_call:                    # 可选；validation overlay 命中时由 build_cards 注入
  base_url_segment: string         # 如 "/openApi/api/1958050182385065986/5"
  url_template: string             # host 之外的 path+query 模板，user params 可替换占位
  body_template: object            # 文档"修复后入参"原 JSON；user params 覆盖默认值
  auth_inject_policy:
    style: "query_camel" | "body_snake"
    identity_keys: [string]        # 默认 ["userId","tenantId"]
    headers_required: [string]     # 默认 ["x-ca-appCodeKey","x-ca-appCode"] —— 网关签名头，值来自 env
  verified_status: "success" | "empty" | "business_failed" | "unauthorized" | "untestable"
  verified_code: string?           # 文档"修复后状态"对应的 HTTP code 或业务 code
  verified_msg: string?            # 文档"说明/验证信息"里的 msg
  fix_note: string?                # "已按 dev 日志 bodyParam 修复" 等来源说明
  source_seq: number               # 对应文档"序号"列
  source_line_no: number           # 文档行号，便于溯源
  last_verified_at: string?        # ISO 8601；留给后续 contract probe 实时探活写入
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
- `verified_call.verified_status === "unauthorized"`：直接降为 `blocked`，`issue_marker = "appCodeKey_unauthorized"`，表示当前 appCodeKey 无权限调用该接口。

## 5. 权威性优先级

当同一 API 的请求参数出现多份来源时，优先级如下：

1. **verified_call**（最高权威）：来自全量验证版.md，是人工调通后的真实参数。运行时（api_runtime.ts）优先走此分支。
2. **request_schema**（次级权威）：来自 markdown_detail_extractor 解析的 markdown 详细章节，基于文档声明但可能过时。
3. **markdown index 表头**（兜底）：来自 markdown_api_extractor 解析的索引表，只有 method/path/name，无参数细节。

在 LLM 工具输出（如 `get_api_asset_card`）中，当 `verified_call` 存在时：
- 同时展示 `verified_call` 与 `request_schema` 两份。
- `verified_call` 段落前打 `[verified]` 徽标，说明"已验证可用"。
- `request_schema` 段落前打 `[documented]` 徽标，说明"文档声明，可能过时"。
- 提示 Agent 优先信任 `[verified]` 参数。

## 6. verified_call 与 lifecycle 的关系

本期（Phase 1 & Phase 2）明确解耦：

- `verified_call` 的存在**不自动驱动** `lifecycle_status` 升级。
- `decideLifecycle` / `scoreCard` 函数**不读** `verified_call` 字段。
- 原因：全量验证版.md 有 113 个成功接口，一次性升级会破坏现有 promote 策略和 golden case 基线。

lifecycle 升级策略（success → verified）将在独立 promote plan 中设计，包括：
- 人工审核批次（区分 P0/P1/P2）
- 补充 contract test
- 更新 tool_registry.yaml
- 重跑 golden case

Phase 2 实施时，`verified_call` 仅作为运行时路由依据和 LLM 渲染增强，不影响 cards 的 `lifecycle_status` 与 `quality_score` 计算。
