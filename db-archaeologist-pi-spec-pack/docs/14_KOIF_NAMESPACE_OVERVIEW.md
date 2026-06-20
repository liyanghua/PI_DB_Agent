# KOIF Namespace Overview

**KOIF**：Keyword Operating Intelligence Framework，关键词经营洞察框架。

本规范定义 KOIF 在 spec-pack 工程层的全景：8 个评分能力（capability）的全景表、score_vector 聚合 schema、数据底座现状、6 个未实现 capability 的 stub Appendix。

---

## 1. KOIF 是什么

### 1.1 业务定位

KOIF 把「关键词经营」拆解为 **8 个评分维度** + **1 个策略路由器**：

- 8 个评分维度（每个维度产出一个 0-100 的分数）：从需求强度、趋势、付费价值、内容潜力、商品承接、新品机会、蓝海需求、竞争压力 8 个角度量化关键词。
- 策略路由器（KOIF Router）：跨 8 个维度聚合 score_vector，按规则推导经营策略，渲染可执行的行动建议。

KOIF 区别于传统 BI 报告的核心是**输出落点**：
- 传统报告：给指标解读 → 用户自己想策略
- KOIF：给 score_vector + strategy_routes + next_actions → 用户直接执行

「以经营动作为终点的洞察」就是 KOIF 的 operating_intelligence。

### 1.2 工程层映射

| KOIF 业务概念 | 工程层落点 |
| --- | --- |
| KOIF namespace | `namespace = keyword_analysis_pack` |
| 8 个评分能力 | 8 个 sibling capability，各 1 份 manifest + 三件套工具 |
| score_vector | KOIF Router 聚合产物（`registry/koif_routes/<id>/score_vector.json`） |
| strategy_routes | KOIF Router 决策产物 |
| next_actions | KOIF Router 渲染产物 |

KOIF **不是**一个新 namespace，而是 `keyword_analysis_pack` namespace 的业务别名。
KOIF Router **不是**一个 capability，而是元工具层的工具（与 `propose_insight_plan` 同层）。

详见 [11_ANALYSIS_PACK_FRAMEWORK_SPEC.md](11_ANALYSIS_PACK_FRAMEWORK_SPEC.md) §1.1.1 与 §12.8。

### 1.3 Phase 2 落地范围

| 阶段 | 落地内容 | 状态 |
| --- | --- | --- |
| Phase 2 | KDS（需求强度）+ TMS（趋势强度）+ KOIF Router 骨架 | 进行中 |
| Phase 3 | PVS（付费价值）+ CPS（竞争压力） | 规划中 |
| Phase 4 | CES（内容潜力）+ PFS（商品承接） | 规划中 |
| Phase 5 | NOS（新品机会）+ BDS（蓝海需求） | 规划中 |

Phase 2 的 score_vector 仅有 2/8 维度有值，其余 6 维度标 `unavailable`。Router 仍可输出策略，但策略覆盖度有限（仅老品优化 / 趋势测试 / 内容候选 3 类）。

---

## 2. 8 Capability 全景表

| capability | score_domain | 业务问题 | 关键指标 | Phase 2 状态 | 数据源依赖 |
| --- | --- | --- | --- | --- | --- |
| `keyword_demand` | demand | 是不是强需求？ | KDS（0-100） | ✅ 已实现 | 6 P0 关键词接口（已做 field_mapping） |
| `keyword_trend` | trend | 是不是趋势？ | TMS（0-100） | ✅ Phase 2 落地 | 同上（重点用 mom/yoy） |
| `paid_value` | paid | 是否值得花钱投流？ | PVS（0-100） | 📋 stub spec（Phase 3） | 付费域 9 接口（cards 有，未做 field_mapping） |
| `content_expansion` | content | 是否适合种草？ | CES（0-100） | 📋 stub spec（Phase 4） | 社媒域 6 + 评论域（cards 有部分） |
| `product_fit` | product_fit | 我方商品能否承接？ | PFS（0-100） | 📋 stub spec（Phase 4） | 商品域 35 接口（cards 有，未做 field_mapping） |
| `new_opportunity` | new_opportunity | 是否值得开新品？ | NOS（0-100） | 📋 stub spec（Phase 5） | 类目域 10 + 竞争域 19（cards 有，未做 field_mapping） |
| `blue_ocean_demand` | blue_ocean | 是否蓝海？ | BDS（0-100） | 📋 stub spec（Phase 5） | 关键词 + 竞争域 19 |
| `competition_pressure` | competition | 竞争压力多大？ | CPS（0-100） | 📋 stub spec（Phase 3） | 竞争域 19 接口（cards 有，未做 field_mapping） |

