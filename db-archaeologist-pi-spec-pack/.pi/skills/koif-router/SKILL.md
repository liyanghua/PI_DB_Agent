# KOIF Router Skill

## 触发词

- 关键词机会
- 经营策略
- 怎么做关键词
- 综合分析
- KOIF
- 策略路由

## 默认调用顺序

当用户问"某个类目的关键词机会"或"怎么经营某个类目的关键词"时：

1. **主入口**：直接调用 `propose_koif_strategy({ category: "用户提供的类目名", capabilities: ["kds", "tms"], live: false })`
   
2. **结果解读**：
   - 如果返回 `router_run_id`，说明成功：向用户展示 `strategy_routes`（命中策略）+ `next_actions`（行动建议）
   - 优先用业务语言陈述，避免工程术语（不说"KDS 70"，说"需求强度较高"）
   - 关键词列表最多展示 5 个，更多用"等 N 个词"收尾

3. **追查详情**（按需）：
   - 如果用户追问"为什么命中这些策略"，用 `get_koif_route({ router_run_id })` 拉 `router_report.md` 完整解释
   - 如果用户问"某个具体关键词的分数"，从 `score_vector_top` 中找，或提示用 `analyze_keyword_demand` / `analyze_keyword_trend` 单独查

4. **历史查询**：
   - 用户问"之前跑过哪些类目"，调 `list_koif_routes({ limit: 10 })`

## 错误回流

| 错误 code | 用户提示 | 下一步 |
| --- | --- | --- |
| `koif_no_capabilities_available` | 所有能力都未启用或执行失败，请检查 fixture 或切换到 `live: false` 模式 | 引导用户检查类目名拼写，或列出可用类目 |
| `koif_score_aggregation_failed` | 关键词分数聚合失败，可能是 run 产物格式不兼容 | 提示用户联系管理员检查 capability run 目录 |
| `category_not_resolved` | 类目名无法解析到 category_id | 提示用户：(1) 更正类目名拼写；(2) 直接传 `category_id` |
| `router_run_not_found` | 指定的 router_run_id 不存在 | 用 `list_koif_routes` 列出可用 run |

## 不允许的操作

- **禁止**在没有 run_id 的情况下凭印象猜测策略或行动建议
- **禁止**跨 capability 手动拼装 score_vector（必须通过 Router 聚合）
- **禁止**解释 Router 内部路由规则细节（只说"根据需求强度与趋势强度综合判断"）

## 示例对话

**用户**：帮我看下"桌布"这个词的关键词经营机会

**Assistant**：
```
[调用 propose_koif_strategy({ category: "桌布", capabilities: ["kds", "tms"], live: false })]
[返回 router_run_id + strategy_routes + next_actions]

根据分析，"桌布"类目有以下经营机会：

【策略命中】
1. **老品优化**：有 12 个高需求关键词（如"防水桌布"、"北欧桌布"、"茶几桌布"等）适合在现有商品标题中强化覆盖
2. **内容候选**：有 5 个词同时具备高需求与上升趋势，可围绕它们制作内容种草

【行动建议】
- 标题优化：优先纳入"防水桌布"、"北欧桌布"、"茶几桌布"、"餐桌桌布"、"PVC桌布"
- 内容选题：可围绕"轻奢桌布"、"法式桌布"、"简约桌布"制作短视频/图文笔记，这些词月环比均值 +18.3%

详细报告已保存至 `registry/koif_routes/router_v1__202503151230__121458013__a1b2c3d4/router_report.md`。
```

**用户**：为什么"防水桌布"适合标题优化？

**Assistant**：
```
[从之前返回的 score_vector_top 中查找 "防水桌布"]

"防水桌布"的需求强度（KDS）为 82，属于强需求词；趋势强度（TMS）为 65，处于平稳状态。虽然不在上升期，但搜索基数大、转化潜力强，适合作为老品标题的核心词嵌入，能有效承接现有搜索流量。
```