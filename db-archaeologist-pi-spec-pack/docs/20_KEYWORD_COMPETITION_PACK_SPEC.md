# 20. Keyword Competition Pack 规范

本规范定义 `keyword_analysis_pack.keyword_competition` capability 的契约：定位、CPS 公式、数据源选型、字段映射、strategy 体系、8-stage pipeline 落点、golden case 与评测口径。

结构对齐 [12_KEYWORD_DEMAND_PACK_SPEC.md](12_KEYWORD_DEMAND_PACK_SPEC.md)。框架契约见 [11_ANALYSIS_PACK_FRAMEWORK_SPEC.md](11_ANALYSIS_PACK_FRAMEWORK_SPEC.md)。

---

## 1. capability 定位

### 1.1 身份

| 属性 | 值 |
| --- | --- |
| namespace | `keyword_analysis_pack` |
| capability | `keyword_competition` |
| score_domain | `competition` |
| 主分数 | CPS（Competition Pressure Score） |
| 工具名 | `analyze_keyword_competition` |
| 注册位置 | `.pi/extensions/db_archaeologist.extension.ts`（第 17 个工具） |
| Phase | Phase 3 实施 |
| koif_aggregatable | `true` |

### 1.2 业务交付价值

CPS 回答的业务问题：「这个关键词的竞争压力有多大？」

数值语义：CPS 越高 → 竞争越激烈。
- `< 30`：弱竞争（蓝海）
- `30 ~ 60`：中等竞争
- `> 60`：强竞争（红海）

CPS 与 KDS / TMS 联用场景：
- **强需求 + 弱竞争**（KDS ≥ 70 && CPS ≤ 50）→ 蓝海机会
- **强需求 + 强竞争**（KDS ≥ 70 && CPS ≥ 75）→ 红海博弈，需差异化
- **弱需求 + 强竞争**（KDS < 50 && CPS ≥ 75）→ 不建议进入

### 1.3 与 KOIF Router 的关系

CPS 评分作为 score_vector 一员被 router_run 聚合：
- Router S4 增 CPS 分支（详见 [docs/15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md) §3.5）
- Router 路由规则：`low_competition_high_demand`（CPS ≤ 50 && KDS ≥ 70）/ `competition_warning`（CPS ≥ 75）

CPS 不出预算/出价/ROI 等决策类话术，决策类输出走 sibling namespace `koif_decision_layer`（详见 [docs/19_KOIF_DECISION_LAYER_SPEC.md](19_KOIF_DECISION_LAYER_SPEC.md)）。

---

## 2. CPS 公式

### 2.1 主公式

```
CPS = 0.60 × competition_index_normalized + 0.40 × market_avg_bid_normalized
```

| 子分数 | 权重 | 量纲 | 来源粒度 | 说明 |
| --- | --- | --- | --- | --- |
| `competition_index` | 0.60 | 0..100 | **类目级广播** | 竞争域商品级数据按 `tertiary_category` 聚合后广播到该类目下所有关键词 |
| `market_avg_bid_normalized` | 0.40 | 0..100 | **关键词级原生** | 投流域已投放关键词的实际 CPC 按 `kw_name` 加权聚合，log 归一化 |

### 2.1.1 数据源粒度的根本差异

CPS 是 KOIF 8 capability 中第一个采用「双源 + 不同粒度」的评分。两类子分数的获取链路完全不同：

```
竞争域接口（data_competition_pattern_analysis 等）
  返回：商品级（commodity / shop / brand_name / search_rank）
  ↓ group by tertiary_category
  类目级聚合：distinct_shop_count / top3_brand_share
  ↓ 广播到类目下所有关键词
  competition_index（类目级标量，同类目所有关键词同值）

投流域接口（data_cust_ads_ad_flow_plan_goods_keyword_7d）
  返回：关键词 × 计划 × 商品级（kw_name / avg_cost_per_clk / cost / clk_cnt）
  ↓ group by kw_name
  关键词级聚合：weighted_avg(avg_cost_per_clk, weight=clk_cnt)
  ↓ left join 关键词清单
  avg_cpc_cny（关键词级原生，仅已投放词有值）
```