**manifest 契约**：每个 capability 的 `manifest.yaml` 必须填写：
- `score_domain`：取值 8 选 1（demand / trend / paid / content / product_fit / new_opportunity / blue_ocean / competition）
- `koif_aggregatable: true`：声明可被 KOIF Router 消费

校验规则：同 namespace 内 `score_domain` 不重复（见 11 号 §5.3）。

---

## 3. ScoreVector Schema

### 3.1 数据结构

```typescript
interface ScoreVector {
  keyword: string;                  // 实体规范名（从 S1 resolve 来）
  category: string;                 // 等同 keyword，历史兼容字段
  category_id?: string;
  scores: {
    kds?: number;                   // Keyword Demand Score (0-100)
    tms?: number;                   // Trend Momentum Score (0-100)
    pvs?: number;                   // Paid Value Score (Phase 3+)
    ces?: number;                   // Content Expansion Score (Phase 3+)
    pfs?: number;                   // Product Fit Score (Phase 4+)
    nos?: number;                   // New Opportunity Score (Phase 5+)
    bds?: number;                   // Blue-ocean Demand Score (Phase 5+)
    cps?: number;                   // Competition Pressure Score (Phase 3+)
  };
  score_explanation: Record<ScoreDomain, string>;  // 各分数简述（从 report.md 提取）
  available_scores: string[];       // Phase 2 = ["kds", "tms"]
  aggregated_at: string;            // ISO 8601
  router_run_id: string;
}

type ScoreDomain = "demand" | "trend" | "paid" | "content" | "product_fit" 
                 | "new_opportunity" | "blue_ocean" | "competition";
```

产物文件：`registry/koif_routes/<router_run_id>/score_vector.json`。

### 3.2 Phase 2 聚合规则

KOIF Router S4 阶段按以下规则聚合 score_vector：

| score_domain | 数据来源 capability | 提取路径 | 聚合公式 |
| --- | --- | --- | --- |
| demand | `keyword_demand` | `<entity>_scores.json → records[].kds` | `mean(top_20.kds)` |
| trend | `keyword_trend` | `trend_result.json → rising[].tms` | `mean(rising.tms)` |
| paid | - | - | Phase 3+ |
| content | - | - | Phase 4+ |
| product_fit | - | - | Phase 4+ |
| new_opportunity | - | - | Phase 5+ |
| blue_ocean | - | - | Phase 5+ |
| competition | - | - | Phase 3+ |

详见 [15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md) §4.4。

### 3.3 降级与 unavailable 标记

- 如果 capability run 失败（live_no_keyword_data / pull_no_data），对应 score_domain 不进入 `scores` 对象。
- `available_scores[]` 列出本次成功聚合的 score_domain（Phase 2 最多 2 个）。
- Router 仍可在部分分数缺失时输出策略，但策略覆盖度受限。

---

## 4. 数据底座现状

### 4.1 P0 数据源（已做 field_mapping）

Phase 2 KDS + TMS 共享的 6 个关键词接口（已在 `registry/keyword_field_mapping.yaml` 完成映射）：

| api_id | 用途 | KDS 用字段 | TMS 用字段 |
| --- | --- | --- | --- |
| `data_blue_keyword_7d_v2` | 关键词 7 日指标 | search_popularity, transaction_index | search_popularity_mom |
| `data_blue_keyword_30d_v2` | 关键词 30 日指标 | search_popularity, search_growth_rate | search_popularity_yoy |
| `data_keywords_category_list` | 类目关键词列表 | - | - |
| `data_blue_keyword_search_trend_info_v2` | 搜索趋势详情 | search_value | slope_7d |
| `data_blue_keyword_transaction_info_v2` | 交易指标 | transaction_index | - |
| `data_blue_keyword_ad_keyword_list_v2` | 广告关键词 | is_ad_keyword | - |

这 6 接口支撑 KDS 4 子分数（scale / growth / conversion / competition）+ TMS 3 因子（mom / yoy / trendLabel）。

### 4.2 P1 数据源（cards 有但未做 field_mapping）

