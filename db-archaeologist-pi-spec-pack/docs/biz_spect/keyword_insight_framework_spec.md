# 关键词洞察框架规范

> 版本：v1.0  
> 定位：关键词分析从 KDS 排名升级为经营决策洞察框架  
> 目标：给定任意品类，输出需求强度、词根、趋势、付费、关键词元素和动作建议，服务老品优化、新品开发、内容种草、付费投流。

---

## 0. 核心定义

关键词洞察框架不是只找“搜索人气高的词”，而是回答：

```text
用户在搜什么需求？
哪些需求最强？
哪些需求正在变热？
这些需求由哪些词根构成？
哪些词适合自然搜索、内容种草、付费投流？
老品应该优化哪里？
新品应该切入哪个人群、场景、功能、风格？
```

KDS 是框架里的需求强度层：

```text
KDS = 规模 + 增长 + 流量 + 转化 + 需求意图加成
```

词根、趋势、付费、关键词元素是洞察层：

```text
词根：解释需求结构
趋势：判断机会是否正在起来
付费：判断流量投放是否值得放量或优化
关键词元素：提炼卖点、内容主题、视觉表达方向
```

最终输出必须能指导四类动作：

```text
老品优化
新品开发
内容种草
付费投流
```

---

## 1. 输入边界

## 1.1 类目级默认输入

任意品类名称是默认入口。

```json
{
  "category": "沙发套",
  "date_range": {
    "start_date": "2026-06-13",
    "end_date": "2026-06-20"
  }
}
```

系统必须自动完成类目解析、接口拉取、字段归一、KDS 计算、洞察生成。

## 1.2 商品级增强输入

当用户提供商品或客户信息时，系统增加承接诊断和投流诊断。

```json
{
  "category": "沙发套",
  "goods_id_list": ["896924077268"],
  "user_id_list": ["1983420822379380738"],
  "recommendation_targets": ["old_product", "new_product", "content", "paid"]
}
```

规则：

- 没有 `goods_id_list` 时，只输出类目级老品优化方向。
- 有 `goods_id_list` 时，才能判断具体商品标题、主图、详情、SKU 是否承接。
- 有 `user_id_list` 时，才能输出客户侧付费关键词表现诊断。

---

## 2. 数据层分组

## 2.1 接口分层表

| 数据层 | 接口 | 核心字段 | 用途 |
| --- | --- | --- | --- |
| KDS 主链 | `/agent/sycm_keyword` | `keywords`, `search_popularity`, `click_rate`, `pay_rate`, `search_growth_rate` | 基础关键词规模、流量、转化、增长 |
| KDS 主链 | `/agent/blue_ocean_keywords_analysis` | `keywords`, `search_popularity_mom`, `search_popularity_yoy`, `pay_buyers`, `demand_supply_ratio` | 蓝海和增长证据 |
| KDS 主链 | `/data/blue_keyword_7d_v2` | `keywords`, `pay_buyers`, `demand_supply_ratio`, `relation_strength` | 近 7 天蓝海和供需 |
| KDS 主链 | `/data/ads_industry_keywords_summary_m` | `keywords`, `pay_buyers_count`, `demand_supply_ratio`, `pay_rate` | 月度行业关键词补证 |
| KDS 主链 | `/data/ads_industry_keywords_7d` | 近 7 天趋势指标 | 增长和趋势补证 |
| 搜索明细 | `/data/ind/category_keywords_detail_v2` | `keywords`, `pay_buyers_start`, `pay_buyers_end`, `tmall_click_share`, `demand_supply_ratio` | 搜索词明细，优先补 KDS 字段 |
| 搜索明细 | `/data/ind/category_keywords_detail` | `keywords`, `click_rate`, `search_popularity_for_rank` | 搜索明细旧版兜底 |
| 需求分类 | `/data/keyword/category_requirements` | `category_requirements`, `search_value`, `requirement_prop` | 真实需求分类和需求占比 |
| 需求分类 | `/data/keyword/category_requirements_v2` | `title`, `parent_name`, `search_value`, `requirement_prop` | 需求分类 v2 和词根标题 |
| 词根 | `/keywords_analysis` | `category_requirements`, 词根相关字段 | 词根需求分析 |
| 词根 | `/agent/keyword` | 词根候选字段 | 词根入口 |
| 趋势 | `/data/keyword/trend` | `search_value_trend`, `requirement_prop`, `business_date` | 词根/需求分类趋势 |
| 趋势 | `/data/bluekeyword/trend` | 关键词趋势字段 | 关键词趋势分析 |
| 元素 | `/data/keywords_element_d` | `summary`, `suggestion`, `cate_name` | 类目关键词元素、卖点和内容方向 |
| 付费 | `/agent/xiaowan_keywords` | 直通车关键词字段 | 付费关键词补充 |
| 付费 | `/data/cust/ads_ad_flow_plan_goods_keyword_7d` | `kw_name`, `clk_trans_rate`, `uv_value`, `tras_cost`, `pay_cnt` | 付费投流关键词表现 |
| 类目解析 | `/data/keywords/category_list` | 类目 id / 类目名 | 任意品类名称反查 |

