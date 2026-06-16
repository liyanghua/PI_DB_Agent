# DB Archaeologist Demo Session

以下 transcript 全部由 `npm run smoke:pi` 等价路径自动捕获，工具回包来自 `.pi/extensions/db_archaeologist.extension.ts`，数据全部来自 `registry/derived/`。

## Scene 1 — 商品最近 7 天转化下降归因

Agent 先用 select_tools_for_task 列出工具链与参数缺口，再用 list_domain_apis 看商品域候选接口。

**User**: 分析商品 1234 最近 7 天转化下降的原因

**Tool call**: `select_tools_for_task`

```json
{
  "task": "分析商品 1234 最近 7 天转化下降的原因",
  "known_params": {
    "goods_id": "1234"
  }
}
```

**Tool result**:

```json
{
  "task": "分析商品 1234 最近 7 天转化下降的原因",
  "intent": "转化 | 下降 | 商品",
  "recommended_tools": [
    {
      "tool_id": "auto_关键词域_关键词分析",
      "call_order": 1,
      "reason": "intent_match domain=关键词域 capability=关键词分析 hints=[转化,下降,商品]",
      "required_params": [
        "start_date",
        "tertiary_category",
        "end_date",
        "search_popularity",
        "keyword_a",
        "category_id"
      ],
      "missing_params": [
        "start_date",
        "tertiary_category",
        "end_date",
        "search_popularity",
        "keyword_a",
        "category_id"
      ],
      "source_apis": [],
      "quality_score": 0.5,
      "risks": []
    },
    {
      "tool_id": "get_goods_core_metrics",
      "call_order": 2,
      "reason": "intent_match domain=商品域 capability=商品核心经营指标查询 hints=[转化,下降,商品]",
      "required_params": [],
      "missing_params": [],
      "source_apis": [
        "/agent/goods_id/ads_fact_item_summary_d"
      ],
      "quality_score": 0.797,
      "risks": []
    },
    {
      "tool_id": "get_keyword_trends",
      "call_order": 3,
      "reason": "intent_match domain=关键词域 capability=关键词趋势分析 hints=[转化,下降,商品]",
      "required_params": [],
      "missing_params": [],
      "source_apis": [
        "/agent/sycm_keyword",
        "/data/bluekeyword/trend"
      ],
      "quality_score": 0.855,
      "risks": []
    },
    {
      "tool_id": "get_competition_pattern",
      "call_order": 4,
      "reason": "intent_match domain=竞争域 capability=竞争格局分析 hints=[转化,下降,商品]",
      "required_params": [],
      "missing_params": [],
      "source_apis": [
        "/data/competition_pattern_analysis",
        "/data/competition_pattern_analysis_v3"
      ],
      "quality_score": 0.838,
      "risks": []
    }
  ],
  "blocked_or_deprioritized": [

…(truncated)
```

**User**: 商品域里目前 agent_ready 的接口都有哪些？

**Tool call**: `list_domain_apis`

```json
{
  "domain": "商品域",
  "status": "agent_ready",
  "limit": 5
}
```

**Tool result**:

```json
{
  "domain": "商品域",
  "count": 5,
  "apis": [
    {
      "api_id": "agent_dws_category_goods_m",
      "method": "POST",
      "path": "/agent/dws_category_goods_m",
      "name": "行业商品详细指标",
      "lifecycle_status": "agent_ready",
      "quality_score": 0.877,
      "capability": "商品分析",
      "issues": []
    },
    {
      "api_id": "data_ads_ind_trade_category_goods_m",
      "method": "POST",
      "path": "/data/ads_ind_trade_category_goods_m",
      "name": "月-热销商品-按交易总量排序",
      "lifecycle_status": "agent_ready",
      "quality_score": 0.867,
      "capability": "商品分析",
      "issues": []
    },
    {
      "api_id": "data_cust_ads_ad_flow_goods_7d",
      "method": "GET",
      "path": "/data/cust/ads_ad_flow_goods_7d",
      "name": "客户-付费投流-商品",
      "lifecycle_status": "agent_ready",
      "quality_score": 0.84,
      "capability": "商品分析",
      "issues": []
    },
    {
      "api_id": "data_ads_goods_price_range_rank_m",
      "method": "POST",
      "path": "/data/ads_goods_price_range_rank_m",
      "name": "价格带竞争对手分析-商品",
      "lifecycle_status": "agent_ready",
      "quality_score": 0.819,
      "capability": "商品分析",
      "issues": []
    },
    {
      "api_id": "data_ads_goods_price_range_rank_m_cust_price",
      "method": "POST",
      "path": "/data/ads_goods_price_range_rank_m_cust_price",
      "name": "价格带竞争对手分析-自定义价格带-商品",
      "lifecycle_status": "agent_ready",
      "quality_score": 0.819,
      "capability": "商品分析",
      "issues": []
    }
  ]
}
```