| 域 | 接口数量 | 依赖 capability | 现状 |
| --- | --- | --- | --- |
| 付费域 | 9 | `paid_value`（PVS） | cards 已有，未做 field_mapping，Phase 3 补 |
| 商品域 | 35 | `product_fit`（PFS） | cards 已有，未做 field_mapping，Phase 4 补 |
| 竞争域 | 19 | `competition_pressure`（CPS）+ `new_opportunity`（NOS 部分） | cards 已有，未做 field_mapping，Phase 3/5 补 |
| 类目域 | 10 | `new_opportunity`（NOS 部分） | cards 已有，未做 field_mapping，Phase 5 补 |
| 社媒域 | 6 | `content_expansion`（CES 部分） | cards 有部分，Phase 4 补 |
| 评论域 | - | `content_expansion`（CES 部分） | cards 缺失，需补源文档 |

### 4.3 数据源优先级（Phase 3+ 落地顺序）

| Phase | 落地 capability | 需补充的 field_mapping |
| --- | --- | --- |
| Phase 3 | PVS + CPS | 付费域 9 + 竞争域 19 |
| Phase 4 | CES + PFS | 社媒域 6 + 评论域（缺）+ 商品域 35 |
| Phase 5 | NOS + BDS | 类目域 10 + 竞争域 19（已做） |

---

## 5. KOIF Router 元工具简述

KOIF Router（`propose_koif_strategy`）是元工具层入口，不属于任何 capability，不走 8-stage pipeline。

### 5.1 工作流（7 步）

```
S1: resolve entity      → 复用 keyword_demand 的 S1（category taxonomy）
S2: invoke capabilities → 并行调 analyze_keyword_demand + analyze_keyword_trend
S3: load runs           → 从 registry/derived/<namespace>/<capability>/<run_id>/ 读产物
S4: aggregate scores    → 按 score_domain 装配 score_vector
S5: route               → 按 koif_route_rules.yaml 推导 strategy_routes
S6: generate actions    → 按 koif_action_templates.yaml 渲染 next_actions
S7: write router_run    → 落盘到 registry/koif_routes/<router_run_id>/
```

详见 [15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md) §3。

### 5.2 Phase 2 路由规则（3 策略）

| strategy_id | 触发条件 | 适用场景 | action 类型 |
| --- | --- | --- | --- |
| `old_product_optimization` | `kds >= 70` | 已有商品，高需求词未覆盖 | title_rewrite |
| `trend_test` | `tms >= 75 && kds >= 60` | 趋势强势 + 需求尚可 | content_topic, paid_test |
| `content_candidate` | `kds >= 70 && tms >= 70` | 需求 + 趋势双高 | content_topic |

完整规则见 `registry/koif_route_rules.yaml`（Phase 2 仅 3 条，Phase 3+ 扩展到 6-8 条）。

### 5.3 Phase 2 行动建议（3 类）

| action | 模板来源 | 关键词筛选逻辑 | 话术示例 |
| --- | --- | --- | --- |
| `title_rewrite` | `koif_action_templates.yaml` | 取 KDS TOP 5 | 「建议在标题中强化 <keywords> 的覆盖，提升搜索承接」 |
| `content_topic` | 同上 | 取 TMS TOP 3（rising） | 「可围绕 <keywords> 制作内容话题，把握趋势窗口期（月环比 +<mom>%）」 |
| `paid_test` | 同上 | KDS ≥ 80 + TMS ≥ 60 交集 | 「<keywords> 强需求 + 趋势加持，可小预算测试付费投放」 |

完整模板见 `registry/koif_action_templates.yaml`。

---

## 6. Appendix: 6 个未实现 Capability Stub

以下 6 个 capability 在 Phase 2 以 stub 形式占位，仅给出公式摘要（从 [keyword_operating_intelligence_framework_koif.md](keyword_operating_intelligence_framework_koif.md) 引用）与数据源缺口，不展开完整 spec。

### A. Paid Value Score (PVS) — 付费价值评分

**score_domain**: `paid`  
**业务问题**: 这个词是否值得花钱投付费流量？  
**预计 Phase**: Phase 3

#### 公式摘要

```
PVS = 0.25 × PaidTrafficQuality 
    + 0.25 × PaidConversionQuality 
    + 0.25 × BidCompetitiveness 
    + 0.25 × ROIPotential
```

- **PaidTrafficQuality**: 付费流量质量（CPM / CPC 稳定性 + 点击率）
- **PaidConversionQuality**: 付费转化质量（CVR / 客单价）
- **BidCompetitiveness**: 竞价竞争度（平均出价 / 出价波动）
- **ROIPotential**: ROI 潜力（预估 GMV / 预估广告花费）

#### 数据源缺口

| 域 | 接口数量 | 现状 |
| --- | --- | --- |
| 付费域 | 9 | cards 已有，未做 field_mapping |