## 2.2 数据进入规则

| 数据 | 是否影响 KDS 分数 | 说明 |
| --- | --- | --- |
| KDS 主链字段 | 是 | 参与 scale / growth / traffic / conversion 字段合并 |
| 真实需求分类 | 间接 | 优先决定需求分类榜，不改变 KDS 权重 |
| 词根 | 否 | 用于解释需求结构和生成动作 |
| 趋势 | 间接 | 可补 growth 字段，也用于趋势洞察 |
| 付费 | 否 | 用于投流决策，不直接改变自然搜索 KDS |
| 关键词元素 | 否 | 用于卖点、内容、视觉建议 |

---

## 3. 洞察模块定义

## 3.1 `demand_strength_insight`

目标：输出需求分类下按 KDS 排名的 TOP 关键词。

输入：

- KDS 分数。
- 真实需求分类。
- taxonomy 规则分类。
- 字段覆盖率。

输出：

```json
{
  "top_by_requirement_category": {
    "功能需求": [
      {
        "keyword": "防滑沙发套",
        "kds": 82.4,
        "rank_reason": "规模高 + 转化强 + 功能需求"
      }
    ]
  }
}
```

判断：

- KDS 高表示需求强。
- 同一需求分类下 KDS TOP 表示该分类最值得优先承接的词。
- 如果分类来自规则兜底，必须标记 `classification_source=taxonomy_fallback`。

## 3.2 `root_insight`

目标：找出这个品类最重要的词根和词根需求类型。

输入：

- `keywords_analysis`
- `agent/keyword`
- `category_requirements_v2.title`
- KDS TOP 关键词

输出字段：

| 字段 | 说明 |
| --- | --- |
| `root` | 词根 |
| `requirement_type` | 品类/人群/属性/功能/场景/品牌/风格/定制 |
| `keyword_count` | 覆盖关键词数量 |
| `search_value` | 搜索值 |
| `requirement_prop` | 需求占比 |
| `kds_avg` | 词根覆盖关键词的平均 KDS |
| `action_hint` | 标题、产品、主图、详情动作 |

判断标准：

| 现象 | 判断 | 动作 |
| --- | --- | --- |
| 词根搜索值高、需求占比高 | 主流需求词根 | 标题和主推款必须承接 |
| 词根增长快、KDS 中高 | 趋势词根 | 新品/内容优先测试 |
| 功能词根高频 | 产品升级机会 | 做功能证明和详情页证据 |
| 场景词根高频 | 场景机会 | 主图场景化、标题加场景词 |
| 风格词根高频 | 视觉机会 | 做风格主图、内容种草 |

## 3.3 `trend_insight`

目标：判断哪些需求正在变热，哪些只是波动。

输入：

- `search_growth_rate`
- `search_popularity_mom`
- `search_popularity_yoy`
- `search_value_trend`
- `pay_buyers_mom`
- `pay_buyers_yoy`

输出：

```json
{
  "strong_trends": [],
  "potential_trends": [],
  "pseudo_trends": [],
  "seasonal_or_campaign_trends": []
}
```

判断标准：

| 类型 | 标准 | 动作 |
| --- | --- | --- |
| 强趋势 | 搜索增长 >= 30%，且多个相关词同时增长，转化或支付买家不弱 | 优先测款或加速上新 |
| 潜力趋势 | 搜索增长 >= 20%，但成交或商品承接不足 | 小批量测试、内容先行 |
| 伪趋势 | 搜索增长高，但无转化、无支付、无持续趋势 | 观察，不立刻立项 |
| 活动型趋势 | 短期增长明显，周期性或节日性强 | 做短期活动款或节奏排期 |

## 3.4 `paid_insight`