## Scene 2 — 蓝海关键词挖掘

ask_api_catalog 直接做问答，再用 explain_tool_lineage 解释字段血缘。

**User**: 有没有可以挖蓝海关键词的接口？

**Tool call**: `ask_api_catalog`

```json
{
  "question": "蓝海关键词挖掘",
  "domain": "关键词域",
  "limit": 5
}
```

**Tool result**:

```json
{
  "answer_type": "api_candidates",
  "question": "蓝海关键词挖掘",
  "candidates": [
    {
      "api_id": "data_blue_keyword_7d",
      "name": "类目搜索蓝海词明细",
      "method": "POST",
      "path": "/data/blue_keyword_7d",
      "domain": "关键词域",
      "lifecycle_status": "agent_ready",
      "quality_score": 0.897,
      "reason": "domain_hint:关键词, lexical:0.50, ngram:0.50, quality:0.90, status:agent_ready+0.05",
      "risks": []
    },
    {
      "api_id": "data_ind_category_keywords_detail_v2",
      "name": "类目搜索词明细V2",
      "method": "GET",
      "path": "/data/ind/category_keywords_detail_v2",
      "domain": "关键词域",
      "lifecycle_status": "agent_ready",
      "quality_score": 0.894,
      "reason": "domain_hint:关键词, lexical:0.50, ngram:0.50, quality:0.89, status:agent_ready+0.05",
      "risks": []
    },
    {
      "api_id": "data_ind_category_keywords_detail",
      "name": "类目搜索词明细",
      "method": "GET",
      "path": "/data/ind/category_keywords_detail",
      "domain": "关键词域",
      "lifecycle_status": "agent_ready",
      "quality_score": 0.871,
      "reason": "domain_hint:关键词, lexical:0.50, ngram:0.50, quality:0.87, status:agent_ready+0.05",
      "risks": []
    },
    {
      "api_id": "data_blue_keyword_7d_v2",
      "name": "类目搜索蓝海词明细V2",
      "method": "POST",
      "path": "/data/blue_keyword_7d_v2",
      "domain": "关键词域",
      "lifecycle_status": "agent_ready",
      "quality_score": 0.829,
      "reason": "domain_hint:关键词, lexical:0.50, ngram:0.50, quality:0.83, status:agent_ready+0.05",
      "risks": []
    },
    {
      "api_id": "agent_blue_ocean_keywords_analysis",
      "name": "生意参谋昨日蓝海关键词分析",
      "method": "POST",
      "path": "/agent/blue_ocean_keywords_analysis",
      "domain": "关键词域",
      "lifecycle_status": "agent_ready",
 
…(truncated)
```

**User**: 搜索人气这个指标具体来自哪个接口？

**Tool call**: `explain_tool_lineage`

```json
{
  "metric": "搜索人气"
}
```

**Tool result**:

```json
{
  "found": true,
  "root": {
    "type": "Metric",
    "id": "metric.搜索人气",
    "label": "搜索人气"
  },
  "steps": [],
  "text": "# Metric 搜索人气\n\n## APIs producing this metric\n- (no matching API)"
}
```

## Scene 3 — 竞争格局 V3

ask_api_catalog 做接口定位，get_api_asset_card 拉完整资产卡确认入参。

**User**: 哪个接口能查竞争格局 V3？

**Tool call**: `ask_api_catalog`

```json
{
  "question": "竞争格局 V3 哪个接口",
  "limit": 3
}
```