需补字段映射：`cpm / cpc / ctr / cvr / avg_bid / bid_volatility / ad_gmv`。

---

### B. Content Expansion Score (CES) — 内容扩展潜力评分

**score_domain**: `content`  
**业务问题**: 这个词是否适合做内容种草？  
**预计 Phase**: Phase 4

#### 公式摘要

```
CES = 0.25 × SceneClarity 
    + 0.20 × EmotionIntensity 
    + 0.20 × SocialProof 
    + 0.20 × ContentGap 
    + 0.15 × VisualAppeal
```

- **SceneClarity**: 场景清晰度（评论 / 笔记中场景词频）
- **EmotionIntensity**: 情感强度（正负面情感词占比 + 极性强度）
- **SocialProof**: 社交证明（种草笔记数 / 互动数）
- **ContentGap**: 内容缺口（竞品内容覆盖度 vs 需求热度）
- **VisualAppeal**: 视觉吸引力（主图多样性 / 视频占比）

#### 数据源缺口

| 域 | 接口数量 | 现状 |
| --- | --- | --- |
| 社媒域 | 6 | cards 有部分，Phase 4 补 |
| 评论域 | - | cards 缺失，需补源文档 |
| 商品域（主图） | 35 中部分 | cards 已有，未做 field_mapping |

需补字段映射：`scene_keywords / emotion_score / social_interaction / content_coverage / image_diversity`。

---

### C. Product Fit Score (PFS) — 商品承接能力评分

**score_domain**: `product_fit`  
**业务问题**: 我方现有商品能否承接这个词的流量？  
**预计 Phase**: Phase 4

#### 公式摘要

```
PFS = 0.25 × TitleCoverage 
    + 0.25 × MainImageProofCoverage 
    + 0.20 × AttributeMatch 
    + 0.15 × PriceCompetitiveness 
    + 0.15 × StockDepth
```

- **TitleCoverage**: 标题覆盖度（SKU 标题包含该词的占比）
- **MainImageProofCoverage**: 主图卖点覆盖度（主图是否体现该词需求）
- **AttributeMatch**: 属性匹配度（SKU 属性与该词用户画像匹配）
- **PriceCompetitiveness**: 价格竞争力（我方价格带 vs 市场价格带）
- **StockDepth**: 库存深度（可承接流量的 SKU 数）

#### 数据源缺口

| 域 | 接口数量 | 现状 |
| --- | --- | --- |
| 商品域 | 35 | cards 已有，未做 field_mapping |

需补字段映射：`sku_title / main_image_proof / attribute_tags / price_band / stock_count`。

---

### D. New Opportunity Score (NOS) — 新品机会评分

**score_domain**: `new_opportunity`  
**业务问题**: 这个词是否值得立项开新品？  
**预计 Phase**: Phase 5

#### 公式摘要

```
NOS = 0.30 × MarketGapScore 
    + 0.25 × SupplyFeasibility 
    + 0.25 × DemandStability 
    + 0.20 × CompetitionBarrier
```

- **MarketGapScore**: 市场缺口（需求高 + SKU 覆盖低）
- **SupplyFeasibility**: 供应可行性（类目准入门槛 + 供应链成熟度）
- **DemandStability**: 需求稳定性（季节性 + 生命周期阶段）
- **CompetitionBarrier**: 竞争壁垒（头部品牌集中度 + 新品成功率）

#### 数据源缺口

| 域 | 接口数量 | 现状 |
| --- | --- | --- |
| 类目域 | 10 | cards 已有，未做 field_mapping |
| 竞争域 | 19 | cards 已有，未做 field_mapping |
| 关键词域 | 6 | 已做（复用 KDS 数据源） |

需补字段映射：`category_entry_barrier / supply_chain_maturity / seasonality / brand_concentration`。

---

### E. Blue-ocean Demand Score (BDS) — 蓝海需求评分

**score_domain**: `blue_ocean`  
**业务问题**: 这个词是否是蓝海机会（高需求 + 低竞争）？  
**预计 Phase**: Phase 5

#### 公式摘要

```
BDS = 0.40 × DemandSupplyGap 
    + 0.30 × CompetitionIntensity 
    + 0.30 × GrowthMomentum
```

- **DemandSupplyGap**: 需求供给缺口（搜索热度 / SKU 数 比值）
- **CompetitionIntensity**: 竞争强度（头部 SKU 占有率 + 新品进入率）
- **GrowthMomentum**: 增长势能（需求增速 + 供给增速差）

#### 数据源缺口

