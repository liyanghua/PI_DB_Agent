# 关键词需求分类与强度计算 Baseline / MVP1 规范

> 版本：v1.0  
> 定位：电商商机洞察关键词模块的 MVP1 Baseline  
> 目标：给定一个品类，基于关键词核心指标，完成关键词需求分类、需求强度计算、类目 TOP 词挖掘，并输出可进入后续 Opportunity / GAP / Action 链路的基础结果。

---

## 0. 核心结论

这就是关键词模块的 **MVP1 Baseline**。

MVP1 不追求复杂模型、不依赖 BERTopic / KeyBERT / HDBSCAN 等语义聚类能力，而是先跑通：

```text
给定品类
→ 拉取关键词数据
→ 规则分类关键词
→ 计算 KDS 需求强度
→ 按需求分类排序
→ 挖掘类目 TOP 词
→ 输出需求分类词表和候选机会词
```

MVP1 的目标不是直接生成最终机会，而是建立一个可解释、可复用、可评估的 **关键词需求强度底座**。

当前实现已满足第一版硬要求：

- 任意品类名称输入。
- 支持按品类名直接跑分析，不要求用户先提供类目 id。
- 输出关键词需求分类下按照需求强度（KDS）的 TOP 排名。
- 蓝海词作为辅助榜输出，不混入主榜机会池。

---

# 1. MVP1 Baseline 要解决什么问题

## 1.1 输入问题

给定一个品类，例如：

```text
入户地垫
桌布
沙发垫
门帘
窗帘
```

系统需要回答：

```text
1. 这个品类里哪些关键词需求最强？
2. 这些关键词分别属于什么需求类型？
3. 每类需求下 TOP 词是什么？
4. 哪些词是规模词？
5. 哪些词是增速词？
6. 哪些词是高转化词？
7. 哪些词适合标题承接？
8. 哪些词适合主图 / 详情页证明？
9. 哪些词只能作为观察或补证？
```

---

## 1.2 输出结果

MVP1 输出四类结果：

```text
1. Keyword Score Table
   每个关键词的规模、增速、流量、转化、KDS 分数。

2. Keyword Demand Type Table
   每个关键词的需求分类标签。

3. Category Top Keywords
   给定品类下的总 TOP 词、各需求分类 TOP 词。

4. Baseline Opportunity Signals
   候选需求簇、候选 GAP 类型、推荐下一步补证方向。

补充：第一版里 “Category Top Keywords” 的主排序口径就是 KDS，TOP 榜过滤 transaction_block、纯品类词与无具体诉求词。
```

---

# 2. MVP1 和后续版本的边界

## 2.1 MVP1 做什么

MVP1 做：

```text
关键词拉取
关键词清洗
规则分类
KDS 计算
类目 TOP 词排序
需求类型汇总
基础机会信号输出
```

MVP1 不做：

```text
复杂语义聚类
自动需求簇命名
原始评论语义抽取
竞品主图理解
Action Recipe 生成
完整机会状态机裁决
```

---

## 2.2 版本演进

| 版本 | 能力 | 技术 |
|---|---|---|
| MVP1 Baseline | 给定品类，基于关键词指标计算需求分类和需求强度，挖掘 TOP 词 | 规则分类 + KDS 公式 |
| MVP2 Semantic | 同义词归并、需求簇聚类、关键词语义扩展 | sentence-transformers + HDBSCAN |
| MVP3 Insight | 需求簇解释、评论/问大家语义抽取、机会卡生成 | KeyBERT / BERTopic / LLM |
| MVP4 Action | GAP 诊断、动作配方、实验计划 | Action Strategy Compiler |

---

# 3. MVP1 数据输入

## 3.1 必须输入

```yaml
input:
  category:
    tertiary_category: "入户地垫"
  date_range:
    start_date: "2026-06-01"
    end_date: "2026-06-07"
  top_n:
    overall: 100
    per_demand_type: 20
```

---

## 3.2 推荐接口

MVP1 只需要优先使用关键词相关接口。

### P0 接口

