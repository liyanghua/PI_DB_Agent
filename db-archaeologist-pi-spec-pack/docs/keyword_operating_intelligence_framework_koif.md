# KOIF：关键词通用经营分析框架

> 版本：v1.0  
> 适用场景：老品优化、开新品、内容种草、付费投流、类目商机洞察、关键词经营诊断  
> 前置条件：KDS（Keyword Demand Strength，关键词需求强度）已实现  
> 本文重点：在 KDS 之上，补齐趋势强度、付费价值、内容潜力、商品承接、新品机会、策略路由与输出规范。

---

## 0. 背景与定位

关键词不是简单的流量词，而是经营动作的入口。

在电商经营中，同一个关键词可能同时承担多种角色：

```text
需求信号：用户在搜什么
趋势信号：什么需求正在变强
付费信号：哪些词值得花钱买流量
内容信号：哪些词适合做种草
承接信号：我方商品是否能接住这个需求
新品信号：是否值得开发新品或新 SKU
```

因此，单一 KDS 分数只能回答：

```text
这个词是不是强需求词？
```

但不能完整回答：

```text
这个词适合做老品优化吗？
这个词适合开新品吗？
这个词适合内容种草吗？
这个词适合付费放量吗？
这个词是趋势机会还是成熟需求？
这个词是页面承接问题还是供给不足问题？
```

所以需要在 KDS 之上建立一个通用关键词经营分析框架：

> **KOIF：Keyword Operating Intelligence Framework / 关键词经营洞察框架**

---

## 1. 总体设计原则

### 1.1 KDS 不废弃，但不做大杂烩

KDS 已经作为关键词需求强度底座，不应继续塞入所有维度。

正确做法是：

```text
KDS 负责判断需求强度；
TMS 负责判断趋势强度；
PVS 负责判断付费价值；
CES 负责判断内容潜力；
PFS 负责判断商品承接；
NOS 负责判断新品机会；
KOIF 负责综合路由到经营策略。
```

---

### 1.2 多分数向量，而不是一个总分

每个关键词最终应输出一个经营评分向量：

```json
{
  "keyword": "可裁剪不卡门玄关地垫",
  "keyword_types": ["scene", "spec", "category"],
  "scores": {
    "kds": 83,
    "tms": 78,
    "pvs": 62,
    "ces": 70,
    "pfs": 55,
    "nos": 76
  },
  "strategy_routes": [
    "old_product_optimization",
    "content_seeding",
    "paid_test"
  ]
}
```

不要用一个总分直接决定所有经营动作。

---

### 1.3 关键词分析的最终目标

关键词分析最终要服务四类经营决策：

```text
1. 老品优化：标题、主图、详情页、SKU、价格、评价、链接承接
2. 开新品：新品方向、SKU 结构、价格带、首批测试词
3. 内容种草：内容选题、脚本、场景、卖点证明、评论引导
4. 付费投流：加词、降词、否词、出价、预算、页面承接修复
```

---

## 2. 数据基础

### 2.1 可用接口能力概览

全量验证版接口文档显示：

```text
总计：159 个接口
可调用成功合计：132 个
关键词分析：36 个接口
商品运营分析：35 个接口
市场竞争分析：19 个接口
付费投放分析：9 个接口
商品视觉洞察：6 个接口
类目经营分析：10 个接口
```

这些接口已经足够支撑 KOIF v1：

```text
关键词 / 词根 / 趋势
付费投流
类目销售与价格带
竞品与竞争格局
商品运营与流量转化
主图 / 详情页 / 视觉卖点
评价 / 问大家 / 差评
社媒洞察
```

---

### 2.2 核心数据域

| 数据域 | 主要能力 | 支撑分数 |
|---|---|---|
| 关键词域 | 搜索词、蓝海词、词根、关键词趋势、关键词元素 | KDS / TMS |
| 付费域 | 直通车、小万关键词、推广付费、付费关键词、搜索拉升 | PVS |
| 内容域 | 社媒人群、场景、需求、评论、互动 | CES |
| 商品域 | 商品诊断、商品基础、流量、转化、SKU、趋势 | PFS |
| 竞争域 | 竞争格局、价格带竞品、Top 商品、竞品 SKU、竞品卖点 | PFS / NOS / CompetitionGap |
| 类目域 | 类目销售指标、类目增长、价格带、热销商品 | TMS / NOS |

---

## 3. KOIF 总链路

