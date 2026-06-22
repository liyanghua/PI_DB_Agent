# Search as Code 技术报告：面向经营增长 Agent 的可编程搜索架构

**版本**：v1.0  
**适用对象**：AI-coding / Agent Runtime / 数据平台 / 经营增长 OS 产品与研发团队  
**核心场景**：电商经营洞察、机会发现、诊断规划、内容/投放/商品动作生成  
**关键词**：Search as Code、Agentic Search、Evidence Pack、Opportunity Card、Search SDK、经营增长 OS

---

## 0. 执行摘要

Search as Code，简称 SaC，是一种面向 Agent 的搜索架构范式。它不再把搜索视为一个黑盒 API，而是把搜索系统拆解为可组合、可编排、可执行、可评估的原子能力，让 Agent 通过生成代码来动态构造检索、抓取、过滤、抽取、验证、聚合和输出流程。

对于经营增长 OS 来说，SaC 的价值不是“增加一个搜索功能”，而是把外部平台数据、内部经营数据、内容素材、竞品信息、关键词需求、评论反馈、榜单趋势等信息源，统一纳入一个可编程的信息获取与证据计算层。

在洞察规划场景中，SaC 可以把传统的：

```text
用户问题 → RAG 检索 → LLM 总结
```

升级为：

```text
经营目标 → Agent 生成搜索/分析程序 → 多源并发采集 → 清洗过滤 → 聚类归因 → 证据验证 → 机会卡/诊断卡/动作计划
```

最终，SaC 应成为经营增长 OS 中连接“数据层、知识层、Agent 层、执行层、评估层”的核心基础设施。

---

## 1. Search as Code 的技术背景

### 1.1 从传统搜索到 Agentic Search

传统搜索架构主要服务于人类用户。用户输入关键词，搜索引擎返回排序后的页面结果。搜索系统内部的召回、排序、摘要、过滤、去重等逻辑被封装在黑盒管道里。

典型流程如下：

```text
Human / LLM
   ↓ query
Search Engine
   ↓ ranked results
Human / LLM reads results
```

这种方式适合单次问答和简单事实查找，但不适合复杂 Agent 任务。Agent 的任务往往具有以下特征：

1. 信息需求不确定，需要边搜边判断。
2. 需要同时搜索多个来源。
3. 需要过滤广告、重复、低质量、过时或非权威信息。
4. 需要结构化抽取字段。
5. 需要验证证据链。
6. 需要把搜索结果转化为可执行决策。
7. 任务可能跨越多个小时、多个步骤、多个数据源。

因此，传统搜索的“单次 query → 返回结果”接口对 Agent 来说过于粗糙。

---

### 1.2 RAG 的局限

RAG 把搜索能力引入 LLM 系统，通常流程是：

```text
User Query
   ↓
Retriever Top-K
   ↓
Prompt Context
   ↓
LLM Answer
```

RAG 解决了 LLM 缺少外部知识的问题，但仍然存在明显限制：

| 维度 | 普通 RAG 的问题 |
|---|---|
| 查询控制 | 多数情况下只支持一次或少量 query |
| 数据源 | 通常以知识库文档为主，难以统一处理网页、平台数据、评论、表格、API |
| 中间状态 | 检索过程不透明，难以审计 |
| 多轮搜索 | 依赖模型反复调用工具，延迟高、成本高 |
| 并发能力 | 较弱 |
| 过滤逻辑 | 通常依赖 Prompt 判断，稳定性不足 |
| 证据验证 | 很难确保结论与证据严格绑定 |
| 可评估性 | 很难对检索策略本身做回放和优化 |

对于经营增长场景，RAG 只能回答“已有知识里说了什么”，很难完成“现在市场上有什么机会，证据是否充分，下一步该做什么”这类动态经营任务。

---

### 1.3 Search as Code 的定义

Search as Code 的核心定义是：

