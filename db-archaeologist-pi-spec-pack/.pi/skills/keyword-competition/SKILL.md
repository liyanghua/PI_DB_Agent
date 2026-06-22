# Keyword Competition Skill

## 触发词

- 竞争
- 卷不卷
- 内卷
- 红海
- 蓝海
- 出价
- CPC
- 点击单价
- CPS
- 关键词竞争
- 关键词卷不卷
- 投放成本
- 关键词市场行情

## 默认调用顺序

当用户问「某个类目的关键词竞争激烈吗」「这些词卷不卷」「市场出价多少」时：

1. **主入口**：直接调用 `analyze_keyword_competition({ category: "用户提供的类目名", live: false, top_n: 20 })`

2. **结果解读**：
   - 优先展示 `top_overall`（综合 TOP）：按 CPS 降序
   - 同时关注 `top_by_bucket`：strong / moderate / weak 三档分布
   - 每个关键词附 `rank_reason`、`bucket`、`cpc_source` 字段：
     - `cpc_source = paid`：该词样本租户已投放，CPS 用关键词级真实 CPC
     - `cpc_source = missing`：该词未投放，CPS 退化为类目级 `solo_competition_index`，提示用户该评分仅反映类目竞争密度，不含个体出价信息

3. **追查字段来源**（按需）：
   - 如果用户问「CPS 是怎么算的」，解释主公式：`CPS = 0.60 × competition_index_normalized + 0.40 × market_avg_bid_normalized`，引用 `docs/14_KOIF_NAMESPACE_OVERVIEW.md §5.3` 与 `docs/20_KEYWORD_COMPETITION_PACK_SPEC.md §2`
   - 如果用户问「为什么这词竞争强」，从 `explanation.subscores` 中找子分明细，从 `explanation.field_provenance` 中找 source_api 与 aggregation_kind（`category_broadcast` 表示类目级广播，`keyword_native` 表示关键词级原生）

4. **双源数据特性**（用户问「数据来自哪里」时主动说明）：
   - 投流域（`data_cust_ads_ad_flow_plan_goods_keyword_7d`）：提供关键词级 CPC，仅覆盖样本租户已投放词
   - 竞争域（`data_competition_pattern_analysis`）：提供类目级 distinct_shop_count、brand_concentration，按 `tertiary_category` 聚合后广播到所有同类目关键词

5. **与 KDS / TMS 联动**（可选）：
   - 用户问「哪些词需求强但竞争弱」（蓝海挖掘），建议用 `propose_koif_strategy` 联合分析
   - 用户问「哪些上升词正在被抢」，先 `analyze_keyword_trend` 再 `analyze_keyword_competition` 交叉

## 错误回流

| 错误 code | 用户提示 | 下一步 |
| --- | --- | --- |
| `strategy_not_found` | 策略名未注册 | 默认 `cps_baseline_v1`，或检查 `registry/keyword_strategies.yaml` |
| `live_no_keyword_data` | live 模式下双源都无数据 | 切回 `live: false` 走 fixture，或检查类目名 / 凭据 |
| `fixture_not_found` | mock fixture 路径不存在 | 引导用户：(1) 更正类目名拼写；(2) 切换到 `live: true`；(3) 列出可用 fixture 类目（目前：入户地垫） |
| `no_keywords_after_normalize` | 归一化后关键词数量为 0 | 检查 fixture / live 数据是否非空；检查 `keyword_universe_source` |

## 不允许的操作

- **禁止**输出预算金额、ROI 阈值、出价上下限等决策语；CPS 工具只产出客观竞争评分。带预算 / 进退场建议的请求必须走 `propose_koif_decision`（Phase 3.5 实质化）
- **禁止**手动计算 CPS（必须调用工具）
- **禁止**把同类目下 record 的 `competition_index` 全相同当成 bug；这是类目级广播的预期行为，区分度由 CPC 提供

## 示例对话

**用户**：入户地垫这些词卷不卷？

**Assistant**：
```
[调用 analyze_keyword_competition({ category: "入户地垫", live: false, top_n: 10 })]
[返回 run_id + top_overall + top_by_bucket]

入户地垫类目竞争评分 TOP 10：

1. **入户地垫 防滑垫**（CPS 87.7，strong）- 类目竞争密度高，已投放词出价较强
2. **入户地垫 进门**（CPS 82.3，strong）- 同类目内卷较高，CPC 关键词级
3. **入户地垫 大尺寸**（CPS 76.5，moderate）- ...
...

未投放词（cpc_source=missing）：3 个走 solo_competition_index 路径，仅反映类目级竞争密度。

完整报告：`registry/derived/keyword_competition/cps_baseline_v1__121458013__a1b2c3d4/cps_report.md`
```

**用户**：为什么"入户地垫 防滑垫"CPS 这么高？

**Assistant**：
```
[从之前返回的 top_overall 中查找该词的 explanation.subscores 与 field_provenance]

"入户地垫 防滑垫"的 CPS 87.7 由两个子分合成：
- 类目竞争指数（competition_index）：23.86（log10(distinct_shop_count+1) × 25），来源 data_competition_pattern_analysis 类目级广播
- 关键词级 CPC（market_avg_bid_normalized）：基于该词样本租户实际 avg_cost_per_clk 加权平均后归一，来源 data_cust_ads_ad_flow_plan_goods_keyword_7d 关键词级原生

判断：类目竞争密度中等，但该词关键词级实际出价较高，整体偏 strong。
```