```text
关键词输入
→ 关键词清洗
→ 关键词分类
→ 词根 / 元素拆解
→ KDS 需求强度
→ TMS 趋势强度
→ PVS 付费价值
→ CES 内容种草潜力
→ PFS 商品承接分
→ NOS 新品机会分
→ 策略路由
→ 经营建议输出
```

工程链路：

```text
fetch_keyword_data()
→ normalize_keyword_metrics()
→ classify_keyword_types()
→ enrich_keyword_elements()
→ merge_kds_scores()
→ compute_tms()
→ compute_pvs()
→ compute_ces()
→ compute_pfs()
→ compute_nos()
→ route_keyword_strategy()
→ generate_keyword_insight_report()
```

---

## 4. 评分模块总览

| 分数 | 全称 | 解决的问题 | 主要服务场景 |
|---|---|---|---|
| KDS | Keyword Demand Strength | 这个词是不是强需求？ | 所有场景底座 |
| TMS | Trend Momentum Score | 这个词是不是趋势？ | 开新品、内容、付费测试 |
| PVS | Paid Value Score | 这个词是否值得花钱？ | 付费投流 |
| CES | Content Expansion Score | 这个词是否适合种草？ | 内容种草 |
| PFS | Product Fit Score | 我方商品是否能承接？ | 老品优化 |
| NOS | New Opportunity Score | 是否值得开新品？ | 新品规划 |
| BDS | Blue Ocean Demand Score | 是否是蓝海需求？ | 新品、投放、选品 |
| CPS | Competition Pressure Score | 竞争压力多大？ | 付费、开新品、老品对标 |

---

## 5. TMS：趋势强度分

### 5.1 定义

TMS 用于回答：

```text
这个关键词 / 词根 / 需求簇是不是正在变强？
这个变化是否具有持续性？
是否值得现在关注？
```

趋势不是简单环比，而是包含：

```text
方向：是不是涨
速度：涨得快不快
持续性：是不是连续涨
加速度：是不是越来越快
结构变化：是否出现新词根 / 新场景 / 新功能
商业确认：支付、商品、价格带是否同步变化
```

---

### 5.2 公式

```text
TMS =
0.20 × SearchGrowth
+ 0.15 × PayGrowth
+ 0.15 × DemandSupplyGrowth
+ 0.15 × Persistence
+ 0.15 × Acceleration
+ 0.10 × KeywordElementChange
+ 0.10 × ShelfConfirmation
```

---

### 5.3 子分数定义

#### SearchGrowth

```text
SearchGrowth =
0.50 × PctRank(search_popularity_mom)
+ 0.30 × PctRank(search_popularity_yoy)
+ 0.20 × PctRank(search_growth_rate)
```

适用字段：

```text
search_popularity_mom
search_popularity_yoy
search_growth_rate
search_value_trend
search_popularity_tread
```

---

#### PayGrowth

```text
PayGrowth =
0.50 × PctRank(pay_buyers_mom)
+ 0.30 × PctRank(pay_buyers_yoy)
+ 0.20 × PctRank(pay_rate_mom)
```

如果没有支付增长字段：

```text
PayGrowth = neutral_score = 50
```

---

#### DemandSupplyGrowth

```text
DemandSupplyGrowth =
0.60 × PctRank(demand_supply_ratio_mom)
+ 0.40 × PctRank(demand_supply_ratio)
```

解释：

```text
供需比高：需求大于供给；
供需比继续上升：缺口正在扩大。
```

---

#### Persistence

```text
Persistence =
连续上涨周期数 / 观察周期数 × 100
```

示例：

```text
近 7 天有 5 天上涨
Persistence = 5 / 7 × 100 = 71
```

---

#### Acceleration

```text
Acceleration =
current_growth_rate - previous_growth_rate
```

如果最近 7 天增速高于过去 30 天均值，说明趋势加速。

---

#### KeywordElementChange

来自关键词元素分析，用于判断是否出现结构性变化：

```text
新场景词
新功能词
新规格词
新风格词
新价格词
新平台词
需求结构变化
阶段性机会判断
```

关键词元素分析接口的 `summary` 和 `suggestion` 更适合作为趋势解释层，而不是简单数值字段。建议将其解析为：

```json
{
  "new_scene_terms": [],
  "new_function_terms": [],
  "new_spec_terms": [],
  "trend_reason": "",
  "opportunity_judgment": "",
  "application_suggestion": ""
}
```

---

#### ShelfConfirmation