含义：同类目下不同关键词的 CPS 差异主要由 CPC 决定（强需求词通常 CPC 更高），`competition_index` 提供类目级竞争背景。

### 2.2 子分数计算

#### 2.2.1 competition_index（类目级，竞争域聚合）

```
fallback_chain (competition_index):
  1. distinct_shop_count_log     主源：log10(distinct_count(shop) + 1) × 25，截 [0,100]
                                 1 店铺 → 7.5；10 店铺 → 26.1；100 店铺 → 50.2；1000 店铺 → 75.2
  2. brand_concentration_top3    备份：top_3 brand_name 销售/曝光占比 × 100，0..1 → 0..100
  3. competitor_count_log        兼容：旧 fixture 字段 competitor_count 的 log 归一
  4. solo_default = 50           无信号时类目默认中等竞争
```

广播规则：竞争域接口按 `tertiary_category` 聚合一次，结果挂到 `category_metrics[tertiary_category]`，关键词记录构造时按 record.tertiary_category 取值，所有同类目记录的 competition_index 完全相同。

#### 2.2.2 market_avg_bid_normalized（关键词级，投流域聚合）

```
market_avg_bid_normalized = clip(log10(avg_cpc_cny + 1) / log10(11) × 100, 0, 100)
```

例：avg_cpc=1 元 → 28.9；avg_cpc=5 元 → 74.7；avg_cpc=10 元 → 100。

```
fallback_chain (market_avg_bid):
  1. avg_cost_per_clk            主源：投流域已投放关键词，weighted_avg(avg_cost_per_clk, weight=clk_cnt)
  2. weighted_cost_per_clk       备份：sum(cost) / sum(clk_cnt) 跨计划合并
  3. solo_default                未投放关键词此子分数缺失，CPS 直接取 competition_index_only
```

注意：第 3 档不再生成 normalized=30 的兜底数值，而是触发 solo 路径（详见 §2.3）。这避免了把未投放关键词错误标记为「中低出价水位」。

### 2.3 降级策略与 cpc_source 状态

每条 record 必须标记 `cpc_source`：

| cpc_source | 触发条件 | CPS 计算 |
| --- | --- | --- |
| `paid` | 投流域有 avg_cost_per_clk | 双子分数加权 `0.6 × CI + 0.4 × CPC_norm` |
| `fallback` | 投流域无该词，但走了 weighted_cost_per_clk 备份 | 双子分数加权（同上）+ `fallback_chain` 标 `weighted_cost_per_clk` |
| `missing` | 投流域完全无该词 | solo 路径：`CPS = competition_index_normalized`，`fallback_chain` 标 `solo_competition_index` |

未覆盖场景（双子分数全缺失，类目级也无数据）→ 不生成 record，`pull_status=skipped_no_signal`。

### 2.4 自洽规范（同 KDS）

每条 record 必须含：

```yaml
keyword: string
tertiary_category: string         # 用于追溯类目级聚合来源
cps: number                       # 0..100
cpc_source: paid | fallback | missing
subscores:
  competition_index: number       # 类目级广播值
  market_avg_bid: number          # 关键词级原生值；missing 时为 0 占位
formula: "CPS = 0.60 × competition_index_normalized + 0.40 × market_avg_bid_normalized"
provenance:
  competition_index_source: api_id      # 竞争域 api_id
  competition_index_aggregation: category_broadcast
  market_avg_bid_source: api_id         # 投流域 api_id 或 null
  market_avg_bid_aggregation: keyword_native | null
fallback_chain: [string]
```

---

## 3. 数据源选型（双源复合）

CPS 的两个子分数来自完全不同的接口域，需独立调研、独立 LIVE probe、独立映射节点：

### 3.1 主源 A：投流域（CPC 主源）

| 属性 | 值 |
| --- | --- |
| api_id | `data_cust_ads_ad_flow_plan_goods_keyword_7d` |
| name | 客户-付费投流-关键词 |
| path | `/data/cust/ads_ad_flow_plan_goods_keyword_7d` |
| method | GET |
| quality | 0.811 |
| lifecycle | agent_ready |
| 粒度 | 关键词 × 计划 × 商品（每条记录一个 plan_id × goods_id × kw_name 组合） |
| 覆盖范围 | 仅样本租户已投放的关键词 |
| 必填参数 | `user_id_list`（数组）；可选 `shop_id` / `goods_id` / `cate_name` / `plan_name` 等过滤 |