| 接口 | 用途 | 核心字段 |
|---|---|---|
| `/agent/sycm_keyword` | 生意参谋关键词 | `keywords`, `search_popularity`, `click_rate`, `pay_rate`, `search_growth_rate` |
| `/agent/blue_ocean_keywords_analysis` | 蓝海关键词 | `keywords`, `search_popularity`, `search_popularity_mom`, `search_popularity_yoy`, `click_rate`, `pay_rate`, `pay_buyers`, `demand_supply_ratio` |
| `/data/keyword/trend` | 类目词根趋势 | `keywords`, `search_value`, `search_value_trend`, `requirement_prop`, `business_date` |
| `/data/blue_keyword_7d_v2` | 近 7 天蓝海词 | `keywords`, `pay_buyers`, `click_rate`, `search_popularity_mom`, `search_popularity_yoy`, `demand_supply_ratio`, `pay_rate`, `relation_strength` |
| `/data/ads_industry_keywords_summary_m` | 月度关键词 | `keywords`, `search_popularity`, `click_rate`, `demand_supply_ratio`, `pay_buyers_count`, `pay_rate` |
| `/data/ads_industry_keywords_7d` | 近 7 天关键词 | 近 7 天关键词趋势指标 |

---

## 3.3 可选增强接口

| 接口 | 用途 | 何时使用 |
|---|---|---|
| `/agent/taotian_comment_keywords` | 评论关键词 | 需要验证关键词是否来自用户评价 |
| `/product_question_content2` | 问大家 | 需要识别购买前顾虑 |
| `/product_comment_content2` | 差评 | 需要识别痛点和反证 |
| `/get_positive_comment_data` | 好评 | 需要识别已满足需求 |
| `/data/media/ads_ind_social_media_persona_groups` | 社媒人群和需求 | 需要加入内容端 demand signal |

---

# 4. 标准数据模型

## 4.1 KeywordMetricRecord

```json
{
  "keyword": "入户门防滑吸水地垫",
  "category": "入户地垫",
  "source": ["sycm_keyword", "blue_keyword_7d_v2"],
  "date_range": {
    "start_date": "2026-06-01",
    "end_date": "2026-06-07"
  },
  "metrics": {
    "search_popularity": 13000,
    "search_index": null,
    "search_value": null,
    "search_growth_rate": 0.18,
    "search_popularity_mom": 0.16,
    "search_popularity_yoy": 0.42,
    "click_rate": 0.12,
    "pay_rate": 0.08,
    "pay_buyers": 1728,
    "demand_supply_ratio": 2.4,
    "conversion_rate": null,
    "tmall_click_share": null
  }
}
```

---

## 4.2 KeywordClassificationRecord

```json
{
  "keyword": "入户门防滑吸水地垫",
  "types": ["category", "scene", "function"],
  "type_confidence": {
    "category": 0.98,
    "scene": 0.92,
    "function": 0.95
  },
  "matched_terms": {
    "category": ["地垫"],
    "scene": ["入户门"],
    "function": ["防滑", "吸水"]
  },
  "intent_clarity_multiplier": 1.15
}
```

---

## 4.3 KeywordScoreRecord

```json
{
  "keyword": "入户门防滑吸水地垫",
  "category": "入户地垫",
  "scores": {
    "scale_score": 82.0,
    "growth_score": 76.0,
    "traffic_score": 70.0,
    "conversion_score": 79.0,
    "base_kds": 76.95,
    "intent_clarity_multiplier": 1.15,
    "kds": 88.49
  },
  "rank": {
    "overall_rank": 3,
    "category_type_rank": {
      "function": 1,
      "scene": 2
    }
  },
  "decision": {
    "kds_level": "strong_demand",
    "opportunity_hint": "candidate_opportunity",
    "next_step": "gap_diagnosis"
  }
}
```

---

# 5. 关键词需求分类 Baseline

## 5.1 分类体系

MVP1 使用规则分类器，支持多标签。