> 将搜索系统的关键能力拆解为可编程原语，通过 SDK 暴露给 Agent，由 Agent 根据任务动态生成代码，在安全运行环境中执行搜索、抽取、过滤、聚合、验证和输出流程。

它的关键不是“用代码调用搜索 API”，而是“用代码表达搜索策略”。

传统 Search API：

```python
results = search("桌垫 防水 防油 需求")
```

Search as Code：

```python
queries = keyword_expander.expand(
    category="桌垫",
    dimensions=["材质", "场景", "痛点", "人群", "季节", "风格"]
)

raw_items = collector.parallel_collect(
    sources=["xiaohongshu", "taobao", "douyin", "competitor_comments", "rankings"],
    queries=queries,
    concurrency=8
)

clean_items = quality_filter.run(raw_items)
clusters = opportunity_clusterer.cluster(clean_items)
gaps = coverage_analyzer.find_gaps(clusters)
backfilled = collector.backfill(gaps)

evidence = evidence_extractor.extract(backfilled)
opportunities = opportunity_scorer.score(evidence)
cards = opportunity_card_builder.build(opportunities)
```

这意味着 Agent 不只是“调用工具”，而是“编排信息获取和证据计算流程”。

---

## 2. Search as Code 的核心技术组成

### 2.1 模型控制平面

模型控制平面负责理解任务、生成计划、选择数据源、生成搜索代码、判断是否需要补充搜索，以及解释最终结果。

职责包括：

1. 识别任务类型：机会发现、商品诊断、投放诊断、竞品分析、内容规划等。
2. 拆解信息需求。
3. 选择搜索维度和数据源。
4. 生成 Search Program。
5. 根据中间结果决定是否继续搜索。
6. 对最终证据和结论进行解释。

模型控制平面不应该负责大量确定性计算，例如去重、排序、聚合、阈值判断、覆盖率统计、价格带分布计算等。这些应交给代码执行。

---

### 2.2 Search SDK / Data SDK

Search SDK 是 SaC 的能力边界。它需要把多源搜索、抓取、抽取、过滤、聚合、验证等能力封装成稳定接口。

建议的 SDK 原语：

```text
Keyword Primitives
- expand_keywords
- group_keywords
- score_keyword_intent
- detect_keyword_gap

Collection Primitives
- search_web
- search_xiaohongshu
- search_taobao
- search_douyin
- fetch_competitor_comments
- fetch_platform_rankings
- fetch_internal_sales
- fetch_ads_performance
- fetch_material_assets

Cleaning Primitives
- remove_ads
- remove_duplicates
- filter_low_quality
- filter_low_sales
- normalize_product
- normalize_content

Extraction Primitives
- extract_demands
- extract_pain_points
- extract_selling_points
- extract_price
- extract_scenes
- extract_personas
- extract_conversion_signals
- extract_content_signals

Analysis Primitives
- cluster_by_scene
- cluster_by_persona
- cluster_by_price_band
- cluster_by_selling_point
- detect_coverage_gap
- score_opportunity
- rank_opportunities

Verification Primitives
- verify_search_volume
- verify_comment_frequency
- verify_competitor_sales
- verify_content_engagement
- verify_supply_chain_feasibility
- verify_evidence_binding

Output Primitives
- build_evidence_pack
- build_opportunity_card
- build_action_plan
- build_experiment_plan
```

---

### 2.3 安全执行沙箱

SaC 需要让 Agent 生成并执行代码，因此必须有安全执行边界。

沙箱需要提供：

1. 文件系统隔离。
2. 网络访问白名单。
3. API 调用权限控制。
4. 执行时间限制。
5. 资源限制，例如 CPU、内存、并发数。
6. 日志记录。
7. 中间产物保存。
8. 可回放机制。
9. 错误恢复机制。
10. 人工审批钩子，尤其是涉及外部平台写操作时。

首版 MVP 可以采用：

```text
Python Worker + Docker Sandbox + Local JSON Artifacts + API Key 权限隔离
```

后续升级为：

```text
Agent Runtime + Task Queue + Artifact Store + Policy Engine + Replay/Eval System
```