关键字段：

| field | desc | 用途 |
| --- | --- | --- |
| `kw_name` | 词名字 | 关键词主键（normalize 阶段 group by） |
| `avg_cost_per_clk` | 平均点击花费 | CPC 主源（元） |
| `cost` | 花费 | weighted_avg 的权重；备份链路用 |
| `clk_cnt` | 点击量 | weighted_avg 的权重 |
| `impres_cnt` | 展现量 | 校验信号（impres_cnt=0 的记录跳过聚合） |
| `kw_type` | 词类型 | 用于过滤词包（仅保留单词，跳过词包聚合行） |

### 3.2 主源 B：竞争域（competition_index / brand_concentration 主源）

| 属性 | 值 |
| --- | --- |
| api_id | `data_competition_pattern_analysis` |
| name | 竞争格局分析V2 |
| path | `/data/competition_pattern_analysis` |
| method | POST |
| quality | 0.838 |
| lifecycle | verified |
| 粒度 | 商品级（每条记录一个 commodity） |
| 覆盖范围 | 全行业商品（不依赖租户投放） |
| 必填参数 | `tertiary_category` / `business_date`（月度，YYYY-MM） |

关键字段：

| field | desc | 用途 |
| --- | --- | --- |
| `commodity` | 商品名称 | 行去重基准 |
| `shop` | 店铺名称 | distinct_shop_count 聚合源 |
| `brand_name` | 品牌名（V3）/ 从 commodity 提取（V2 缺失时） | top3_share 聚合源 |
| `display_price` | 展示价 | brand_concentration 加权（按销售/曝光不可得，退化为按展示价加权） |
| `search_rank` | 搜索排名 | 用于 top-N 截断（取 search_rank ≤ 100 的商品参与聚合） |
| `tertiary_category` | 三级类目 | group by 主键 |

### 3.3 备份源（Phase 3.5+ 启用，本期不接入）

竞争域备份（V2 字段不足时启用）：

| api_id | quality | 启用条件 |
| --- | --- | --- |
| `data_competition_pattern_analysis_v3` | 0.792 | V2 brand_name 缺失率 > 50% |
| `data_agent_competition_pattern_analysis_v3` | 0.768 | V2 + V3 都不可用时（智能体专用版） |

完整审计见 [registry/derived/competition_domain_audit.md](../registry/derived/competition_domain_audit.md)。

### 3.4 LIVE probe SOP（双源各跑一次）

8 个竞争域接口 + 投流域 P0 接口**全部未覆盖全量验证版**。本规范走 [docs/18_KEYWORD_FIELD_MAPPING_SPEC.md](18_KEYWORD_FIELD_MAPPING_SPEC.md) §5 的 CPS-only 降级 SOP，每个接口独立按以下 6 步合入：

```
1. 从 ApiAssetCard.request_schema 取参数列表 + 默认值
2. 投流域：从 .env 取 ZICHEN_USER_ID 拼 user_id_list；竞争域：传 tertiary_category=入户地垫 + business_date=2026-09
3. 直接 LIVE_PROBE 调用，观察返回（status / total / 字段实际命中率）
4. 若 status=ok && total>0 → 落 verified_call.real_url + real_body 到 cards
5. 若 status=empty / 422 / 500 → 调研真实租户参数，手工补 verified_call
6. mapping 节点先按 ApiAssetCard 写最小可调通参数集，单接口 LIVE probe 通过 + golden GREEN 后合入
```

### 3.5 不再使用的旧降级

废弃 Batch 1 草案中以下兜底（与本规范双源架构冲突）：

- ❌ 「`data_blue_keyword_30d_v2.is_ad_keyword` 推 ad_keyword_ratio 作为 market_avg_bid 第三档」
- ❌ 「竞争域接口直接含 `competition_index` 字段」（实际不存在）
- ❌ 「单接口同时提供 competition_index + avg_cpc」（实际是商品级 + 关键词级双源）