| 类型 | 定义 | 示例 |
|---|---|---|
| category | 品类词 | 地垫、门垫、脚垫、桌布、窗帘 |
| scene | 场景词 | 入户、玄关、厨房、浴室、卧室、宠物 |
| function | 功能词 | 防滑、吸水、耐脏、刮泥、防水、遮光 |
| spec | 规格词 | 可裁剪、不卡门、厚度、尺寸、加厚 |
| style | 风格词 | 奶油风、轻奢、高级感、可爱、简约 |
| price | 价格词 | 便宜、平价、高端、性价比 |
| brand | 品牌词 | 品牌名、同款词 |
| transaction_block | 交易阻塞词 | 链接、哪里买、多少钱、尺寸表 |
| pain | 痛点词 | 色差、异味、掉毛、滑、难清洗 |
| population | 人群词 | 新家装修、宝妈、宠物家庭、租房党 |
| season | 季节词 | 雨季、冬天、春节、开学 |
| channel | 平台词 | 小红书同款、抖音爆款 |

---

## 5.2 规则分类逻辑

```python
def classify_keyword(keyword, taxonomy):
    labels = []
    matched_terms = {}

    for label, terms in taxonomy.items():
        hits = [t for t in terms if t in keyword]
        if hits:
            labels.append(label)
            matched_terms[label] = hits

    if not labels:
        labels = ["unknown"]

    return labels, matched_terms
```

---

## 5.3 分类输出原则

```text
1. 一个关键词可以有多个标签；
2. 分类结果必须保留命中的词；
3. 未命中规则的词进入 unknown；
4. unknown 不进入核心机会池，只进入待人工确认池；
5. transaction_block 不进入功能需求强度计算；
6. brand 单独进入竞品 / 截流策略，不进入通用需求池。
```

---

# 6. KDS 需求强度计算 Baseline

## 6.1 总公式

```text
BaseKDS =
0.30 × ScaleScore
+ 0.25 × GrowthScore
+ 0.20 × TrafficScore
+ 0.25 × ConversionScore

KDS =
BaseKDS × IntentClarityMultiplier
```

最终：

```text
KDS = clamp(KDS, 0, 100)
```

---

## 6.2 ScaleScore：规模分

### 公式

```text
ScaleScore =
0.70 × PctRank(search_popularity)
+ 0.30 × PctRank(pay_buyers)
```

### 缺失字段降级

如果缺少 `pay_buyers`：

```text
ScaleScore =
0.85 × PctRank(search_popularity)
+ 0.15 × PctRank(click_rate)
```

如果缺少 `search_popularity`，但有 `search_index`：

```text
search_popularity = search_index
```

如果缺少 `search_popularity`，但有 `search_value`：

```text
search_popularity = search_value
```

---

## 6.3 GrowthScore：增速分

### 公式

```text
GrowthScore =
0.40 × MomGrowthScore
+ 0.30 × YoYGrowthScore
+ 0.20 × TrendSlopeScore
+ 0.10 × PayBuyerGrowthScore
```

### 子项

```text
MomGrowthScore = Norm(search_popularity_mom or search_growth_rate)
YoYGrowthScore = Norm(search_popularity_yoy)
TrendSlopeScore = Norm(slope(last_7d_or_30d_search_popularity))
PayBuyerGrowthScore = Norm(pay_buyers_mom or pay_buyers_yoy)
```

### 降级版

如果只有 `search_growth_rate`：

```text
GrowthScore = PctRank(search_growth_rate)
```

如果只有 `search_popularity_mom`：

```text
GrowthScore = PctRank(search_popularity_mom)
```

如果没有任何增长字段：

```text
GrowthScore = 50
```

解释：无增长数据时按中性分处理，不让总分完全失真。

---

## 6.4 TrafficScore：流量点击分

### 公式

```text
TrafficScore =
0.60 × PctRank(click_rate)
+ 0.25 × PctRank(search_visitors)
+ 0.15 × PctRank(tmall_click_share)
```

### 降级版

如果只有关键词接口：

```text
TrafficScore =
0.80 × PctRank(click_rate)
+ 0.20 × PctRank(search_popularity)
```

如果没有 `click_rate`：

```text
TrafficScore = 50
```

---

## 6.5 ConversionScore：转化分