| 域 | 接口数量 | 现状 |
| --- | --- | --- |
| 关键词域 | 6 | 已做（复用 KDS + TMS 数据源） |
| 竞争域 | 19 | cards 已有，未做 field_mapping |

需补字段映射：`sku_count / top_sku_share / new_product_entry_rate`。

---

### F. Competition Pressure Score (CPS) — 竞争压力评分

**score_domain**: `competition`  
**业务问题**: 这个词的竞争压力有多大？  
**预计 Phase**: Phase 3

#### 公式摘要

```
CPS = 0.60 × CompetitionIndex 
    + 0.40 × MarketAverageBid
```

- **CompetitionIndex**: 竞争指数（竞品数量 + 品牌集中度 + 广告竞争度）
- **MarketAverageBid**: 市场平均出价（付费域 CPC / CPM 均值）

#### 数据源缺口

| 域 | 接口数量 | 现状 |
| --- | --- | --- |
| 竞争域 | 19 | cards 已有，未做 field_mapping |
| 付费域 | 9 | cards 已有，未做 field_mapping（与 PVS 共享） |

需补字段映射：`competitor_count / brand_concentration / ad_competition_level / avg_cpc`。

---

## 7. Phase 3+ 扩展路径

### 7.1 Phase 3：付费投流决策闭环

- 落地 PVS（付费价值）+ CPS（竞争压力）
- 补充 `paid_invest` / `paid_cutoff` 两条路由规则
- 新增 `paid_test` / `paid_scale` 两类 action

### 7.2 Phase 4：内容种草 + 老品诊断

- 落地 CES（内容潜力）+ PFS（商品承接）
- 补充 `content_scaling` / `product_gap_fix` 两条路由规则
- 新增 `content_angle` / `title_optimize` / `image_upgrade` 三类 action

### 7.3 Phase 5：新品立项决策

- 落地 NOS（新品机会）+ BDS（蓝海需求）
- 补充 `new_product_launch` / `blue_ocean_entry` 两条路由规则
- 新增 `category_entry` / `supply_chain_prep` 两类 action

### 7.4 Phase 6+ 高级能力

- 跨 entity 对比（如「地垫 vs 桌布的关键词机会对比」）
- 时序策略变化追踪（同 entity 每周跑一次，输出策略演变轨迹）
- A/B 策略验证（同一 entity 两条策略并行，回溯 GMV 归因）

---

## 8. 与 Analysis Pack Framework 的契约

KOIF 完全按 [11_ANALYSIS_PACK_FRAMEWORK_SPEC.md](11_ANALYSIS_PACK_FRAMEWORK_SPEC.md) 框架规范实现：

- **namespace**: `keyword_analysis_pack`（8 个 capability 共享）
- **PackManifest**: 每个 capability 必须填 `score_domain` + `koif_aggregatable: true`
- **RunEnvelope**: 各 capability 产物落 `registry/derived/keyword_analysis_pack/<capability>/<run_id>/`
- **KOIF Router**: 元工具层，产物落 `registry/koif_routes/<router_run_id>/`（独立根）
- **stage 复用**: 8 个 capability 共享 S1~S4（resolve / pull / shape / normalize），从 S5 开始分叉

KOIF Router 不改变 framework 契约，只在元工具层聚合已有 capability 的产物。

---

## 9. 验收标准

### 9.1 Phase 2 验收

- [ ] `keyword_demand` manifest 含 `score_domain: demand` + `koif_aggregatable: true`
- [ ] `keyword_trend` manifest 含 `score_domain: trend` + `koif_aggregatable: true`
- [ ] `keyword_demand` 输出 `<entity>_scores.json`，含 `records[].kds`
- [ ] `keyword_trend` 输出 `trend_result.json`，含 `rising[].tms`
- [ ] KOIF Router 工具 `propose_koif_strategy` 注册成功
- [ ] Router 能聚合 KDS + TMS 为 score_vector
- [ ] Router 输出 3 策略（old_product_optimization / trend_test / content_candidate）
- [ ] Router 输出 3 类 actions（title_rewrite / content_topic / paid_test）
- [ ] router_run 产物落盘到 `registry/koif_routes/<router_run_id>/`

### 9.2 Phase 3+ 验收

每增加一个新 capability，验收清单：
- [ ] manifest 含 `score_domain` + `koif_aggregatable: true`
- [ ] 输出产物含对应分数字段（如 PVS → `paid_scores.json`）
- [ ] Router S4 能提取该分数进 score_vector
- [ ] 至少 1 条新路由规则命中该分数
- [ ] 至少 1 类新 action 消费该分数