---

### 2.4 Evidence Pack

Search as Code 不是为了生成“更像真的答案”，而是为了生成可审计、可验证、可复盘的经营判断。

因此，每一次搜索与分析都应输出 Evidence Pack。

Evidence Pack 建议字段：

```yaml
evidence_pack_id: string
task_id: string
category: string
time_range: string
sources:
  - source_name: string
    query: string
    collected_count: number
    valid_count: number
    filtered_count: number
filter_rules:
  - rule_name: string
    description: string
coverage:
  keyword_coverage: number
  source_coverage: number
  scene_coverage: number
  persona_coverage: number
signals:
  search_volume: object
  comment_frequency: object
  competitor_sales: object
  content_engagement: object
  price_distribution: object
  supply_chain_feasibility: object
claims:
  - claim_id: string
    claim_text: string
    supporting_evidence_ids: list
    confidence: number
    counter_evidence: list
quality:
  evidence_sufficiency_score: number
  contradiction_score: number
  freshness_score: number
  decision_confidence: number
```

Evidence Pack 是后续机会卡、诊断卡、动作卡、实验计划和复盘评估的共同基础。

---

## 3. 经营场景 Search as Code 技术架构

### 3.1 总体架构

```text
┌─────────────────────────────────────────────────────────────┐
│                    经营目标 / 用户问题                       │
│  例：桌垫类目下，下个月有什么值得做的细分机会？               │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Agent Planner / Controller                │
│  - 识别任务类型                                               │
│  - 拆解信息需求                                               │
│  - 选择数据源                                                 │
│  - 生成 Search Program                                        │
│  - 决定是否补充搜索                                           │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Search Program Sandbox                    │
│  - 执行 Python / Workflow                                     │
│  - 并发控制                                                   │
│  - 中间状态保存                                               │
│  - 权限与安全限制                                             │
│  - 日志与回放                                                 │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Search / Data SDK                         │
│  外部平台：小红书 / 淘宝 / 抖音 / 平台榜单 / 竞品评论          │
│  内部数据：商品 / 订单 / 投放 / 素材 / 客服 / 企业知识库        │
│  通用能力：关键词扩展 / 抓取 / 清洗 / 抽取 / 聚类 / 验证        │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Evidence & Analysis Layer                 │
│  - Evidence Pack                                              │
│  - Demand Cluster                                             │
│  - Opportunity Score                                          │
│  - Gap Analysis                                               │
│  - Claim Verification                                         │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Decision Artifacts                         │
│  - 机会卡 Opportunity Card                                    │
│  - 诊断卡 Diagnosis Card                                      │
│  - 动作计划 Action Plan                                       │
│  - 实验计划 Experiment Plan                                   │
│  - 复盘报告 Review Report                                     │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Execution & Feedback                       │
│  - 内容生产 Agent                                             │
│  - 商品上新 Agent                                             │
│  - 投放调整 Agent                                             │
│  - 平台执行 OpenClaw / Browser / RPA                          │
│  - 结果回流与评估                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 3.2 经营增长 OS 中的 SaC 分层

| 层级 | 作用 | 关键产物 |
|---|---|---|
| 任务层 | 接收经营目标和业务问题 | GoalSpec / TaskSpec |
| 策略层 | 选择洞察方法、分析维度、搜索策略 | Search Plan / Skill Plan |
| 代码层 | 生成并执行搜索分析程序 | Search Program |
| 数据层 | 连接平台数据、内部数据、外部网页 | Raw Items / API Records |
| 证据层 | 清洗、抽取、聚合、验证 | Evidence Pack |
| 决策层 | 生成机会、诊断、动作 | Card / Plan |
| 执行层 | 执行内容、投放、上架、运营动作 | Execution Task |
| 评估层 | 回流效果，优化策略 | Eval Report / Strategy Update |

---

### 3.3 与现有经营增长 OS 模块的关系

```text
数据平台
  ↓ 提供经营事实、商品、订单、投放、素材、客服数据