目标：判断哪些关键词适合付费放量，哪些需要优化或否词。

输入：

- `kw_name`
- `clk_trans_rate`
- `uv_value`
- `tras_cost`
- `pay_cnt`
- `adcrt_rate`
- `gd_vst_pv`
- `search_visitors`

输出：

```json
{
  "scale_up_keywords": [],
  "inefficient_keywords": [],
  "negative_keyword_candidates": [],
  "expand_keyword_candidates": []
}
```

判断标准：

| 类型 | 标准 | 动作 |
| --- | --- | --- |
| 放量词 | 转化率高、UV 价值高、KDS 高 | 提高预算或拓展匹配 |
| 低效词 | 花费高、转化低、点击不弱 | 优化落地页、降低出价 |
| 否词候选 | 花费高、无转化、需求不匹配 | 加入否词或收窄匹配 |
| 拓词机会 | 自然 KDS 高但付费未覆盖 | 加入投放词包 |

## 3.5 `element_insight`

目标：从关键词元素分析中提炼卖点、内容主题、视觉方向。

输入：

- `summary`
- `suggestion`
- `cate_name`
- `start_date`
- KDS TOP 词根

输出：

| 输出 | 用途 |
| --- | --- |
| `selling_points` | 主图和详情页卖点 |
| `content_topics` | 小红书/抖音/短视频选题 |
| `visual_directions` | 主图背景、场景、风格表达 |
| `detail_page_directions` | 详情页证据、参数、FAQ |

判断：

- 功能类元素优先进入老品优化和详情页证明。
- 风格类元素优先进入内容种草和主图方向。
- 场景类元素优先进入新品开发和场景主图。
- 人群类元素优先进入人群定位、标题和内容脚本。

## 3.6 `action_recommendation`

目标：把洞察转换成可执行建议。

四类建议：

| 目标 | 输入证据 | 输出动作 |
| --- | --- | --- |
| 老品优化 | KDS 高、已有需求、商品级承接不足 | 标题补词、主图重做、详情补证、SKU 补齐 |
| 新品开发 | 趋势词根、供需比高、承接少 | 新品方向、人群、场景、功能、风格、价格角色 |
| 内容种草 | 风格/场景/人群元素、趋势词 | 内容主题、视频脚本方向、种草关键词 |
| 付费投流 | 付费表现 + KDS | 放量、降价、否词、拓词、预算建议 |

---

## 4. 输出 JSON 结构草案

## 4.1 `keyword_insights.json`

```json
{
  "category": "沙发套",
  "analysis_level": "category",
  "demand_strength_insight": {
    "top_overall": [],
    "top_by_requirement_category": {}
  },
  "root_insight": {
    "top_roots": [],
    "root_by_requirement_type": {}
  },
  "trend_insight": {
    "strong_trends": [],
    "potential_trends": [],
    "pseudo_trends": [],
    "seasonal_or_campaign_trends": []
  },
  "paid_insight": {
    "scale_up_keywords": [],
    "inefficient_keywords": [],
    "negative_keyword_candidates": [],
    "expand_keyword_candidates": []
  },
  "element_insight": {
    "selling_points": [],
    "content_topics": [],
    "visual_directions": [],
    "detail_page_directions": []
  },
  "data_gaps": []
}
```

## 4.2 `action_recommendations.json`

```json
{
  "old_product_optimization": [],
  "new_product_development": [],
  "content_seeding": [],
  "paid_traffic": []
}
```

建议项统一结构：

```json
{
  "target": "old_product",
  "priority": "high",
  "opportunity": "功能需求高但承接弱",
  "evidence": [
    {
      "type": "keyword",
      "value": "防滑沙发套",
      "metric": "kds",
      "score": 82.4
    }
  ],
  "action": {
    "title": "标题加入防滑/防水词根",
    "main_image": "首图做防滑演示",
    "detail": "详情页补充防滑测试和材质证明",
    "paid": "将高转化词加入精准投放"
  },
  "data_gaps": []
}
```

## 4.3 `dimension_coverage.json`

```json
{
  "scale": {
    "missing_fields": [],
    "fallback_used": false
  },
  "growth": {
    "missing_fields": [],
    "fallback_used": false
  },
  "traffic": {
    "missing_fields": [],
    "fallback_used": false
  },
  "conversion": {
    "missing_fields": [],
    "fallback_used": false
  },
  "requirement_category": {
    "missing_fields": [],
    "fallback_used": false
  }
}
```