### 公式

```text
ConversionScore =
0.50 × PctRank(pay_rate)
+ 0.30 × PctRank(pay_buyers)
+ 0.20 × PctRank(conversion_rate)
```

### 降级版

如果没有 `conversion_rate`：

```text
ConversionScore =
0.60 × PctRank(pay_rate)
+ 0.40 × PctRank(pay_buyers)
```

如果只有 `pay_rate`：

```text
ConversionScore = PctRank(pay_rate)
```

如果没有转化字段：

```text
ConversionScore = 50
```

---

## 6.6 IntentClarityMultiplier：需求明确度系数

| 标签组合 | 系数 |
|---|---:|
| category only | 0.85 |
| scene | 1.00 |
| function | 1.05 |
| spec | 1.10 |
| scene + function | 1.15 |
| scene + spec | 1.15 |
| function + spec | 1.15 |
| scene + function + spec | 1.20 |
| style | 0.90 |
| price | 0.95 |
| brand | 0.80 |
| transaction_block | 不计算功能 KDS |

### 计算规则

```python
def intent_multiplier(labels):
    s = set(labels)

    if "transaction_block" in s:
        return None

    if "scene" in s and "function" in s and "spec" in s:
        return 1.20

    if "scene" in s and "function" in s:
        return 1.15

    if "scene" in s and "spec" in s:
        return 1.15

    if "function" in s and "spec" in s:
        return 1.15

    if "spec" in s:
        return 1.10

    if "function" in s:
        return 1.05

    if "scene" in s:
        return 1.00

    if "price" in s:
        return 0.95

    if "style" in s:
        return 0.90

    if "brand" in s:
        return 0.80

    return 0.85
```

---

# 7. 类目 TOP 词挖掘

## 7.1 总 TOP 词

给定品类后，计算所有关键词 KDS，输出：

```text
Top Overall Keywords = 按 KDS 降序取 Top N
```

输出字段：

```json
{
  "rank": 1,
  "keyword": "入户门防滑吸水地垫",
  "types": ["category", "scene", "function"],
  "kds": 88.49,
  "scale_score": 82,
  "growth_score": 76,
  "traffic_score": 70,
  "conversion_score": 79,
  "reason": "规模高、转化强、场景+功能明确"
}
```

---

## 7.2 按需求分类 TOP 词

每个需求类型单独排序。

```text
Top Category Words
Top Scene Words
Top Function Words
Top Spec Words
Top Style Words
Top Price Words
Top Pain Words
```

示例：

```json
{
  "demand_type": "function",
  "top_keywords": [
    {
      "keyword": "防滑吸水地垫",
      "kds": 86.2,
      "scale_score": 80,
      "growth_score": 78,
      "traffic_score": 72,
      "conversion_score": 84
    }
  ]
}
```

---

## 7.3 四象限 TOP 词

除了总分排序，还要输出四种经营视角：

### 规模 TOP 词

```text
按 ScaleScore 排序
```

用于：

```text
标题核心词
投放核心词
类目大盘词
```

### 增速 TOP 词

```text
按 GrowthScore 排序
```

用于：

```text
新品机会
趋势机会
季节机会
内容选题
```

### 流量 TOP 词

```text
按 TrafficScore 排序
```

用于：

```text
主图点击测试
搜索承接
投流入口
```

### 转化 TOP 词

```text
按 ConversionScore 排序
```

用于：

```text
标题长尾词
精准投放词
详情页证明词
SKU 承接词
```

---

## 7.4 蓝海 TOP 词

如果有 `demand_supply_ratio`，计算蓝海分：

```text
BlueOceanScore =
0.45 × PctRank(demand_supply_ratio)
+ 0.25 × PctRank(pay_buyers)
+ 0.20 × PctRank(search_popularity_mom)
+ 0.10 × PctRank(pay_rate)
```

输出：

```text
Top Blue Ocean Keywords
```

解释：

```text
供需比高 + 支付买家高 + 增长高 + 转化不差
= 优先进入蓝海机会池
```

---

# 8. Baseline 输出文件