Search as Code Layer
  ↓ 生成可验证的证据包
知识库 / 策略库
  ↓ 提供行业策略、企业策略、历史打法
Agent 矩阵
  ↓ 洞察 Agent / 规划 Agent / 内容 Agent / 投放 Agent / 上架 Agent
OpenClaw / 本地执行端
  ↓ 浏览器、平台后台、素材工具、办公工具执行
Eval / Review
  ↓ 回流经营结果，优化搜索策略、机会评分和动作模板
```

Search as Code 在这里不是一个独立应用，而是经营增长 OS 的“信息获取与证据计算中台”。

---

## 4. 核心数据模型

### 4.1 TaskSpec

```yaml
task_id: string
task_type: opportunity_discovery | product_diagnosis | ad_diagnosis | content_planning
category: string
business_goal: string
platforms: list
constraints:
  price_range: string
  target_persona: string
  time_range: string
  supply_chain_constraints: list
output_requirements:
  need_opportunity_cards: boolean
  need_action_plan: boolean
  need_evidence_pack: boolean
```

---

### 4.2 SearchPlan

```yaml
search_plan_id: string
task_id: string
keyword_dimensions:
  - material
  - scene
  - pain_point
  - persona
  - season
  - style
sources:
  - xiaohongshu
  - taobao
  - douyin
  - competitor_comments
  - platform_rankings
  - internal_sales
query_strategy:
  fanout_depth: number
  max_queries_per_dimension: number
  backfill_enabled: boolean
quality_filters:
  remove_ads: true
  remove_duplicates: true
  min_sales_threshold: number
  min_engagement_threshold: number
```

---

### 4.3 RawItem

```yaml
raw_item_id: string
source: string
query: string
title: string
content: string
url: string
media_type: text | image | video | product | comment
metrics:
  likes: number
  comments: number
  shares: number
  sales: number
  price: number
timestamp: string
metadata: object
```

---

### 4.4 EvidenceItem

```yaml
evidence_id: string
source: string
evidence_type: demand | pain_point | selling_point | price | sales | content_engagement | comment_signal
text: string
normalized_fields:
  scene: string
  persona: string
  pain_point: string
  selling_point: string
  price_band: string
  product_type: string
metrics: object
confidence: number
supporting_raw_item_ids: list
```

---

### 4.5 OpportunityCard

```yaml
opportunity_id: string
category: string
opportunity_title: string
opportunity_summary: string
scene: string
persona: string
pain_points: list
recommended_product_angle: string
recommended_content_angle: string
recommended_price_band: string
evidence_summary: string
opportunity_score:
  demand_strength: number
  competition_gap: number
  content_heat: number
  conversion_signal: number
  supply_feasibility: number
  overall: number
risks:
  - risk_name: string
    mitigation: string
recommended_actions:
  - action_type: content | product | ads | listing | research
    description: string
experiment_plan:
  hypothesis: string
  test_group: string
  success_metrics: list
evidence_pack_id: string
confidence: number
```

---

## 5. 洞察规划场景示例：桌垫类目机会发现

### 5.1 业务问题

```text
桌垫类目下，未来 30 天有哪些值得做的细分机会？
需要输出：
1. 机会卡
2. 证据包
3. 内容选题建议
4. 商品/卖点优化建议
5. 可执行实验计划
```

---

### 5.2 Search as Code 流程

#### Step 1：生成多组关键词

关键词维度：

```text
材质：PVC、硅胶、皮革、透明、软玻璃、亚克力
场景：餐桌、书桌、办公桌、儿童桌、茶几、厨房
痛点：防水、防油、防烫、防滑、易清洁、无异味、耐高温
人群：宝妈、租房党、办公室人群、宠物家庭、学生、老人
季节：夏季、开学季、春节、搬家季
风格：奶油风、原木风、极简风、法式、侘寂风、北欧风
```

Search Program 示例：

```python
keyword_groups = sdk.keywords.expand(
    seed="桌垫",
    dimensions=["material", "scene", "pain_point", "persona", "season", "style"],
    max_per_dimension=30
)