---

## 4. 字段映射规范

### 4.1 双节点示例（含 aggregation 块）

mapping 节点 schema 详见 [docs/18_KEYWORD_FIELD_MAPPING_SPEC.md](18_KEYWORD_FIELD_MAPPING_SPEC.md) §3，本期新增的 `aggregation` 块用于声明聚合规则与广播粒度：

```yaml
# registry/keyword_field_mapping.yaml（CPS 双源扩展段）
apis:
  data_cust_ads_ad_flow_plan_goods_keyword_7d:
    priority: 95
    method: GET
    path: /data/cust/ads_ad_flow_plan_goods_keyword_7d
    response_root: data
    keyword_field: kw_name
    request_template:
      query:
        userId: "{user_id}"
        tenantId: "{tenant_id}"
        user_id_list: "{user_id}"
        pageNum: "1"
        pageSize: "200"
    field_map:
      avg_cpc_cny: avg_cost_per_clk
      cpc_cost: cost
      cpc_clicks: clk_cnt
      cpc_impressions: impres_cnt
    aggregation:
      group_by: kw_name
      output_level: keyword
      keyword_field: kw_name
      filters:
        - field: impres_cnt
          op: gt
          value: 0
      derivations:
        avg_cpc_cny:
          formula: weighted_avg(avg_cost_per_clk, weight=clk_cnt)
        weighted_cost_per_clk:
          formula: ratio(sum(cost), sum(clk_cnt))
    score_domain_hint: competition
    notes: "投流域 CPC 主源；仅样本租户已投放关键词；user_id_list 必填"
    enabled: true

  data_competition_pattern_analysis:
    priority: 90
    method: POST
    path: /data/competition_pattern_analysis
    response_root: data.result[]
    keyword_field: null              # 商品级接口，无 keyword 字段
    request_template:
      tertiary_category: "{tertiary_category}"
      business_date: "{start_date}"
    field_map:
      shop: shop
      brand_name: brand_name
      display_price: display_price
      search_rank: search_rank
      tertiary_category: tertiary_category
    aggregation:
      group_by: tertiary_category
      output_level: category
      broadcast_to: keyword
      filters:
        - field: search_rank
          op: lte
          value: 100
      derivations:
        competition_index:
          formula: clip(log10(distinct_count(shop) + 1) * 25, 0, 100)
        brand_concentration:
          formula: top_n_share(brand_name, n=3, weighted_by=display_price)
          clip: [0, 1]
        distinct_shop_count:
          formula: distinct_count(shop)
    score_domain_hint: competition
    notes: "竞争域类目级聚合主源；商品级 raw → 类目级 metrics → 广播到关键词"
    enabled: true
    date_format: month
```

### 4.2 merge_order_priority

CPS 接口加入 merge_order 时排在 demand/trend 接口之后（priority 数值更小）：

```yaml
merge_order_priority:
  - agent_sycm_keyword                              # 100，demand 主源
  - data_blue_keyword_7d_v2                         # 90，demand
  - data_keyword_trend                              # 50，trend
  - data_cust_ads_ad_flow_plan_goods_keyword_7d     # 95，CPS CPC 主源（关键词级）
  - data_competition_pattern_analysis               # 90，CPS competition_index 主源（类目级）
```

注：`output_level=category` 的接口不参与 keyword 级合并冲突仲裁，merge_order 中位置仅用于 audit 追溯。

### 4.3 字段映射差量

CPS 与 demand/trend 不共享 `field_map` canonical 名（demand 用 `search_popularity / pay_rate`，CPS 用 `avg_cpc_cny / competition_index`）。`keyword_metric_record_keys.metrics` 全集需在 [docs/18 §2](18_KEYWORD_FIELD_MAPPING_SPEC.md) 增加 CPS 专属字段：

```yaml
keyword_metric_record_keys:
  metrics:
    - search_popularity
    # ... demand/trend 字段省略
    - avg_cpc_cny                  # CPS 关键词级
    - weighted_cost_per_clk        # CPS 关键词级备份
    - competition_index            # CPS 类目级广播
    - brand_concentration          # CPS 类目级广播
    - distinct_shop_count          # CPS 类目级辅助
```