## 8.1 keyword_scores.json

```json
[
  {
    "keyword": "入户门防滑吸水地垫",
    "types": ["category", "scene", "function"],
    "scores": {
      "scale_score": 82,
      "growth_score": 76,
      "traffic_score": 70,
      "conversion_score": 79,
      "base_kds": 76.95,
      "intent_clarity_multiplier": 1.15,
      "kds": 88.49
    },
    "level": "strong_demand"
  }
]
```

---

## 8.2 category_top_keywords.json

```json
{
  "category": "入户地垫",
  "date_range": "2026-06-01~2026-06-07",
  "top_overall": [],
  "top_by_type": {
    "category": [],
    "scene": [],
    "function": [],
    "spec": [],
    "style": [],
    "price": [],
    "pain": []
  },
  "top_by_metric": {
    "scale": [],
    "growth": [],
    "traffic": [],
    "conversion": [],
    "blue_ocean": []
  }
}
```

---

## 8.3 keyword_baseline_report.md

报告必须包含：

```text
1. 品类总览
2. TOP 总榜
3. 按需求类型 TOP 词
4. 按规模 / 增速 / 流量 / 转化 TOP 词
5. 蓝海词榜
6. 高潜机会词
7. 待补证词
8. 噪音词 / 排除词
9. 下一步 GAP 诊断建议
```

---

# 9. MVP1 状态判断

## 9.1 KDS 分层

| KDS 分数 | 判断 | 状态 |
|---:|---|---|
| 85-100 | 强需求词 | strong_demand |
| 70-85 | 有效需求词 | candidate_demand |
| 55-70 | 待验证词 | proof_ready |
| 40-55 | 观察词 | observe |
| <40 | 噪音词 | reject |

---

## 9.2 进入后续链路的条件

### 进入 Opportunity Candidate

```text
KDS >= 70
且 keyword_type 不只是 category
且不是 transaction_block
```

### 进入 Proof Ready

```text
55 <= KDS < 70
或 growth_score >= 80 但 scale_score < 50
或 style 词高热但 conversion_score 不足
```

### 进入 Purchase Entry Gap

```text
keyword_type 包含 transaction_block
例如：链接、哪里买、多少钱、尺寸表
```

### 进入 Reject

```text
KDS < 40
或 unknown 且无指标支撑
或 brand 词但非当前策略目标
```

---

# 10. MVP1 验收标准

## 10.1 功能验收

必须实现：

```text
1. 输入品类，拉取关键词数据；
2. 输出关键词统一表；
3. 对关键词做多标签分类；
4. 计算 Scale / Growth / Traffic / Conversion；
5. 计算 KDS；
6. 输出类目 TOP 总榜；
7. 输出各需求分类 TOP 词；
8. 输出规模 / 增速 / 流量 / 转化 TOP 词；
9. 输出蓝海 TOP 词；
10. 输出可进入 Opportunity 的候选词。
```

---

## 10.2 质量验收

必须满足：

```text
1. TOP 词不能全是泛品类词；
2. 功能词、场景词、规格词必须可单独排序；
3. 搜索高但转化低的词不能被误判为强需求；
4. 问链接类词不能进入功能需求；
5. 增速极高但规模极低的词不能直接进入 scale；
6. 每个分数必须能追溯字段来源；
7. 每个关键词必须能解释为什么排名靠前。
```

---

## 10.3 Baseline 成功标准

MVP1 成功的标准不是“机会判断完全准确”，而是：

```text
1. 能稳定生成给定品类的关键词需求地图；
2. 能区分规模词、趋势词、转化词、蓝海词；
3. 能按需求类型给出 TOP 词；
4. 能为后续 GAP 诊断提供候选词；
5. 能显著减少人工看词和筛词时间。
```

---

# 11. 推荐目录结构