queries = sdk.keywords.compose_queries(
    keyword_groups,
    templates=[
        "{scene} {pain_point} 桌垫",
        "{persona} {scene} 桌垫 推荐",
        "{style} {material} 桌垫",
        "{season} 桌垫 {pain_point}"
    ]
)
```

---

#### Step 2：多源并发抓取

数据源：

```text
小红书：内容趋势、用户场景、痛点表达、种草话术
淘宝：商品供给、销量、价格带、卖点结构
抖音：视频内容热度、达人话术、内容转化信号
竞品评论：真实痛点、差评原因、复购理由
平台榜单：搜索热度、热销趋势、类目变化
内部数据：自有商品、转化率、库存、毛利、投放表现
```

Search Program 示例：

```python
raw_items = sdk.collect.parallel(
    jobs=[
        sdk.collect.xiaohongshu(queries, max_items=500),
        sdk.collect.taobao(queries, max_items=500),
        sdk.collect.douyin(queries, max_items=300),
        sdk.collect.competitor_comments(category="桌垫", max_items=2000),
        sdk.collect.platform_rankings(category="桌垫", days=30),
        sdk.collect.internal_sales(category="桌垫", days=90)
    ],
    concurrency=8
)
```

---

#### Step 3：过滤广告、低质量内容、重复商品、无销量样本

过滤规则：

```text
1. 标记商业广告内容。
2. 删除重复标题、重复商品、重复笔记。
3. 过滤互动极低且无评论内容。
4. 过滤无销量、无评价、无价格信息商品。
5. 过滤明显非目标类目的噪音结果。
6. 对异常高互动内容做风险标记，避免刷量误导。
```

Search Program 示例：

```python
clean_items = sdk.clean.pipeline(
    raw_items,
    steps=[
        "remove_ads",
        "dedupe_by_url_title_image",
        "filter_low_engagement",
        "filter_no_sales_products",
        "filter_off_category",
        "flag_suspicious_metrics"
    ]
)
```

---

#### Step 4：结构化抽取

抽取字段：

```text
需求：用户想解决什么问题
痛点：现有产品哪里不好
场景：在哪个生活/工作场景使用
人群：谁在使用
竞品卖点：竞品主打什么
价格：价格带与成交区间
转化证据：销量、评价、复购、加购、收藏、搜索热度
内容证据：点赞、评论、收藏、转发、达人扩散
```

Search Program 示例：

```python
evidence_items = sdk.extract.batch_extract(
    clean_items,
    schema="opportunity_evidence_v1",
    fields=[
        "demand",
        "pain_point",
        "scene",
        "persona",
        "selling_point",
        "price",
        "conversion_signal",
        "content_signal"
    ]
)
```

---

#### Step 5：按场景、人群、价格带、卖点聚类

聚类目标不是做漂亮的主题归类，而是识别可执行的经营机会。

推荐聚类维度：

```text
场景聚类：餐桌 / 书桌 / 办公桌 / 儿童桌 / 茶几
人群聚类：宝妈 / 租房党 / 办公室 / 学生 / 宠物家庭
价格带聚类：低价走量 / 中端功能 / 高端审美
卖点聚类：防水防油 / 防烫 / 无异味 / 可裁剪 / 高颜值 / 易清洁
痛点聚类：卷边 / 气味 / 发黄 / 不贴合 / 难清洁 / 尺寸不准
```

Search Program 示例：

```python
clusters = sdk.analysis.cluster_opportunities(
    evidence_items,
    dimensions=["scene", "persona", "price_band", "selling_point", "pain_point"],
    min_cluster_size=10
)
```

---

#### Step 6：判断细分市场数据不足并自动补充搜索

覆盖率判断：

```text
1. 某些场景有搜索热度，但评论样本不足。
2. 某些人群内容热度高，但淘宝商品供给不足。
3. 某些价格带销量强，但小红书内容弱。
4. 某些痛点在评论中高频，但商品卖点没有覆盖。
5. 某些风格趋势强，但内部素材库缺少可用素材。
```

Search Program 示例：

```python
gaps = sdk.analysis.detect_coverage_gaps(
    clusters,
    required_sources=["xiaohongshu", "taobao", "douyin", "comments", "rankings", "internal_sales"],
    min_valid_items_per_source=30
)