---

## 5. 默认日期窗口

### 5.1 与 demand 对齐

CPS 默认日期窗口同 [12_KEYWORD_DEMAND_PACK_SPEC.md](12_KEYWORD_DEMAND_PACK_SPEC.md) §5：**上一完整自然月**。

理由：
- 月级数据稳定性高于周级
- 与 KOIF Router 默认窗口一致，避免 score_vector 跨期对齐问题
- 竞争格局变化慢，日级波动无业务意义

### 5.2 月度接口处理

若某 P0 接口的 `date_format` 是 `month`（API 强制月度参数），按 [docs/18_KEYWORD_FIELD_MAPPING_SPEC.md](18_KEYWORD_FIELD_MAPPING_SPEC.md) §3.4 自动截短 `{start_date}` / `{end_date}` 为 `YYYY-MM`。

---

## 6. strategy 体系

### 6.1 baseline_v1（Phase 3 实施）

- 公式：`CPS = 0.60 × competition_index + 0.40 × market_avg_bid_normalized`
- 子分数权重写在 `registry/cps_weights.yaml`，锁版到 `registry/cps_weights.baseline_v1.locked.yaml`
- 适用：所有类目通用基准线

### 6.2 weighted_v2_stub（Phase 3 占位）

- 设计意图：按类目特性动态调整权重（如「服饰类」`market_avg_bid` 权重提升至 0.55）
- Phase 3 仅提供占位（返回 baseline_v1 同结果 + warning `strategy_v2_not_implemented`）
- Phase 3.5+ 真正实施

### 6.3 strategy 注册

`registry/keyword_strategies.yaml` 增 `keyword_competition` 段：

```yaml
keyword_competition:
  default_strategy: cps_baseline_v1
  strategies:
    cps_baseline_v1:
      version: 1
      formula: "0.60 × competition_index + 0.40 × market_avg_bid"
      locked_weights_path: registry/cps_weights.baseline_v1.locked.yaml
    cps_weighted_v2_stub:
      version: 2
      stub: true
      replaces: cps_baseline_v1
      hint: "Phase 3.5+ 实施，按类目动态权重"
```

---

## 7. 8-stage pipeline 落点

完整 pipeline 对齐 [docs/11_ANALYSIS_PACK_FRAMEWORK_SPEC.md](11_ANALYSIS_PACK_FRAMEWORK_SPEC.md) §3。CPS 在 normalize 阶段引入「双源三阶段」改造（详见 §7.2）：

| Stage | 文件 | 职责 |
| --- | --- | --- |
| S1 resolve | `src/services/keyword_competition/resolve.ts` | 复用 demand 的 `resolveCategoryContext` + 新增 `resolveKeywordUniverse`（关键词清单来源） |
| S2 shape | `src/services/keyword_competition/shape.ts` | 标准化入参（top_n / strategy / date_range） |
| S3 live_pull | `src/services/keyword_competition/live_pull.ts` | 双源分流：投流域（关键词级）+ 竞争域（商品级） |
| S4 normalize | `src/services/keyword_competition/normalize.ts` | **三阶段聚合**（A. 商品→类目；B. 投流→关键词；C. 关键词记录构造与广播） |
| S5 classify | `src/services/keyword_competition/classify.ts` | 按 CPS bucket 分类（弱/中/强竞争） |
| S6 score | `src/services/keyword_competition/score.ts` + `strategies/baseline_v1.ts` | CPS 主公式，每条 record 含 subscores + formula + provenance + fallback_chain + cpc_source |
| S7 rank | `src/services/keyword_competition/rank.ts` | 按 CPS 降序，输出 top_overall 与 top_by_bucket |
| S8 report | `src/services/keyword_competition/report.ts` | 生成 cps_report.md（纯业务话术） |

### 7.2 normalize.ts 三阶段聚合