```text
ShelfConfirmation =
0.40 × PctRank(top_goods_sales_growth)
+ 0.30 × PctRank(rank_improvement)
+ 0.20 × PctRank(price_band_growth)
+ 0.10 × PctRank(competitor_new_selling_points)
```

用途：

```text
避免“只有搜索涨，但货架无成交确认”的伪趋势。
```

---

### 5.4 TMS 分层

| TMS | 判断 | 策略 |
|---:|---|---|
| 85-100 | 爆发趋势 | 快速小样、内容跟进、付费测试 |
| 70-85 | 明确上升 | 进入机会池 |
| 55-70 | 有苗头 | 观察 + 补证 |
| 40-55 | 平稳 | 老品优化，不作为新品趋势 |
| <40 | 下降 / 噪音 | 不做趋势机会 |

---

### 5.5 TMS 输出

```json
{
  "keyword": "可裁剪玄关地垫",
  "tms": 78,
  "trend_type": "rising",
  "trend_drivers": [
    "search_growth",
    "demand_supply_expansion",
    "keyword_element_change"
  ],
  "trend_evidence": {
    "search_growth": 82,
    "persistence": 71,
    "shelf_confirmation": 66
  },
  "suggested_use": [
    "content_test",
    "paid_test",
    "new_product_watchlist"
  ]
}
```

---

## 6. PVS：付费价值分

### 6.1 定义

PVS 用于回答：

```text
这个关键词是否值得花钱？
应该加预算、降出价、否词、精准匹配，还是先修页面？
```

付费不是 KDS 的子项，而是独立经营决策域。

---

### 6.2 公式

```text
PVS =
0.25 × PaidTrafficQuality
+ 0.25 × PaidConversionQuality
+ 0.20 × CostEfficiency
+ 0.15 × CompetitionPressureAdjustment
+ 0.15 × SearchLiftPotential
```

---

### 6.3 子分数定义

#### PaidTrafficQuality

```text
PaidTrafficQuality =
0.50 × PctRank(ctr)
+ 0.50 × PctRank(clicks or search_index)
```

可用字段：

```text
ctr
click_rate
clicks
search_index
clk_rate_7d
```

---

#### PaidConversionQuality

```text
PaidConversionQuality =
0.40 × PctRank(click_conversion_rate)
+ 0.25 × PctRank(add_cart_rate)
+ 0.20 × PctRank(input_output_ratio)
+ 0.15 × PctRank(gmv)
```

可用字段：

```text
click_conversion_rate
pay_trans_rate_7d
add_cart_rate
adcrt_rate_7d
input_output_ratio
roi_7d
gmv_7d
```

---

#### CostEfficiency

成本指标越低越好，因此使用 inverse percentile。

```text
CostEfficiency =
0.40 × inverse_pct(avg_click_cost)
+ 0.30 × inverse_pct(add_cart_cost)
+ 0.30 × inverse_pct(total_order_cost)
```

可用字段：

```text
market_average_bid
avg_click_cost
cost
cost_7d
add_cart_cost
total_order_cost
```

---

#### CompetitionPressureAdjustment

竞争强度不是越高越好。它用于判断：

```text
是否值得抢？
是否需要降价避开？
是否转向长尾词？
```

建议：

```text
CompetitionPressure =
0.60 × PctRank(competition_index)
+ 0.40 × PctRank(market_average_bid)
```

再转成调整项：

```text
CompetitionPressureAdjustment =
100 - CompetitionPressure
```

如果是品牌战略必须抢的核心词，可手动将该项从惩罚改为战略投入。

---

#### SearchLiftPotential

用于评估付费是否能拉动自然搜索。

```text
SearchLiftPotential =
0.40 × PctRank(search_visitors_lift)
+ 0.30 × PctRank(search_rank_improvement)
+ 0.30 × PctRank(natural_search_pay_growth)
```

如果没有搜索拉升数据：

```text
SearchLiftPotential = 50
```

---

### 6.4 付费关键词策略矩阵

横轴：KDS  
纵轴：PVS

|  | PVS 高 | PVS 低 |
|---|---|---|
| KDS 高 | 核心放量词 | 承接修复词 |
| KDS 低 | 小众精准词 | 停投 / 否词 |

叠加 TMS：

```text
TMS 高：允许小预算趋势测试
TMS 低：不追趋势，只看 ROI
```

---

### 6.5 付费动作规则

#### 核心放量词

条件：