if gaps:
    backfill_queries = sdk.keywords.generate_backfill_queries(gaps)
    backfill_items = sdk.collect.parallel_backfill(backfill_queries, concurrency=6)
    clean_backfill = sdk.clean.pipeline(backfill_items)
    evidence_backfill = sdk.extract.batch_extract(clean_backfill, schema="opportunity_evidence_v1")
    evidence_items.extend(evidence_backfill)
```

---

#### Step 7：验证机会是否真实

机会验证不应只看单一信号，而应看多个信号是否共振。

验证维度：

| 维度 | 判断问题 | 例子 |
|---|---|---|
| 搜索热度 | 用户是否主动搜索 | “防油桌垫”“软玻璃桌垫”搜索增长 |
| 评论频次 | 痛点是否真实高频 | 差评中频繁出现“卷边”“味道大” |
| 竞品销量 | 市场是否已经有成交 | 同类商品月销、评价、价格带 |
| 内容互动 | 内容端是否有种草潜力 | 小红书收藏率、抖音评论率 |
| 供应链可做性 | 企业是否能做出来 | 材质、尺寸、工艺、成本、交期 |
| 竞争缺口 | 是否存在供给不足 | 高需求痛点没有被商品卖点覆盖 |

Search Program 示例：

```python
verified_opportunities = sdk.verify.opportunity_reality_check(
    clusters,
    signals=[
        "search_volume",
        "comment_frequency",
        "competitor_sales",
        "content_engagement",
        "supply_chain_feasibility",
        "competition_gap"
    ],
    scoring_profile="ecommerce_home_deco_v1"
)
```

---

#### Step 8：输出机会卡

示例机会卡：

```yaml
opportunity_title: "儿童餐桌防油防滑桌垫"
category: "桌垫"
scene: "儿童餐桌 / 家庭餐桌"
persona: "宝妈 / 有儿童家庭"
pain_points:
  - "饭菜油渍难清理"
  - "普通桌垫容易滑动"
  - "担心材质气味和安全性"
recommended_product_angle: "食品级材质 + 防滑底纹 + 易擦洗 + 无异味"
recommended_content_angle: "宝宝吃饭后 10 秒清洁对比；油渍一擦即净；桌面保护场景"
recommended_price_band: "中端价格带"
opportunity_score:
  demand_strength: 0.82
  competition_gap: 0.66
  content_heat: 0.74
  conversion_signal: 0.71
  supply_feasibility: 0.88
  overall: 0.76
recommended_actions:
  - "制作 3 条小红书场景种草内容：宝宝吃饭、油渍清洁、防滑测试"
  - "详情页增加材质安全和无异味证据"
  - "投放关键词：儿童餐桌垫 防油、防滑桌垫、宝宝吃饭桌垫"
experiment_plan:
  hypothesis: "儿童餐桌场景比通用餐桌场景有更高收藏率和转化率"
  test_group: "儿童餐桌场景主图 + 宝妈痛点文案"
  control_group: "通用防水防油桌垫主图"
  success_metrics:
    - "CTR"
    - "收藏率"
    - "加购率"
    - "CVR"