```text
keyword_baseline_mvp1/
  config/
    keyword_taxonomy.yaml
    kds_weights.yaml
    field_mapping.yaml
  src/
    fetch_keywords.py
    normalize_keywords.py
    classify_keywords.py
    score_kds.py
    rank_top_keywords.py
    export_report.py
  schemas/
    keyword_metric_record.schema.json
    keyword_score_record.schema.json
    category_top_keywords.schema.json
  outputs/
    keyword_scores.json
    category_top_keywords.json
    keyword_baseline_report.md
  tests/
    test_classification.py
    test_kds.py
    test_transaction_block.py
    test_top_keywords.py
```

---

# 12. 一句话定义

```text
MVP1 Baseline =
给定品类，基于关键词规模、增速、流量、转化四类指标，
结合经营需求分类规则，
计算关键词需求强度，
挖掘类目 TOP 词和各需求分类 TOP 词，
为后续 Opportunity / GAP / Action 生成提供候选输入。
```

---

# 13. 从 KDS Baseline 到关键词洞察框架

## 13.1 升级定位

KDS Baseline 解决的是“哪些关键词需求更强、各需求分类下 TOP 词是谁”。它是关键词分析的强度排序底座，但不是完整经营决策框架。

关键词洞察框架在 KDS 之上补充四类证据：

```text
KDS             判断需求强度和需求分类 TOP 排名
词根            解释需求由哪些核心词根构成
趋势            判断哪些需求正在变热、哪些只是短期波动
付费            判断哪些词适合放量、优化、否词、拓词
关键词元素分析  提炼卖点、内容主题、视觉/主图方向
```

因此，后续关键词分析报告必须同时回答两类问题：

```text
1. 需求强不强：由 KDS 回答。
2. 应该做什么：由词根 / 趋势 / 付费 / 元素洞察共同回答。
```

## 13.2 baseline_v1 口径保持不变

本轮升级不调整 `baseline_v1` 的 KDS 权重和主公式。

```text
base_kds = scale * 0.30 + growth * 0.25 + traffic * 0.20 + conversion * 0.25
kds = base_kds * intent_multiplier
```

新增数据源优先用于：

- 补齐 KDS 所需字段，减少 fallback。
- 补充真实需求分类证据。
- 生成词根、趋势、付费、元素洞察。
- 生成老品优化、新品开发、内容种草、付费投流建议。
- 告诉用户哪些维度缺数据、哪些结论是降级判断。

## 13.3 接口分层

| 数据层 | 接口 | 进入 KDS 主公式 | 主要用途 |
| --- | --- | --- | --- |
| KDS 主链 | `/agent/sycm_keyword` | 是 | 搜索人气、点击率、支付率、搜索增长率 |
| KDS 主链 | `/agent/blue_ocean_keywords_analysis` | 是 | 蓝海词、环比、同比、支付买家、供需比 |
| KDS 主链 | `/data/blue_keyword_7d_v2` | 是 | 近 7 天蓝海词、供需比、支付买家、关联强度 |
| KDS 主链 | `/data/ads_industry_keywords_summary_m` | 是 | 月度关键词、支付买家、供需比 |
| KDS 主链 | `/data/ads_industry_keywords_7d` | 是 | 近 7 天行业关键词趋势字段 |
| KDS 主链 | `/data/ind/category_keywords_detail_v2` | 是 | 类目搜索词明细，补规模、增长、流量、转化字段 |
| 需求分类层 | `/data/keyword/category_requirements` | 间接 | 真实需求分类、搜索值、需求占比 |
| 需求分类层 | `/data/keyword/category_requirements_v2` | 间接 | 需求分类 v2、词根标题、父级分类 |
| 词根层 | `/keywords_analysis` | 否 | 词根需求分析、词根聚合 |
| 词根层 | `/agent/keyword` | 否 | 词根入口与词根候选 |
| 趋势层 | `/data/keyword/trend` | 间接 | 词根趋势、需求分类趋势 |
| 趋势层 | `/data/bluekeyword/trend` | 否 | 关键词趋势明细 |
| 元素层 | `/data/keywords_element_d` | 否 | 类目关键词元素总结、卖点和内容建议 |
| 付费层 | `/agent/xiaowan_keywords` | 否 | 直通车/投流关键词补充 |
| 付费层 | `/data/cust/ads_ad_flow_plan_goods_keyword_7d` | 否 | 付费关键词点击、转化、花费、投放效果 |
| 类目解析层 | `/data/keywords/category_list` | 否 | 任意品类名称到类目 id 的反查 |