```
Stage A. 商品级 → 类目级聚合（来自竞争域，output_level=category）
  for api in apis where aggregation.output_level == "category":
    apply filters（如 search_rank ≤ 100）
    group raw rows by aggregation.group_by  (tertiary_category)
    apply derivations DSL → category_metrics[category] = { competition_index, brand_concentration, distinct_shop_count }

Stage B. 投流级 → 关键词级聚合（来自投流域，output_level=keyword）
  for api in apis where aggregation.output_level == "keyword":
    apply filters（如 impres_cnt > 0）
    group raw rows by aggregation.keyword_field  (kw_name)
    apply derivations DSL → keyword_metrics[keyword] = { avg_cpc_cny, weighted_cost_per_clk }

Stage C. 关键词记录构造与广播
  keyword_universe = resolveKeywordUniverse() (优先 demand pack 输出，退路投流域 kw_name 并集)
  for keyword in keyword_universe:
    record.keyword = keyword
    record.tertiary_category = ctx.tertiary_category
    record.competition_index = category_metrics[ctx.tertiary_category]?.competition_index   # 类目广播
    record.brand_concentration = category_metrics[ctx.tertiary_category]?.brand_concentration
    record.avg_cpc_cny = keyword_metrics[keyword]?.avg_cpc_cny
    record.cpc_source = keyword_metrics[keyword] ? "paid" : "missing"
```

辅助文件：

- `types.ts` — `CompetitionMetricRecord / CategoryLevelMetrics / CpsScoreRecord / CpsRunMeta`
- `trace.ts` — 链路追踪（参数 → API → 聚合阶段 → 字段 → 公式 → 分数）
- `eval.ts` — precision@k 评测套用 demand 模式
- `index.ts` — 主入口，导出 `analyzeKeywordCompetition()`
- `strategies/baseline_v1.ts` + `strategies/weighted_v2_stub.ts`

### 7.3 RunEnvelope 产物

```
registry/derived/keyword_analysis_pack/keyword_competition/<run_id>/
  run.meta.json
  cps_scores.json                   # 完整 record 列表 + subscores + provenance + cpc_source
  cps_top.json                      # top_overall + top_by_bucket
  cps_category_metrics.json         # Stage A 输出（类目级聚合追溯）
  cps_keyword_cpc.json              # Stage B 输出（关键词级 CPC 聚合追溯）
  cps_report.md                     # 业务报告
  pull_report.json                  # 各接口 pull 状态
  trace.json                        # 链路追踪
```

---

## 8. golden case 与评测口径

### 8.1 fixture 模式 baseline

`tests/golden_cases/keyword_competition_cases.yaml`：

```yaml
test_id: keyword_competition_baseline
description: CPS capability 在 fixture 模式下双源聚合产出自洽 record
input:
  tool: analyze_keyword_competition
  args:
    entity: 入户地垫
    live: false
    date_range:
      start_date: "2026-09-01"
      end_date: "2026-09-30"
expected:
  kind: keyword_competition_run
  records:
    min_count: 10
    each_record_must_have:
      - keyword
      - tertiary_category
      - cps
      - cpc_source                         # paid | fallback | missing
      - subscores.competition_index
      - subscores.market_avg_bid
      - formula
      - provenance.competition_index_source
      - provenance.competition_index_aggregation   # category_broadcast
      - fallback_chain
  cpc_source_distribution:
    paid: { min: 5 }
    missing: { min: 3 }
  category_broadcast_consistency:
    description: 同 tertiary_category 下所有 record 的 competition_index 完全相同
  cps_range: [0, 100]
  formula_pattern: "0.60 × competition_index_normalized + 0.40 × market_avg_bid_normalized"
```

### 8.2 fallback_chain 自洽 case

```yaml
test_id: keyword_competition_fallback_solo_competition_index
description: 关键词未投放（cpc_source=missing）时，CPS 等于 competition_index_normalized
input:
  fixture_override:
    paid_keyword_universe: []          # 投流域 raw 全空
expected:
  records[0].cpc_source: missing
  records[0].fallback_chain_includes: solo_competition_index
  records[0].cps_equals: subscores.competition_index
```

### 8.3 评测口径

precision@k 套用 demand 模式（[docs/12_KEYWORD_DEMAND_PACK_SPEC.md](12_KEYWORD_DEMAND_PACK_SPEC.md) §10）：