```text
KDS >= 75
PVS >= 70
ROI / input_output_ratio 达标
click_conversion_rate 达标
```

动作：

```text
加预算
保排名
扩匹配
扩相似词
监控 CPC 上升
```

---

#### 承接修复词

条件：

```text
KDS >= 75
PVS < 60
CTR 高但 conversion 低
PFS 低
```

动作：

```text
不先加预算
先查主图、详情、价格、评价
改完页面再投
```

---

#### 小众精准词

条件：

```text
KDS < 70
PVS >= 70
pay_rate / conversion_rate 高
cost 可控
```

动作：

```text
小预算保留
精准匹配
作为标题长尾词
不放大为新品机会
```

---

#### 趋势测试词

条件：

```text
TMS >= 75
KDS 中等
PVS 未验证
```

动作：

```text
小预算测试
设置 3-7 天窗口
只测点击、收藏、加购、咨询
不直接规模化
```

---

#### 浪费词

条件：

```text
cost 高
click_conversion_rate 低
add_cart_rate 低
input_output_ratio 低
```

动作：

```text
降出价
缩匹配
否词
暂停
```

---

### 6.6 PVS 输出

```json
{
  "keyword": "防滑吸水地垫",
  "pvs": 74,
  "paid_strategy": "scale",
  "reason": "KDS 高、点击质量高、转化质量达标、成本可控",
  "actions": [
    "提高预算",
    "扩展相似词",
    "监控 CPC",
    "保持主图证明一致"
  ],
  "guardrails": [
    "roi_7d 不低于目标",
    "avg_click_cost 上升超过 20% 时暂停扩量"
  ]
}
```

---

## 7. CES：内容种草潜力分

### 7.1 定义

CES 用于回答：

```text
这个关键词是否适合做内容？
是否有场景感、情绪冲突、视觉表达和评论互动潜力？
```

---

### 7.2 公式

```text
CES =
0.25 × SceneClarity
+ 0.20 × EmotionIntensity
+ 0.20 × Visualizability
+ 0.20 × SocialHeat
+ 0.15 × PurchaseBridgePotential
```

---

### 7.3 子分数定义

#### SceneClarity

```text
SceneClarity =
是否明确包含场景词、人群词、时间/季节词
```

高分词：

```text
新家玄关
雨天进门
宠物家庭
厨房防油
卧室遮光
```

---

#### EmotionIntensity

```text
EmotionIntensity =
痛点词 / 情绪词 / 反差词 / 冲突词密度
```

示例：

```text
怕滑
难清洗
显脏
高级感
治愈
翻车
后悔没早买
```

---

#### Visualizability

```text
Visualizability =
是否容易拍成画面
```

高分关键词：

```text
湿鞋踩地垫
门缝不卡
可裁剪
玄关第一眼
奶油风改造
```

低分关键词：

```text
泛品类词
抽象材质词
纯品牌词
```

---

#### SocialHeat

来自内容平台：

```text
likes
saves
comments
shares
avg_fans
tfidf
社媒需求标签
```

如果没有社媒数据：

```text
SocialHeat = 50
```

---

#### PurchaseBridgePotential

```text
PurchaseBridgePotential =
是否能自然引导到商品卡、链接、尺寸表、购买入口
```

高分：

```text
问链接
问尺寸
问价格
问哪里买
问同款
```

注意：

```text
问链接只证明购买入口阻塞，不证明功能需求。
```

---

### 7.4 内容关键词分层

| CES | 判断 | 策略 |
|---:|---|---|
| 85-100 | 强内容词 | 重点内容选题 |
| 70-85 | 可种草词 | 内容脚本测试 |
| 55-70 | 补证词 | 观察评论 / 小样内容 |
| <55 | 弱内容词 | 不优先做内容 |

---

### 7.5 CES 输出

```json
{
  "keyword": "雨天进门防滑地垫",
  "ces": 82,
  "content_strategy": "seed_and_test",
  "content_angle": "雨天湿鞋进门，玄关不脏不滑",
  "script_hint": {
    "hook": "下雨天一进门，鞋底泥水最容易毁掉玄关。",
    "proof_shots": ["湿鞋踩踏", "防滑底推拉", "刮泥效果"],
    "purchase_bridge": "尺寸和链接放评论区"
  }
}
```

---

## 8. PFS：商品承接分

### 8.1 定义

PFS 用于回答：

```text
我方商品是否能承接这个关键词？
如果不能，是标题、主图、详情、SKU、价格、评价还是流量承接问题？
```