---

## 5. 报告章节结构

关键词洞察报告必须包含：

```text
0. 数据来源与接口审计
1. 数据完整度与可信度
2. KDS TOP 总榜
3. 需求分类下 KDS TOP 排名
4. 当前类目最大需求是什么
5. 增长最快的需求是什么
6. 词根 TOP 与词根需求结构
7. 付费关键词洞察
8. 关键词元素洞察
9. 老品优化建议
10. 新品开发建议
11. 内容种草建议
12. 付费投流建议
13. 数据缺口与下次补证
```

---

## 6. 前端验收清单

前端页面必须能验收：

```text
1. 输入任意品类名称。
2. 展示 KDS 主榜。
3. 展示需求分类下 KDS TOP。
4. 展示候选接口审计。
5. 展示哪些接口有数据、哪些无数据、哪些解析失败。
6. 展示规模、增长、流量、转化、需求分类的缺失字段。
7. 展示词根洞察。
8. 展示趋势洞察。
9. 展示付费洞察。
10. 展示关键词元素洞察。
11. 展示老品优化、新品开发、内容种草、付费投流建议。
12. 无数据模块显示空状态和原因，不直接隐藏。
```

---

## 7. 降级与缺失说明

每次分析必须告诉用户哪些判断是完整数据、哪些是降级数据。

| 缺失 | 影响 | 报告说明 |
| --- | --- | --- |
| 缺 `pay_buyers` | 规模和转化降级 | “支付买家缺失，规模/转化分使用替代字段。” |
| 缺 `mom/yoy/trend_slope` | 增长降级 | “环比/同比趋势缺失，增长分使用搜索增长率兜底。” |
| 缺 `search_visitors/tmall_click_share` | 流量降级 | “搜索访客和天猫点击份额缺失，流量分使用点击率和搜索人气兜底。” |
| 缺真实需求分类 | 分类降级 | “未取到真实需求分类，使用规则词表分类。” |
| 缺词根数据 | 词根洞察缺失 | “本次未生成词根 TOP，建议补词根接口数据。” |
| 缺付费数据 | 付费洞察缺失 | “本次无法判断投流放量/否词，仅给自然搜索建议。” |
| 缺商品数据 | 商品承接缺失 | “未提供商品 ID，老品优化仅输出方向，不判断具体链接承接。” |

---

## 8. 后续代码实施任务拆分

| 任务 | 目标 | 验收 |
| --- | --- | --- |
| 接口映射扩展 | 把需求分类、词根、趋势、付费、元素接口纳入配置 | source audit 能列出所有候选接口 |
| 响应解析增强 | 支持分页对象和多种关键词字段 | `kw_name/title/category_requirements/result[]` 可解析 |
| 字段归一化 | 把新增字段映射到指标、分类、词根、付费、元素结构 | normalize report 显示新增字段覆盖 |
| 维度完整度 | 输出 `dimension_coverage.json` | 报告能说明每个 KDS 维度缺什么 |
| 词根洞察 | 输出 `root_insight` | 有词根 TOP 和动作建议 |
| 趋势洞察 | 输出 `trend_insight` | 能区分强趋势、潜力趋势、伪趋势 |
| 付费洞察 | 输出 `paid_insight` | 能输出放量词、低效词、否词、拓词 |
| 元素洞察 | 输出 `element_insight` | 能输出卖点、内容主题、视觉方向 |
| 动作建议 | 输出 `action_recommendations.json` | 覆盖老品、新品、内容、投流四类建议 |
| 报告升级 | 扩展 markdown 报告 | 包含 13 个报告章节 |
| 前端展示 | 增加洞察区块 | 页面能完成验收清单 |

---

## 9. 验收标准

文档和实现最终必须满足：

- 明确回答 KDS 是什么。
- 明确词根、趋势、付费、元素分别解决什么问题。
- 明确哪些接口进入主链、哪些进入扩展洞察。
- 明确任意品类输入时必须输出什么。
- 明确哪些数据缺失时如何降级说明。
- 明确如何形成老品优化、新品开发、内容种草、付费投流建议。

---

## 10. 一句话定义

```text
关键词洞察框架 =
以 KDS 判断需求强度，
以词根解释需求结构，
以趋势判断机会时机，
以付费数据判断投流价值，
以关键词元素提炼卖点和内容方向，
最终输出能指导老品优化、新品开发、内容种草和付费投流的经营建议。
```