- 维护 `tests/golden_cases/keyword_competition_eval_seed.json`：人工标注 100 个「入户地垫」品类下的关键词 CPS bucket（弱/中/强）
- precision@10 / precision@20 / precision@50 阈值：
  - baseline_v1 ≥ 0.55（双源 + 类目广播架构下，关键词差异主要来自 CPC，阈值较低）
  - weighted_v2 解锁后 ≥ 0.65

### 8.4 真机 LIVE 验证

```bash
LIVE_PROBE=true PI_CODING_AGENT_DIR="$(pwd)/.pi-home/agent" \
  pi --model aicodemirror/gpt-5.5

> 用 LIVE_PROBE=true 帮我看下"入户地垫"的关键词竞争压力
```

通过线：
- `cps_records.length >= 20`
- 投流域接口 `pull_status=ok` 且至少 5 条 record `cpc_source=paid`
- 竞争域接口 `pull_status=ok` 且 `cps_category_metrics.distinct_shop_count >= 5`
- `cps_records[0]` 完整含 `cps + subscores + formula + provenance + fallback_chain + cpc_source`
- `cps_report.md` 纯业务话术，零工程术语

---

## 9. 报告语义规范

### 9.1 cps_report.md 结构

```markdown
# <实体名> 关键词竞争压力分析

> 数据时间：<date_range>
> 分析样本：<record_count> 个关键词

## 一、整体竞争格局

<实体> 当前竞争压力评分：<CPS 均值>。
- 弱竞争词数量：<count>（CPS < 30）
- 中等竞争词数量：<count>（30 ≤ CPS < 60）
- 强竞争词数量：<count>（CPS ≥ 60）

整体判断：<弱竞争 / 中等竞争 / 红海博弈>

## 二、竞争压力 TOP 10（最激烈）

| 排名 | 关键词 | 竞争压力 | 竞争指数 | 平均出价 |
| --- | --- | --- | --- | --- |
| ... | ... | ... | ... | ... |

## 三、蓝海机会词 TOP 10（弱竞争）

<列出 CPS < 30 且记录可信度高的词>

## 四、数据来源

- 竞争数据：来自 <api_id>
- 数据日期：<date_range>
- 样本租户：<tenant>

## 五、注意事项

- 数据稀疏说明（如 `market_avg_bid` 字段在样本里有 X% 缺失）
- 与 demand/trend 联用建议
```

### 9.2 中性化原则

cps_report.md 不出现：
- 「日预算」「ROI」「出价 X 元」「CPC 出价区间」
- 「该词建议投放/暂停投放」
- 「投入产出比」

仅描述客观事实：「竞争压力中等偏低」「头部品牌集中度 X%」「样本平均出价 Y 元」。

决策类话术由 sibling namespace `koif_decision_layer` 生成（详见 [docs/19_KOIF_DECISION_LAYER_SPEC.md](19_KOIF_DECISION_LAYER_SPEC.md)）。

---

## 10. Phase 3 实施清单

### 10.1 服务层

- `src/services/keyword_competition/` 8 个文件 + `strategies/` 2 个文件
- `src/tools/analyze_keyword_competition.ts`
- `.pi/extensions/db_archaeologist.extension.ts` 注册第 17 个工具
- `.pi/skills/keyword-competition/SKILL.md`

### 10.2 配置

- `registry/cps_weights.yaml`（fallback codes 切到 `distinct_shop_count_log` / `avg_cost_per_clk` 双源版）
- `registry/cps_weights.baseline_v1.locked.yaml`
- `registry/keyword_strategies.yaml` 增 `keyword_competition` 段
- `registry/keyword_field_mapping.yaml` 增双源 P0 节点：
  - `data_cust_ads_ad_flow_plan_goods_keyword_7d`（投流域，CPC 主源，priority 95）
  - `data_competition_pattern_analysis`（竞争域，类目聚合主源，priority 90）

### 10.3 测试

- `tests/golden_cases/keyword_competition_cases.yaml`（含双源断言：`cpc_source` 分布 + 同类目广播一致性）
- `tests/golden.test.ts` 加 keyword_competition 块
- `tests/golden_cases/keyword_competition_eval_seed.json`（precision@k 标注种子）
- `tests/invariants/`：`mapping_schema_lint`（含 aggregation 块校验） + `pull_status_exhaustiveness`