confidence: 0.76
```

---

## 6. AI-coding 实施方案

### 6.1 推荐目录结构

```text
search_as_code_business_agent/
  README.md
  pyproject.toml
  .env.example
  configs/
    sources.yaml
    scoring_profiles.yaml
    schemas.yaml
  src/
    main.py
    runtime/
      sandbox.py
      task_runner.py
      artifact_store.py
    sdk/
      keywords.py
      collect.py
      clean.py
      extract.py
      analysis.py
      verify.py
      output.py
    connectors/
      xiaohongshu.py
      taobao.py
      douyin.py
      comments.py
      rankings.py
      internal_sales.py
    models/
      task_spec.py
      search_plan.py
      raw_item.py
      evidence_item.py
      evidence_pack.py
      opportunity_card.py
    pipelines/
      opportunity_discovery.py
      product_diagnosis.py
    prompts/
      extract_evidence.md
      judge_opportunity.md
      build_card.md
    evals/
      eval_opportunity_card.py
      eval_evidence_pack.py
  data/
    raw/
    processed/
    artifacts/
    reports/
  tests/
    test_keywords.py
    test_clean.py
    test_extract.py
    test_cluster.py
    test_score.py
    test_pipeline.py
```

---

### 6.2 MVP 技术选型

| 模块 | MVP 选择 | 后续升级 |
|---|---|---|
| 语言 | Python | Python + TypeScript SDK |
| 执行 | 本地 Worker | Docker Sandbox / K8s Job |
| 数据存储 | JSONL + SQLite | Postgres + Object Storage |
| 向量检索 | FAISS / Chroma | Milvus / Elasticsearch Hybrid |
| 抽取 | LLM JSON Schema | DSPy / Guardrails / Instructor |
| 聚类 | Embedding + HDBSCAN/KMeans | 多维聚类 + 图谱 |
| 调度 | CLI | Temporal / Celery / Prefect |
| 采集 | Mock + Browser/API Adapter | Playwright / Stagehand / OpenClaw |
| 评估 | 单元测试 + 样本集 | Eval Harness + Replay |

---

### 6.3 首版 MVP 范围

MVP 不需要一次性接入所有真实平台。建议第一阶段这样做：

```text
Phase 1：离线样本跑通
- 用 CSV / JSON 模拟小红书、淘宝、抖音、评论、榜单数据
- 跑通完整 pipeline
- 输出 Evidence Pack 和 Opportunity Card

Phase 2：接入 1-2 个真实数据源
- 先接淘宝商品数据或内部商品数据
- 再接小红书内容采集
- 验证机会卡质量

Phase 3：接入执行与复盘
- 机会卡转内容任务
- 机会卡转投放任务
- 回流 CTR / CVR / GMV / ROI
- 优化评分模型
```

---

### 6.4 AI-coding 任务提示词

可以直接把下面内容交给 AI-coding 工具：

```text
你是资深 Python 后端与 Agent Runtime 工程师。
请基于本技术报告，实现一个 Search as Code Business Agent MVP。

目标：
实现桌垫类目机会发现 pipeline，输入类目和业务目标，输出 Evidence Pack 和 Opportunity Cards。

实现要求：
1. 使用 Python。
2. 按报告中的目录结构创建工程。
3. 使用 Pydantic 定义 TaskSpec、SearchPlan、RawItem、EvidenceItem、EvidencePack、OpportunityCard。
4. 先用本地 sample JSON/CSV 模拟小红书、淘宝、抖音、竞品评论、平台榜单数据。
5. 实现 keyword expansion、parallel collection mock、cleaning、extraction mock、clustering、gap detection、opportunity scoring、card generation。
6. 所有中间结果保存到 data/artifacts。
7. 提供 CLI：
   python -m src.main --category 桌垫 --goal "发现未来30天增长机会"
8. 输出：
   - evidence_pack.json
   - opportunity_cards.json
   - opportunity_report.md
9. 编写单元测试。
10. README 中写清楚如何运行。