说明：

- “进入 KDS 主公式”表示该接口的字段可参与 scale / growth / traffic / conversion 的字段合并。
- “间接”表示接口不改变 KDS 公式，但可影响分类、字段覆盖、趋势解释或 fallback 说明。
- “否”表示作为洞察证据，不直接改变 KDS 分数。

## 13.4 洞察模块

| 模块 | 输入证据 | 输出 | 服务决策 |
| --- | --- | --- | --- |
| `demand_strength_insight` | KDS、需求分类、字段覆盖 | 需求分类下 KDS TOP 排名 | 判断主流需求和优先级 |
| `root_insight` | 词根、搜索值、需求占比、KDS | 词根 TOP、词根需求类型、词根动作 | 标题优化、新品方向、产品结构 |
| `trend_insight` | 搜索增长、环比、同比、趋势字段 | 强趋势、潜力趋势、伪趋势、活动型趋势 | 新品测试、内容种草、趋势跟进 |
| `paid_insight` | 付费点击、转化、花费、UV 价值 | 放量词、亏损词、低效词、拓词机会 | 付费投流、否词、预算调整 |
| `element_insight` | `summary`、`suggestion`、关键词元素 | 卖点、内容主题、视觉/主图方向 | 内容种草、主图策划、详情页卖点 |
| `action_recommendation` | 上述所有模块 | 老品优化、新品开发、内容种草、付费投流建议 | 经营动作落地 |

## 13.5 任意品类分析的必输出

给定任意品类名称，系统必须输出：

```text
1. 数据源审计：候选接口、哪些有数据、哪些为空、哪些解析失败。
2. 字段完整度：规模、增长、流量、转化、需求分类各缺什么。
3. KDS 主榜：需求强度 TOP 关键词。
4. 需求分类榜：每个需求分类下按 KDS 排名。
5. 词根洞察：词根 TOP、需求类型、适合的标题/产品动作。
6. 趋势洞察：增长最快需求、趋势等级、是否建议立项或观察。
7. 付费洞察：放量词、低效词、拓词和否词建议。
8. 元素洞察：内容主题、卖点方向、主图/详情页表达方向。
9. 动作建议：老品优化、开新品、内容种草、付费投流四类建议。
```

如果某类数据缺失，报告必须显式说明：

```text
该模块未出数 / 字段缺失 / 使用 fallback / 结论可信度降低
```

不能把缺数据的判断伪装成完整结论。

## 13.6 商品级增强边界

关键词洞察默认是类目级分析，不要求用户提供商品 ID。

当用户提供 `goods_id_list` 或 `user_id_list` 时，系统可增加商品级承接诊断：

| 输入 | 增强能力 |
| --- | --- |
| 只输入品类 | 输出类目级需求、词根、趋势、付费、元素和动作方向 |
| 输入品类 + `goods_id_list` | 判断指定商品是否承接需求词、词根、卖点、场景、人群 |
| 输入品类 + `user_id_list` | 判断客户侧付费关键词表现和投放优化方向 |

没有商品级数据时：

- 可以给老品优化方向。
- 不能声称已经判断某个具体链接“已承接 / 未承接”。
- 报告中必须写明“商品级承接诊断未开启”。

## 13.7 后续实现任务拆分

| 任务 | 目标 |
| --- | --- |
| 文档规范 | 完成关键词洞察框架、接口分层、输出结构、验收标准 |
| 接口映射 | 扩展 `keyword_field_mapping.yaml`，接入主链和扩展接口 |
| 响应解析 | 支持分页对象、`kw_name`、`title`、`category_requirements` 等关键词字段 |
| 洞察聚合 | 新增词根、趋势、付费、元素、动作建议聚合模块 |
| 报告输出 | 增加数据完整度、洞察模块和四类动作建议章节 |
| 前端验收 | 在页面展示 KDS、分类榜、接口审计、缺失维度和洞察区块 |