**Tool result**:

```json
{
  "answer_type": "api_candidates",
  "question": "竞争格局 V3 哪个接口",
  "candidates": [
    {
      "api_id": "data_competition_pattern_analysis_v3",
      "name": "竞争格局分析V3",
      "method": "POST",
      "path": "/data/competition_pattern_analysis_v3",
      "domain": "竞争域",
      "lifecycle_status": "agent_ready",
      "quality_score": 0.792,
      "reason": "domain_hint:竞争, capability_match:竞争格局, lexical:0.63, ngram:0.55, quality:0.79, status:agent_ready+0.05",
      "risks": []
    },
    {
      "api_id": "data_shop_competition_pattern_analysis_v3",
      "name": "竞争格局分析-商品查询",
      "method": "POST",
      "path": "/data/shop_competition_pattern_analysis_v3",
      "domain": "竞争域",
      "lifecycle_status": "agent_ready",
      "quality_score": 0.79,
      "reason": "domain_hint:竞争, capability_match:竞争格局, lexical:0.63, ngram:0.45, quality:0.79, status:agent_ready+0.05",
      "risks": []
    },
    {
      "api_id": "data_agent_competition_pattern_analysis_v3",
      "name": "竞争格局分析v3-行业商品查询for智能体",
      "method": "POST",
      "path": "/data/agent/competition_pattern_analysis_v3",
      "domain": "竞争域",
      "lifecycle_status": "verified",
      "quality_score": 0.768,
      "reason": "domain_hint:竞争, capability_match:竞争格局, lexical:0.63, ngram:0.45, quality:0.77",
      "risks": []
    }
  ],
  "recommended_tools": [
    {
      "tool_id": "get_competition_pattern",
      "tool_name": "获取竞争格局",
      "reason": "wraps data_competition_pattern_analysis_v3"
    }
  ],
  "notes": "total_matched=92, returned=3, domain_filter=none"
}
```

**User**: 把这张卡完整给我看看

**Tool call**: `get_api_asset_card`

```json
{
  "api_id": "data_competition_pattern_analysis"
}
```

**Tool result**:

```json
{
  "found": true,
  "card": {
    "api_id": "data_competition_pattern_analysis",
    "source_seq": 17,
    "name": "竞争格局分析V2",
    "module": "智能体二期",
    "method": "POST",
    "path": "/data/competition_pattern_analysis",
    "path_raw": "/data/competition_pattern_analysis",
    "domain": "竞争域",
    "lifecycle_status": "verified",
    "quality_score": 0.838,
    "source_line_no": 1067,
    "request_schema": {
      "query": [
        {
          "name": "tertiary_category",
          "type": "string",
          "required": false,
          "desc": "三级类目",
          "position": "query"
        },
        {
          "name": "business_date",
          "type": "string",
          "required": false,
          "desc": "月份",
          "position": "query"
        }
      ],
      "body": null,
      "headers": [
        "x-ca-appCodeKey",
        "x-ca-appCode",
        "Content-Type"
      ],
      "path_params": []
    },
    "response_schema": {
      "root": "data.result[]",
      "fields": [
        {
          "path": "code",
          "name": "code",
          "type": "string",
          "desc": "none"
        },
        {
          "path": "msg",
          "name": "msg",
          "type": "string",
          "desc": "none"
        },
        {
          "path": "data",
          "name": "data",
          "type": "object",
          "desc": "none"
        },
        {
          "path": "data.result",
          "name": "result",
          "type": "[object]",
          "desc": "none"
        },
        {
          "path": "data.result.commodity",
          "name": "commodity",
          "type": "string",
          "desc": "商品名称"
        },
        {
          "path": "data.result.main_color",
          "name": "main_color",
          "type": "null",
          "desc": "主推
…(truncated)
```

## Scene 4 — 空返回 / 字段缺失排查

list_api_quality_issues 过滤问题接口，确认它们没进 tool_registry。

**User**: 返回字段说明缺失的接口有哪些？

**Tool call**: `list_api_quality_issues`

```json
{
  "issue_type": "missing_response_fields",
  "limit": 5
}
```

**Tool result**:

