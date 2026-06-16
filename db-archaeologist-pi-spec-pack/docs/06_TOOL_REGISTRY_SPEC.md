# Tool Registry Specification

## 1. 定义

Tool Registry 是 Agent 可用能力目录。API 不能直接暴露给 Agent，必须包装成业务化 Tool。

## 2. Tool 字段

```yaml
tool_id: string
tool_name: string
description: string
domain: string
capability: string
input_schema: object
output_schema: object
source_apis: []
call_policy:
  require_tenant_scope: boolean
  max_rows: number
  cache_ttl: string
  timeout_ms: number
quality_gate:
  min_quality_score: number
  required_status: []
  require_contract_test: boolean
runtime:
  enabled_in_pi: boolean
  pi_tool_name: string
```

## 3. MVP Tool 列表

- `ask_api_catalog`
- `select_tools_for_task`
- `get_api_asset_card`
- `explain_tool_lineage`
- `list_domain_apis`
- `list_api_quality_issues`

业务 API wrapper 候选：

- `get_goods_core_metrics`
- `get_goods_basic_info`
- `get_goods_traffic_sources`
- `get_keyword_trends`
- `get_competition_pattern`
- `get_price_range_competitors`
- `get_ad_flow_keywords`
- `get_task_goods_daily`

## 4. 工具选择原则

- 优先 verified/agent_ready。
- 优先业务语义更清楚的工具，而不是 path 更像的接口。
- 有字段缺失/空返回的接口只能作为 fallback。
- 测试目录接口默认不推荐，除非用户明确要求测试环境。