### 10.4 文档同步

- 本文档（docs/20）
- [docs/14_KOIF_NAMESPACE_OVERVIEW.md](14_KOIF_NAMESPACE_OVERVIEW.md) §2 全景表 CPS 行：数据源列改「投流域 (CPC) + 竞争域 (类目聚合)」
- [docs/15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md) §3.5 / §5 / §10.1 已升级
- [docs/18_KEYWORD_FIELD_MAPPING_SPEC.md](18_KEYWORD_FIELD_MAPPING_SPEC.md) §3 增 `aggregation` 块（`output_level`/`derivations` DSL）+ §7 加类目聚合纪律
- [AGENTS.md](../AGENTS.md) §1.1 KOIF 评分能力描述追加「CPS 双源（投流域 CPC + 竞争域类目广播）」

---

## 11. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 投流域接口需要 `user_id_list` 且仅样本租户可见已投放词 | 凭据走 `.env` ZICHEN_*；未投放关键词标 `cpc_source=missing` 触发 `solo_competition_index`，不阻塞主流程 |
| 竞争域接口商品级返回，无关键词级竞争指数 | 走 §2.1.1 类目聚合 + §7.2 Stage A 广播；同类目下 `competition_index` 一致是已知现象，区分度由 CPC 提供 |
| 类目级广播导致同类目 record 区分度低 | 1) 与 KDS / TMS 联用提升排序信号；2) `cps_report.md` 显式提示「同类目竞争评分一致，差异来自 CPC」 |
| 竞争域接口商品 brand_name 字段稀疏 | `brand_concentration` 仅作 `competition_index` fallback，主路径用 `distinct_shop_count_log` |
| 投流域 / 竞争域均无 verified_call 全量样本 | 走 §3.4 双源 LIVE probe SOP，各跑一次回写 verified_call 后再合入 mapping |
| 关键词清单依赖 demand pack | `resolveKeywordUniverse` 退路：投流域 `kw_name` 并集独立运行，不要求 demand 同 run 上下文 |
| 月度聚合自洽 | 复用 demand 的 `preAggregateMonthlyApis`（详见 docs/18 §7） |

---

## 12. 不在本规范范围

- CPS 决策类输出（预算/出价/ROI）：走 [docs/19_KOIF_DECISION_LAYER_SPEC.md](19_KOIF_DECISION_LAYER_SPEC.md)
- weighted_v2 实质化：Phase 3.5+
- 跨类目竞争对比：Phase 6+
- 时序竞争追踪（CPS 月度趋势）：Phase 4+
- LLM 精排报告：Phase 4+
- 真实凭据 vault：仍走 `.env` + `ZICHEN_*`

---

## 13. 相关文档

- [AGENTS.md](../AGENTS.md) §1：项目定位与边界条款
- [docs/11_ANALYSIS_PACK_FRAMEWORK_SPEC.md](11_ANALYSIS_PACK_FRAMEWORK_SPEC.md)：分析包框架
- [docs/12_KEYWORD_DEMAND_PACK_SPEC.md](12_KEYWORD_DEMAND_PACK_SPEC.md)：demand pack 规范（结构对照）
- [docs/13_TREND_DEMAND_PACK_SPEC.md](13_TREND_DEMAND_PACK_SPEC.md)：trend pack 规范
- [docs/14_KOIF_NAMESPACE_OVERVIEW.md](14_KOIF_NAMESPACE_OVERVIEW.md)：KOIF 全景
- [docs/15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md)：Router 契约
- [docs/18_KEYWORD_FIELD_MAPPING_SPEC.md](18_KEYWORD_FIELD_MAPPING_SPEC.md)：mapping 规范
- [docs/19_KOIF_DECISION_LAYER_SPEC.md](19_KOIF_DECISION_LAYER_SPEC.md)：决策层规范
- [registry/derived/competition_domain_audit.md](../registry/derived/competition_domain_audit.md)：竞争域接口审计报告