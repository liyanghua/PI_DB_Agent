# Keyword Trend Skill

## 触发词

- 趋势
- 上升
- 下降
- 势头
- 会火吗
- TMS
- 关键词趋势

## 默认调用顺序

当用户问"某个类目的关键词趋势"或"哪些词在上升"时：

1. **主入口**：直接调用 `analyze_keyword_trend({ category: "用户提供的类目名", live: false, top_n: 20 })`

2. **结果解读**：
   - 优先展示 `top_rising`（上升 TOP）：按 TMS 降序
   - 次要展示 `top_falling`（下降 TOP）：警示作用
   - 每个关键词附 `rank_reason`（如"月环比显著上升，年同比走强"）

3. **追查字段来源**（按需）：
   - 如果用户问"TMS 是怎么算的"，解释四个子分（MoM 40% + YoY 30% + Slope 20% + Consistency 10%），引用 `docs/14_KOIF_NAMESPACE_OVERVIEW.md §5.2`
   - 如果用户问"为什么某个词是上升/下降"，从 `explanation.subscores` 中找子分明细

4. **与 KDS 联动**（可选）：
   - 用户问"哪些上升词需求也强"，建议用 `propose_koif_strategy` 联合分析

## 错误回流

| 错误 code | 用户提示 | 下一步 |
| --- | --- | --- |
| `live_no_keyword_data` | live 模式下接口可用，但关键词总数 < 5 | 切换到 `live: false` 或检查类目名 |
| `fixture_not_found` | mock fixture 路径不存在 | 引导用户：(1) 更正类目名拼写；(2) 切换到 `live: true`；(3) 列出可用 fixture 类目 |
| `no_keywords_after_normalize` | 归一化后关键词数量为 0 | 同上 |

## 不允许的操作

- **禁止**在没有 run_id 的情况下凭印象猜测趋势标签
- **禁止**手动计算 TMS（必须调用工具）
- **禁止**跨类目对比趋势（Phase 2 不支持，提示用户单独跑两次）

## 示例对话

**用户**：桌布有哪些词在上升？

**Assistant**：
```
[调用 analyze_keyword_trend({ category: "桌布", live: false, top_n: 10 })]
[返回 run_id + top_rising + top_falling]

桌布类目上升趋势 TOP 10：

1. **轻奢桌布**（TMS 87）- 月环比显著上升，年同比走强，连续上升
2. **法式桌布**（TMS 82）- 月环比显著上升，年同比走强
3. **简约桌布**（TMS 78）- 月环比显著上升
4. **北欧桌布**（TMS 75）- 月环比显著上升
5. **茶几桌布**（TMS 72）- 趋势斜率陡
...

完整报告：`registry/derived/keyword_trend/202503151230__tms_v1__121458013__a1b2c3d4/trend_summary.md`
```

**用户**：为什么"轻奢桌布"TMS 这么高？

**Assistant**：
```
[从之前返回的 top_rising 中查找 "轻奢桌布" 的 explanation.subscores]

"轻奢桌布"的 TMS 87 分由以下四个子分合成：
- 月环比强度（MoM）：100 分（search_popularity_mom ≥ 0.5，即环比增长 ≥ 50%）
- 年同比强度（YoY）：80 分（search_popularity_yoy ≥ 0.1）
- 趋势斜率（Slope）：75 分（trend_slope ≥ 0.1）
- 连续性（Consistency）：100 分（search_value_trend = "rising"，持续上升）

综合判断：月环比显著上升，年同比走强，连续上升。
```