```json
{
  "count": 5,
  "issues": [
    {
      "api_id": "analysis_main_detail_p",
      "method": "POST",
      "path": "/analysis/main_detail_p",
      "domain": "视觉素材域",
      "lifecycle_status": "candidate",
      "issue_type": "missing_response_fields",
      "severity": "medium"
    },
    {
      "api_id": "analysis_main_detail_p",
      "method": "POST",
      "path": "/analysis/main_detail_p",
      "domain": "视觉素材域",
      "lifecycle_status": "candidate",
      "issue_type": "missing_response_fields",
      "severity": "medium"
    },
    {
      "api_id": "qbtapidoc_index_index",
      "method": "GET",
      "path": "/qbtapidoc/index/index",
      "domain": "未分类域",
      "lifecycle_status": "candidate",
      "issue_type": "missing_response_fields",
      "severity": "medium"
    },
    {
      "api_id": "qbtapidoc_index_index",
      "method": "GET",
      "path": "/qbtapidoc/index/index",
      "domain": "未分类域",
      "lifecycle_status": "candidate",
      "issue_type": "missing_response_fields",
      "severity": "medium"
    },
    {
      "api_id": "data_best_seller_key_element_m",
      "method": "GET",
      "path": "/data/best_seller_key_element_m",
      "domain": "未分类域",
      "lifecycle_status": "candidate",
      "issue_type": "missing_response_fields",
      "severity": "medium"
    }
  ],
  "blocked_apis": [
    {
      "api_id": "get_main_image_info",
      "reasons": [
        "quality_below_0.75",
        "status_candidate"
      ]
    },
    {
      "api_id": "get_positive_comment_data",
      "reasons": [
        "quality_below_0.75",
        "status_candidate"
      ]
    },
    {
      "api_id": "get_crowd_gender_info",
      "reasons": [
        "quality_below_0.75",
        "status_candidate"
      ]
    },
    {
      "api_id": "analysis_ma
…(truncated)
```

**User**: 路径里带 {api-id} 占位符的接口都被屏蔽了吗？

**Tool call**: `list_api_quality_issues`

```json
{
  "issue_type": "path_placeholder",
  "limit": 5
}
```

**Tool result**:

```json
{
  "count": 3,
  "issues": [
    {
      "api_id": "public_api_data_source_dsid_data",
      "method": "POST",
      "path": "/public-api/data-source/{dsId}/data",
      "domain": "未分类域",
      "lifecycle_status": "blocked",
      "issue_type": "path_placeholder",
      "severity": "high",
      "message": "/public-api/data-source/{dsId}/data"
    },
    {
      "api_id": "public_api_data_source_dsid_token_token",
      "method": "POST",
      "path": "/public-api/data-source/{dsId}/token/{token}",
      "domain": "未分类域",
      "lifecycle_status": "blocked",
      "issue_type": "path_placeholder",
      "severity": "high",
      "message": "/public-api/data-source/{dsId}/token/{token}"
    },
    {
      "api_id": "task_task_id",
      "method": "GET",
      "path": "/task/{task_id}",
      "domain": "任务域",
      "lifecycle_status": "blocked",
      "issue_type": "path_placeholder",
      "severity": "high",
      "message": "/task/{task_id}"
    }
  ],
  "blocked_apis": [
    {
      "api_id": "get_main_image_info",
      "reasons": [
        "quality_below_0.75",
        "status_candidate"
      ]
    },
    {
      "api_id": "get_positive_comment_data",
      "reasons": [
        "quality_below_0.75",
        "status_candidate"
      ]
    },
    {
      "api_id": "get_crowd_gender_info",
      "reasons": [
        "quality_below_0.75",
        "status_candidate"
      ]
    },
    {
      "api_id": "analysis_main_detail_p",
      "reasons": [
        "quality_below_0.75",
        "status_candidate"
      ]
    },
    {
      "api_id": "qbtapidoc_index_index",
      "reasons": [
        "quality_below_0.75",
        "status_candidate"
      ]
    },
    {
      "api_id": "data_best_seller_key_element_m",
      "reasons": [
        "quality_below_0.75",
        "stat
…(truncated)
```