PFS 是老品优化的核心。

---

### 8.2 公式

```text
PFS =
0.25 × TitleCoverage
+ 0.25 × MainImageProofCoverage
+ 0.20 × DetailProofCoverage
+ 0.15 × SkuCoverage
+ 0.15 × ConversionBaseline
```

---

### 8.3 子分数定义

#### TitleCoverage

```text
TitleCoverage =
coverage(own_title_terms, keyword_terms)
```

例如：

```text
关键词：可裁剪不卡门玄关地垫
自有标题：入户门地垫进门地毯轻奢玄关脚垫
缺失：可裁剪、不卡门
TitleCoverage 低
```

---

#### MainImageProofCoverage

```text
MainImageProofCoverage =
coverage(own_main_image_sell_points, keyword_demand_points)
```

判断：

```text
主图是否证明防滑
是否证明吸水
是否证明不卡门
是否证明可裁剪
是否展示真实场景
```

---

#### DetailProofCoverage

```text
DetailProofCoverage =
coverage(detail_first_3_screens, keyword_demand_points)
```

重点看详情页前 3 屏：

```text
第 1 屏是否确认场景
第 2 屏是否证明功能
第 3 屏是否解决规格/尺寸/价格顾虑
```

---

#### SkuCoverage

```text
SkuCoverage =
coverage(own_sku_attributes, keyword_spec_points)
```

判断：

```text
尺寸是否齐全
颜色是否齐全
材质是否匹配
是否有套装
是否有可裁剪款
是否有低门缝款
```

---

#### ConversionBaseline

```text
ConversionBaseline =
0.25 × PctRank(main_click)
+ 0.20 × PctRank(add_percent)
+ 0.20 × PctRank(actual_conversion)
+ 0.15 × PctRank(search_pay_percent)
+ 0.10 × PctRank(goods_like_num_percent)
+ 0.10 × PctRank(avg_stay_time)
```

---

### 8.4 PFS 分层

| PFS | 判断 | 策略 |
|---:|---|---|
| 85-100 | 承接强 | 可放大 |
| 70-85 | 承接较好 | 小优化后放大 |
| 55-70 | 承接不足 | 进入老品优化 |
| 40-55 | 承接弱 | 先修页面 / SKU / 素材 |
| <40 | 无法承接 | 不投放，不动作，先补供给 |

---

### 8.5 PFS 输出

```json
{
  "keyword": "可裁剪不卡门玄关地垫",
  "pfs": 52,
  "fit_judgment": "承接不足",
  "gap_cards": [
    {
      "gap_type": "title_gap",
      "gap": "标题未覆盖可裁剪、不卡门"
    },
    {
      "gap_type": "visual_gap",
      "gap": "主图没有门缝开合证明"
    }
  ],
  "recommended_actions": [
    "标题补充可裁剪/不卡门",
    "补拍门缝开合主图",
    "详情页增加尺寸选择表"
  ]
}
```

---

## 9. NOS：新品机会分

### 9.1 定义

NOS 用于回答：

```text
这个关键词 / 需求簇是否值得开新品或新增 SKU？
```

新品机会不能只看 KDS，也不能只看趋势。

---

### 9.2 公式

```text
NOS =
0.25 × KDS
+ 0.25 × TMS
+ 0.20 × DemandSupplyGap
+ 0.15 × CompetitionWhiteSpace
+ 0.15 × SupplyFeasibility
```

---

### 9.3 子分数定义

#### DemandSupplyGap

```text
DemandSupplyGap =
0.60 × PctRank(demand_supply_ratio)
+ 0.40 × PctRank(demand_supply_ratio_mom)
```

---

#### CompetitionWhiteSpace

```text
CompetitionWhiteSpace =
100 - competitor_coverage_score
```

竞品覆盖度越低，白空间越高。

但要注意：

```text
竞品少可能是机会，也可能是需求不成立。
必须结合 KDS 和 TMS 判断。
```

---

#### SupplyFeasibility

```text
SupplyFeasibility =
0.30 × material_feasible
+ 0.25 × production_feasible
+ 0.20 × cost_margin_feasible
+ 0.15 × inventory_feasible
+ 0.10 × asset_feasible
```

如果没有供应链数据，先用人工输入：

```json
{
  "material_feasible": 80,
  "production_feasible": 70,
  "cost_margin_feasible": 60,
  "inventory_feasible": 50,
  "asset_feasible": 60
}
```

