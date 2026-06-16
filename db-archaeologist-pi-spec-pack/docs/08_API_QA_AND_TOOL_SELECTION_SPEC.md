# API QA and Tool Selection Specification

## 1. API 问答算法

```text
Input question
  -> normalize Chinese query
  -> extract domains/entities/metrics/scenarios
  -> search ApiAsset Registry
  -> expand via KG
  -> rerank by semantic score + quality score + lifecycle status
  -> produce answer
```

## 2. 自动选工具算法

```text
Input business task
  -> task intent parse
  -> capability decomposition
  -> registry match
  -> parameter gap analysis
  -> quality and risk filter
  -> call order planner
  -> final tool chain
```

## 3. 输出协议

```json
{
  "task": "分析商品最近7天转化下降原因",
  "recommended_tools": [
    {
      "tool_id": "get_goods_core_metrics",
      "reason": "需要确认访客、加购、转化、支付等核心指标变化",
      "required_params": ["goods_id", "start_date", "end_date"],
      "missing_params": ["goods_id"],
      "source_apis": ["/agent/goods_id/ads_fact_item_summary_d"],
      "quality_score": 0.82
    }
  ],
  "blocked_or_deprioritized": [],
  "next_question": "请提供 goods_id 和分析时间范围。"
}
```

## 4. 降权策略

- `draft`: -0.3
- `blocked`: 不返回，除非 debug 模式
- `测试模块`: -0.2
- `返回字段说明为空`: -0.15
- `返回示例为空对象`: -0.2
- `接口名称重复`: -0.08
- `请求路径重复`: -0.15