验收标准：
1. 命令行可以一键运行。
2. 至少生成 3 张机会卡。
3. 每张机会卡必须包含：场景、人群、痛点、卖点、价格带、证据摘要、评分、动作建议、实验计划。
4. Evidence Pack 中必须保留每个结论对应的原始证据 ID。
5. 所有输出结构化、可回放、可扩展。
```

---

## 7. 评估指标

### 7.1 Pipeline 技术指标

| 指标 | 定义 | 目标 |
|---|---|---|
| pipeline_success_rate | pipeline 是否成功完成 | > 95% |
| source_coverage | 数据源覆盖率 | > 80% |
| evidence_binding_rate | 结论是否绑定证据 | > 90% |
| duplicate_rate | 重复样本比例 | < 10% |
| extraction_validity | 抽取字段合法率 | > 90% |
| card_schema_pass_rate | 机会卡 schema 通过率 | 100% |

---

### 7.2 业务质量指标

| 指标 | 定义 |
|---|---|
| opportunity_relevance | 机会是否与类目和目标强相关 |
| evidence_sufficiency | 证据是否足够支撑结论 |
| actionability | 动作是否能被运营、商品、内容、投放团队执行 |
| novelty | 是否发现非显而易见机会 |
| feasibility | 供应链和组织是否能承接 |
| expected_uplift | 对 CTR、CVR、GMV、ROI 的潜在提升 |

---

### 7.3 复盘指标

机会卡进入执行后，需要回流：

```text
内容侧：曝光、点击、互动、收藏、评论、转粉
商品侧：CTR、CVR、加购、收藏、成交、退款率
投放侧：CPC、CTR、CVR、ROI、GMV
供应链侧：打样周期、成本、交期、质量问题
```

这些数据用于优化：

```text
关键词扩展策略
数据源权重
机会评分权重
证据充分性阈值
动作模板
实验设计
```

---

## 8. 风险与边界

### 8.1 数据合规风险

采集外部平台数据必须遵守平台规则、robots 协议、账号权限和公司合规要求。对于敏感平台，优先使用官方 API、授权数据、内部业务数据或人工导出的合规数据。

### 8.2 证据误判风险

内容热度不等于成交机会，评论高频不等于真实市场规模，竞品销量也可能受刷量、价格战、平台活动影响。因此机会验证必须采用多信号共振，而不是单点判断。

### 8.3 Agent 代码执行风险

Agent 生成代码必须运行在受控沙箱中。首版可以限制为预定义 DSL 或预定义 SDK 调用，不允许任意网络访问和任意系统命令。

### 8.4 业务泛化风险

桌垫场景跑通后，不代表所有类目都可直接复用。需要抽象出类目配置层，包括关键词维度、价格带定义、供应链约束、平台权重、机会评分 profile。

---

## 9. 结论

Search as Code 对经营增长 OS 的核心价值，是把“搜索”从一个工具升级为一套可编程、可审计、可验证、可复盘的信息获取与证据计算基础设施。

在经营洞察规划场景中，它可以帮助系统完成：

```text
多维关键词生成
多平台并发采集
低质量数据过滤
结构化证据抽取
多维聚类与缺口发现
自动补充搜索
机会真实性验证
机会卡与行动计划生成
执行结果回流
```

这使得经营增长 Agent 不再只是“会总结资料”，而是能够围绕经营目标主动组织信息、验证证据、形成决策，并持续通过业务结果优化自身。

最终，SaC 应该成为经营增长 OS 的核心中间层：

```text
Data Platform + Knowledge Base + Agent Runtime + Evidence Pack + Eval Loop
```

它连接数据、知识、策略、执行和复盘，是从“报告型 AI”走向“经营决策与执行型 Agent”的关键路径。

---

## 10. 参考资料

1. Perplexity Research, “Rethinking Search as Code Generation”, 2026-06-01.
2. Ryen W. White, “Advancing the Search Frontier with AI Agents”, arXiv, 2023.
3. Qianben Chen et al., “Search More, Think Less: Rethinking Long-Horizon Agentic Search for Efficiency and Generalization”, arXiv, 2026.
4. Tz-Huan Hsu, Jheng-Hong Yang, Jimmy Lin, “Rethinking Agentic Search with Pi-Serini: Is Lexical Retrieval Sufficient?”, arXiv, 2026.