---

### 9.4 新品机会门禁

```text
只有趋势强，不开新品。
只有内容热，不开新品。
只有竞品卖得好，不开新品。
KDS + TMS + 供需缺口 + 价格带空间 + 供应链可做，才进入新品候选。
```

---

### 9.5 NOS 分层

| NOS | 判断 | 策略 |
|---:|---|---|
| 85-100 | 强新品机会 | 立项评审 |
| 70-85 | 候选新品机会 | 小样验证 |
| 55-70 | 观察机会 | 补证 / 测款 |
| <55 | 不建议开新品 | 不立项 |

---

## 10. BDS：蓝海需求分

### 10.1 定义

BDS 用于回答：

```text
这个关键词是否存在需求大于供给的蓝海空间？
```

---

### 10.2 公式

```text
BDS =
0.40 × DemandSupplyRatioScore
+ 0.25 × PayBuyerScore
+ 0.20 × SearchGrowthScore
+ 0.15 × CompetitionLowPressureScore
```

---

### 10.3 使用方式

蓝海分不直接决定动作，只用于提示：

```text
开新品候选
长尾词投放
标题补词
内容选题
价格带机会
```

---

## 11. CPS：竞争压力分

### 11.1 定义

CPS 用于回答：

```text
这个关键词或需求簇的竞争强度有多高？
```

---

### 11.2 公式

```text
CPS =
0.25 × PaidCompetitionIndex
+ 0.25 × MarketAverageBid
+ 0.20 × CompetitorSalesConcentration
+ 0.15 × TopGoodsDominance
+ 0.15 × BrandDominance
```

---

### 11.3 使用方式

```text
CPS 高 + KDS 高：强需求但竞争重，需要差异化或长尾切入
CPS 低 + KDS 高：优先机会
CPS 高 + PVS 低：谨慎付费，避免烧钱
CPS 低 + TMS 高：趋势早期机会
```

---

## 12. 策略路由：从关键词分数到经营动作

### 12.1 路由总表

| 经营场景 | 主要分数 | 触发条件 | 输出 |
|---|---|---|---|
| 老品优化 | KDS + PFS + CPS | KDS 高，PFS 低 | 标题/主图/详情/SKU/评价优化 |
| 开新品 | KDS + TMS + BDS + NOS | KDS 高，TMS 高，供需缺口高 | 新品方向、SKU、价格带、测试词 |
| 内容种草 | CES + TMS + KDS | CES 高，场景/情绪明确 | 内容选题、脚本、证明镜头 |
| 付费投流 | KDS + PVS + PFS + TMS | PVS 高或趋势测试 | 加词、降词、否词、预算调整 |
| 价格带机会 | KDS + BDS + PriceGap | 需求强，价格带空位 | 价格测试、套装、券后价 |
| 竞品截流 | KDS + CPS + PVS | 品牌/竞品词，付费有效 | 竞品词投放、对标页面 |

---

### 12.2 老品优化路由

#### 判断

```text
KDS 高 + PFS 低 = 老品承接 GAP
```

#### 子判断

```text
TitleCoverage 低 → 标题优化
MainImageProofCoverage 低 → 主图证明链
DetailProofCoverage 低 → 详情页前 3 屏重排
SkuCoverage 低 → SKU / 尺寸表 / 规格补充
ConversionBaseline 低 → 价格 / 评价 / 流量承接诊断
```

#### 输出动作

```text
标题加什么词
标题弱化什么词
主图证明什么
详情页前 3 屏怎么排
SKU 是否补
是否做链接分流
```

---

### 12.3 开新品路由

#### 判断

```text
KDS 高 + TMS 高 + BDS 高 + NOS 高 = 新品候选
```

#### 门禁

```text
SupplyFeasibility < 60：不能进入新品立项，只能进入供应链补证
CPS 高且无差异点：不能直接开新品
TMS 高但 KDS 低：只观察或内容测试
```

#### 输出动作

```text
新品方向
目标人群
目标场景
核心功能
价格带
SKU 结构
首批测试词
竞品参照
素材需求
```

---

### 12.4 内容种草路由

#### 判断

```text
CES 高 + 场景/风格/痛点明确 = 内容种草词
```

#### 子判断

```text
CES 高 + KDS 高 = 内容带货词
CES 高 + TMS 高 = 趋势内容词
CES 高 + Conversion 低 = 种草可以做，但不能直接放大商品
```

#### 输出动作

```text
内容选题
前 3 秒钩子
场景冲突
证明镜头
评论引导
购买入口
关联商品
```

---

### 12.5 付费投流路由

#### 判断

```text
KDS + PVS + PFS + TMS 共同决定付费策略
```

#### 策略矩阵

| 类型 | 条件 | 动作 |
|---|---|---|
| 核心放量词 | KDS 高，PVS 高，PFS 不低 | 加预算、保排名、扩词 |
| 承接修复词 | KDS 高，PVS 低，PFS 低 | 先修页面，不先加钱 |
| 小众精准词 | KDS 中低，PVS 高 | 小预算保留、精准匹配 |
| 趋势测试词 | TMS 高，PVS 未验证 | 小预算测试 |
| 浪费词 | PVS 低，成本高，转化低 | 降出价、否词、暂停 |

---

## 13. 标准输出

### 13.1 Keyword Operating Score Record

```json
{
  "keyword": "可裁剪不卡门玄关地垫",
  "category": "入户地垫",
  "keyword_types": ["scene", "spec", "category"],
  "scores": {
    "kds": 83,
    "tms": 78,
    "pvs": 62,
    "ces": 70,
    "pfs": 55,
    "nos": 76,
    "bds": 72,
    "cps": 58
  },
  "score_explanation": {
    "kds": "需求强度高，场景+规格语义明确",
    "tms": "近周期搜索增长且供需比扩大",
    "pvs": "付费价值中等，需小预算测试",
    "ces": "适合做门缝/尺寸内容证明",
    "pfs": "我方标题和主图承接不足",
    "nos": "可进入新品/SKU 观察池"
  },
  "strategy_routes": [
    "old_product_optimization",
    "content_seeding",
    "paid_test"
  ],
  "next_actions": [
    {
      "action_type": "title_rewrite",
      "reason": "标题未覆盖可裁剪/不卡门"
    },
    {
      "action_type": "main_image_proof",
      "reason": "主图缺少门缝开合证明"
    }
  ]
}
```

---

### 13.2 输出报告

#### keyword_operating_map.json

```json
{
  "category": "入户地垫",
  "date_range": "2026-05",
  "keywords": []
}
```

---

#### keyword_strategy_routes.json

```json
{
  "old_product_optimization": [],
  "new_product": [],
  "content_seeding": [],
  "paid_traffic": [],
  "price_band": [],
  "competitor_intercept": []
}
```

---

#### keyword_operating_report.md

必须包含：

```text
1. 类目关键词经营总览
2. 强需求词榜
3. 趋势词榜
4. 付费策略词榜
5. 内容种草词榜
6. 老品承接 GAP 词榜
7. 新品机会词榜
8. 蓝海词榜
9. 高竞争谨慎词
10. 策略路由建议
11. 下一步动作清单
```

---

## 14. 推荐工程目录

```text
keyword_operating_intelligence/
  README.md

  config/
    score_weights.yaml
    route_rules.yaml
    field_mapping.yaml
    keyword_taxonomy.yaml

  src/
    fetch/
      fetch_keyword_data.py
      fetch_paid_data.py
      fetch_product_data.py
      fetch_competitor_data.py
      fetch_content_data.py

    normalize/
      normalize_keyword_metrics.py
      normalize_paid_metrics.py
      normalize_product_metrics.py

    score/
      kds_adapter.py
      tms_score.py
      pvs_score.py
      ces_score.py
      pfs_score.py
      nos_score.py
      bds_score.py
      cps_score.py

    route/
      route_old_product.py
      route_new_product.py
      route_content.py
      route_paid.py
      route_price_band.py
      route_competitor.py

    output/
      build_keyword_operating_map.py
      build_keyword_strategy_routes.py
      render_keyword_report.py

  schemas/
    keyword_operating_score.schema.json
    keyword_strategy_route.schema.json
    keyword_operating_report.schema.json

  tests/
    test_tms_score.py
    test_pvs_score.py
    test_ces_score.py
    test_pfs_score.py
    test_nos_score.py
    test_strategy_routes.py
```

---

## 15. route_rules.yaml 示例

```yaml
old_product_optimization:
  conditions:
    - kds >= 70
    - pfs < 65
  actions:
    - title_rewrite
    - main_image_proof
    - detail_first_3_screens
    - sku_fix

new_product:
  conditions:
    - kds >= 70
    - tms >= 70
    - bds >= 65
    - nos >= 70
  gates:
    - supply_feasibility >= 60
  actions:
    - new_sku_planning
    - price_band_test
    - prototype_test

content_seeding:
  conditions:
    - ces >= 70
  actions:
    - content_topic
    - short_video_script
    - proof_shots
    - comment_prompt

paid_traffic:
  scale:
    conditions:
      - kds >= 75
      - pvs >= 70
      - pfs >= 65
    actions:
      - increase_budget
      - expand_match
      - monitor_cpc

  repair:
    conditions:
      - kds >= 75
      - pvs < 60
      - pfs < 65
    actions:
      - fix_page_first
      - pause_budget_expansion

  test:
    conditions:
      - tms >= 75
      - pvs < 70
    actions:
      - small_budget_test
      - 7_day_validation

  negative:
    conditions:
      - pvs < 45
      - cost_efficiency < 40
    actions:
      - lower_bid
      - narrow_match
      - negative_keyword
```

---

## 16. 验收标准

### 16.1 分数层验收

必须满足：

```text
1. KDS 不被重新实现，只作为输入。
2. TMS 能区分爆发趋势、明确上升、平稳、下降。
3. PVS 能输出放量、修复、保留、测试、否词五类策略。
4. CES 能输出内容选题和脚本方向。
5. PFS 能识别标题、主图、详情、SKU、转化承接 GAP。
6. NOS 能区分新品立项、候选、小样、拒绝。
```

---

### 16.2 路由层验收

必须满足：

```text
1. 老品优化不只看 KDS，必须看 PFS。
2. 开新品不只看趋势，必须看 KDS + TMS + BDS + NOS。
3. 内容种草不只看热度，必须看 CES 和场景/情绪/视觉可表达性。
4. 付费投流不只看 ROI，必须结合 KDS、PVS、PFS、TMS。
5. 高 KDS 低 PFS 的词必须优先输出页面承接修复，而不是直接加预算。
6. 高 TMS 低 KDS 的词不能直接进入新品立项。
```

---

### 16.3 输出层验收

必须输出：

```text
1. keyword_operating_map.json
2. keyword_strategy_routes.json
3. keyword_operating_report.md
4. 每个关键词的分数组合解释
5. 每个策略路由的触发原因
6. 每个动作建议的指标依据
```

---

## 17. 分阶段实施路线

### 阶段 1：TMS 趋势强度

输入：

```text
关键词趋势
词根趋势
关键词元素分析
关键词-月
关键词-近7天
热销商品 / 类目商品趋势
```

输出：

```text
趋势词榜
爆发词榜
持续上升词榜
短期噪音词榜
```

---

### 阶段 2：PVS 付费价值

输入：

```text
直通车关键词
付费商品
付费计划
付费关键词
搜索拉升
CPC / CTR / CVR / ROI / 加购成本
```

输出：

```text
加预算词
降预算词
否词
小预算测试词
页面承接修复词
```

---

### 阶段 3：PFS 商品承接

输入：

```text
自有商品标题
主图卖点
详情页卖点
SKU
流量
点击
加购
转化
退款
```

输出：

```text
标题 GAP
主图 GAP
详情 GAP
SKU GAP
转化 GAP
```

---

### 阶段 4：CES 内容潜力

输入：

```text
社媒场景
用户痛点
风格词
情绪词
评论互动
购买入口
```

输出：

```text
内容选题
脚本钩子
证明镜头
评论引导
购买入口
```

---

### 阶段 5：策略路由与报告

输入：

```text
KDS + TMS + PVS + CES + PFS + NOS + BDS + CPS
```

输出：

```text
老品优化关键词报告
新品机会关键词报告
内容种草关键词报告
付费投流关键词报告
```

---

## 18. 最终原则

```text
KDS 回答：这个词是不是强需求？
TMS 回答：这个词是不是趋势？
PVS 回答：这个词是否值得花钱？
CES 回答：这个词是否适合内容？
PFS 回答：我方是否能承接？
NOS 回答：是否值得开新品？
BDS 回答：是否蓝海？
CPS 回答：竞争压力是否过高？
```

一句话：

> **关键词不是流量词，而是经营动作的入口。**

最终产品形态：

```text
给定品类 / 商品 / 店铺
→ 输出关键词需求地图
→ 输出趋势词地图
→ 输出付费策略地图
→ 输出内容选题地图
→ 输出商品承接 GAP
→ 输出老品优化 / 新品开发 / 内容种草 / 付费投流建议
```
