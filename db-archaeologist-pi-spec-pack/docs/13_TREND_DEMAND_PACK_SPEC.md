# Keyword Trend Pack Specification

本规范定义 `keyword_trend` capability 在 [11_ANALYSIS_PACK_FRAMEWORK_SPEC.md](11_ANALYSIS_PACK_FRAMEWORK_SPEC.md) 框架下的实例化形态。该 capability 与 [12_KEYWORD_DEMAND_PACK_SPEC.md](12_KEYWORD_DEMAND_PACK_SPEC.md) 同属 `keyword_analysis_pack` namespace（sibling capability），共享同一份 `keyword_field_mapping.yaml` 数据底座。

> 历史命名说明：早期文档与代码原型使用 `trend_demand`（pack_id 单层命名）。本规范确立的正式标识为：`namespace = keyword_analysis_pack`，`capability = keyword_trend`。文中保留 `trend_demand` 仅在与早期实现衔接处出现，新建产物一律用新名。

## 1. 包定位

### 1.1 业务问题

把「这个类目最近哪些词在涨、哪些在跌、哪些在异动」从「自己写脚本筛 mom」升级为标准化的可重跑 run，3 分钟出报告。

### 1.2 与 keyword_demand 的关系

| 维度 | `keyword_demand` | `keyword_trend` |
| --- | --- | --- |
| namespace | `keyword_analysis_pack` | `keyword_analysis_pack`（同 namespace） |
| capability | `keyword_demand` | `keyword_trend`（sibling） |
| score_domain | `demand`（KOIF 需求强度） | `trend`（KOIF 趋势强度） |
| 业务问句 | 这个类目里**哪些词最值得做** | 这个类目里**哪些词在涨/跌/异动** |
| 关注指标 | 体量 + 增速 + 转化 + 竞争（综合 KDS） | 增速 + 趋势形态（slope / mom / yoy） |
| 核心算子 | 加权打分 + 标签匹配 | 趋势分类 + 异动检测 |
| 输出 | 综合 TOP + 标签分组 TOP | 上升/下滑/异动/稳定头部 4 桶 |
| 数据源 | 6 P0 接口 | 同 6 P0 接口（重点用 mom / yoy / slope 字段） |
| 共享配置 | `category_taxonomy.yaml` / `keyword_field_mapping.yaml` / `keyword_strategies.yaml` / `keyword_taxonomy.yaml` | 同左（namespace 共享） |
| 私有配置 | `kds_weights.yaml` | `trend_thresholds.yaml`（capability 私有） |
| KOIF 角色 | 输出 KDS（0-100），供 Router 聚合 | 输出 TMS（0-100），供 Router 聚合 |

两 capability 共用 S1~S4 stage（resolve / pull / shape / normalize），从 S5 开始分叉：`keyword_demand` 走 `classify → score → rank`，`keyword_trend` 走 `trend_compute`。

**KOIF 集成**：本 capability 是 KOIF（Keyword Operating Intelligence Framework）8 个评分能力中的「趋势强度评估」，输出 TMS（Trend Momentum Score，0-100）作为 score_vector 的 `trend` 维度。Phase 2 KOIF Router 从本 capability 的 `trend_result.json` 提取 TMS + trend_label（rising/falling/...），用于路由趋势测试/内容种草策略。详见 §9 与 [14_KOIF_NAMESPACE_OVERVIEW.md](14_KOIF_NAMESPACE_OVERVIEW.md)。

### 1.3 为什么作为框架样本

- **复用最大化**：可以 1:1 复用 keyword_demand 的 resolve / pull / shape / normalize 整条链路，验证 _lib 抽象正确。
- **业务差异最小**：仅多一个 `trend_compute` stage + 1 套报告模板，业务复杂度低，不会被业务噪声掩盖框架问题。
- **同 namespace 同 entity，便于对比**：同一类目同时跑两个 capability，验证「framework 隔离 + 同源数据 + 不同视角 + 同 namespace 共享 taxonomy」四件事。
- **元工具层验证**：让 `propose_insight_plan`（11 号 §12）能基于「关键词」类业务问题正确路由到 `keyword_demand` / `keyword_trend` 中合适的 capability，而不是默认走单一入口。

## 2. PackManifest 实例

### 2.1 manifest.yaml

```yaml
namespace: keyword_analysis_pack
capability: keyword_trend
namespace_cn_name: 关键词分析
cn_name: 关键词趋势分析
version: 0.1.0
entity_kind: category
description: 给一个类目，输出近期上升/下滑/异动/稳定头部 4 桶趋势词清单。

score_domain: trend                 # KOIF：本 capability 归属的评分维度
koif_aggregatable: true             # 可被 KOIF Router 跨 capability 聚合

siblings:
  - keyword_demand           # 已上线
  - keyword_blue_ocean       # 占位，未实现

stages_used:
  - resolve
  - pull
  - shape
  - normalize
  - trend_compute     # capability 私有 stage，替代 S5/S6/S7
  - report

registry_refs:
  config:
    - registry/category_taxonomy.yaml
    - registry/keyword_field_mapping.yaml
    - registry/keyword_strategies.yaml
  namespace_shared:
    - registry/keyword_taxonomy.yaml          # 与 keyword_demand 共享类目→词聚合关系
  capability_private:
    - registry/trend_thresholds.yaml          # capability 私有阈值（mom/yoy/slope/异动）
    - registry/trend_thresholds.trend_v1.locked.yaml

default_strategy: trend_v1
supported_strategies:
  - trend_v1
default_live: true
default_date_range: T-30..T-3                 # 30 天窗口，与 mom/yoy 计算需求对齐

lookup_api: data_keywords_category_list

report_sections:
  - id: data_source
    cn: 数据来源说明
    required: true
  - id: rising_top
    cn: 上升 TOP10
    required: true
  - id: falling_top
    cn: 下滑 TOP10
    required: true
  - id: volatile_top
    cn: 异动 TOP10
    required: true
  - id: stable_head
    cn: 稳定头部 TOP10
    required: true

tools:
  analyze: analyze_keyword_trend
  list_runs: list_keyword_trend_runs
  compare: compare_keyword_trend_runs

skill:
  path: .pi/skills/keyword-trend/SKILL.md
  trigger_keywords:
    - 趋势
    - 涨跌
    - 上升词
    - 下滑词
    - 异动
    - 走势
    - mom
    - 同比
    - 环比

fixture_dir: fixtures/keyword_trend_mock
diagnostic_root: registry/derived/keyword_analysis_pack/keyword_trend/_diag

insight_templates:
  - keyword_trend_overview
  - rising_keywords_drilldown
  - volatility_alert
```

### 2.2 与 keyword_demand 共享部分

`registry_refs.config` 与 `registry_refs.namespace_shared` 全部复用 namespace 内已有资源：

- `category_taxonomy.yaml`：类目解析（namespace 间也共享，写在 config 段）
- `keyword_field_mapping.yaml`：6 P0 接口的请求模板 + response_root + field_map（无需新增接口）
- `keyword_strategies.yaml`：strategy 注册表（新增 `trend_v1` 条目，见 §5.1）
- `keyword_taxonomy.yaml`：namespace 共享关键词标签库（trend 不打标，但报告归因解释会读其类目映射）

### 2.3 capability 私有部分

- `registry/trend_thresholds.yaml`（+ `trend_thresholds.trend_v1.locked.yaml`）：阈值（见 §3.4）
- `src/packs/keyword_analysis_pack/keyword_trend/trend_compute.ts`：capability 私有 stage 实现
- `src/packs/keyword_analysis_pack/keyword_trend/report.ts`：5 节报告模板
- `src/packs/keyword_analysis_pack/keyword_trend/strategies/trend_v1.ts`：阈值版本与字段优先级配置

### 2.4 与 11 号规范字段对照

| manifest 字段 | 11 号 §5.2 schema | 备注 |
| --- | --- | --- |
| `namespace` | 必填 | 与 keyword_demand 同 namespace |
| `capability` | 必填 | 与目录第 2 级一致；全局唯一 |
| `entity_kind` | `category` | 与 keyword_demand 同 entity_kind，便于跨 capability 对照 |
| `stages_used[4]` | `trend_compute` | capability 私有 stage 名，替代框架 S5~S7 |
| `default_live` | `true` | 与 11 号 §9 默认值矩阵一致 |
| `tools.*` | 三件套 | 命名严格匹配 11 号 §7.1（`<verb>_<capability>(_runs)`） |
| `insight_templates[]` | 选填 | 元工具路由用，让上层在「涨/跌/异动」类问题时定位到本 capability |

### 2.5 默认日期窗口策略（最近 3 个完整自然月）

**触发条件**：`input.date_range` 缺省时。

**新策略**：取**最近 3 个完整自然月**，按月初/月末对齐。

| 当前日期 | 默认 start_date | 默认 end_date |
| --- | --- | --- |
| 2026-03-15 | 2025-12-01 | 2026-02-28 |
| 2026-07-01 | 2026-04-01 | 2026-06-30 |
| 2027-01-10 | 2026-10-01 | 2026-12-31 |

**理由**：

- `data_keyword_trend` 是月度时序接口（按月聚合），mom/yoy 与 `tms.trend_slope` 至少需要 3 个月样本
- 短于 3 个月会让 `compute_tms.ts` 算出的趋势斜率方差过大，趋势分类不稳定
- 长于 3 个月会让响应数据爆量（`data.result[]` 一次返回所有月度记录），影响响应时间

**落地**：

- 默认窗口由 [src/services/keyword_trend/index.ts](src/services/keyword_trend/index.ts) 的 `defaultTrendDateRange()` 提供
- pipeline 中 `dateRange` 缺省走 `defaultTrendDateRange()` 而非 `keyword_demand` 的 `defaultDateRange()`（后者是上一个完整自然月，时间窗只有 1 个月）
- 用户显式传 `date_range` 时不受影响

**与 `date_format: month` 的协同**：

- dateRange 仍按日生成（`YYYY-MM-DD`）
- 月度时序接口（当前是 `data_keyword_trend`）在 [registry/keyword_field_mapping.yaml](registry/keyword_field_mapping.yaml) 节点声明 `date_format: month`
- 由 [src/services/keyword_demand/live_pull.ts](src/services/keyword_demand/live_pull.ts) 的 `renderRequestTemplate()` 在渲染期把 `{start_date}/{end_date}/{business_date}` 截短为 `YYYY-MM`
- 见 [docs/18_KEYWORD_FIELD_MAPPING_SPEC.md](docs/18_KEYWORD_FIELD_MAPPING_SPEC.md) §3.4 与 §4.1

**兼容**：与 keyword_demand 的窗口策略不冲突——两个 capability 在 trace 层各自记录 `date_range_source`，对 KOIF Router 聚合时按 capability 维度展示。

## 3. trend_compute（包私有 stage）

### 3.1 在 pipeline 中的位置

```
S1 resolve → S2 pull → S3 shape → S4 normalize → trend_compute → S8 report
```

`trend_compute` 在 `manifest.stages_used` 中作为字符串声明；runner 注入对应函数；不写进 `_lib`。

### 3.2 输入

```yaml
metric_records: MetricRecord[]                 # 与 keyword_demand 同构
thresholds: TrendThresholds                    # 来自 trend_thresholds.yaml
strategy_config: TrendStrategyConfig           # trend_v1 的字段优先级
```

`MetricRecord` 字段中 trend_demand 关注的子集：

```yaml
keyword: string
metrics:
  search_popularity: number?
  search_popularity_mom: number?               # 主用
  search_popularity_yoy: number?               # 主用
  search_growth_rate: number?                  # mom 缺失时降级
  search_value: number?
  search_value_trend: number?                  # 趋势子源
  pay_buyers_mom: number?
  pay_buyers_yoy: number?
source_apis: string[]
```

### 3.3 输出

```yaml
TrendRecord:
  keyword: string
  source_apis: string[]
  trend_label: rising | stable | falling | volatile
  metrics:
    head_value: number                         # 体量代理（search_popularity / search_value 取首个非空）
    mom: number?                               # 月环比（search_popularity_mom 优先，缺失降级 search_growth_rate）
    yoy: number?                               # 同比（search_popularity_yoy 优先）
    slope_7d: number?                          # 7 日斜率（来自 search_value_trend，归一化为 -1..1）
    volatility: number?                        # 波动度（基于多源 mom 一致性，0..1）
  tms: number?                                 # KOIF 趋势强度评分（0-100），公式见 §9.3；缺数据降级为 null
  fallbacks: string[]                          # 触发的降级标记，例如 ["mom_from_growth_rate", "no_yoy"]

TrendResult:
  rising: TrendRecord[]                        # 按 mom 降序，TOP N
  falling: TrendRecord[]                       # 按 mom 升序（最负在前）
  volatile: TrendRecord[]                      # 按 volatility 降序
  stable_head: TrendRecord[]                   # |mom| ≤ stable_band 且 head_value 头部，按 head_value 降序
  excluded:
    insufficient_data: TrendRecord[]           # mom 与 yoy 同时缺失，无法分类
    out_of_window: TrendRecord[]               # 数据窗口对不上 manifest.default_date_range
```

产物文件：`trend_result.json`。

### 3.4 阈值与分类规则

`registry/trend_thresholds.yaml`：

```yaml
strategy: trend_v1
mom_rising: 0.20                               # mom > 20% → rising
mom_falling: -0.20                             # mom < -20% → falling
stable_band: 0.10                              # |mom| ≤ 10% → 候选 stable
volatility_threshold: 0.40                     # volatility ≥ 0.40 → volatile（覆盖前 3 类）
top_n: 10
head_min_popularity: 1000                      # stable_head 桶要求 head_value ≥ 该阈值
require_at_least_one_of: [mom, yoy]            # 缺则进 excluded.insufficient_data

mom_field_priority:
  - search_popularity_mom
  - search_growth_rate
yoy_field_priority:
  - search_popularity_yoy
  - pay_buyers_yoy
head_value_priority:
  - search_popularity
  - search_value
```

**分类决策树**（每词独立判定，先算 volatility，再判 trend）：

```
1. 取 head_value（priority 顺序首个非空），缺失 → excluded.insufficient_data
2. 取 mom（priority 顺序首个非空），缺失但 yoy 在 → 用 yoy 代理：
     mom_proxy = sign(yoy) * min(|yoy|, 1.0)
3. 算 volatility = stddev(mom_candidates) / (mean(|mom_candidates|) + ε)
     mom_candidates = mom_field_priority 取到的所有非空值
4. 若 volatility ≥ volatility_threshold → trend_label = volatile
5. 否则按 mom（或 mom_proxy）：
     mom > mom_rising → rising
     mom < mom_falling → falling
     |mom| ≤ stable_band 且 head_value ≥ head_min_popularity → stable_head
     其他（介于 stable_band 与 mom_rising/falling 之间） → 不入任何 TOP 桶，落 trend_result.json 的 `unranked` 区
```

### 3.5 字段降级规则

| 场景 | 降级动作 | `fallbacks[]` 标记 |
| --- | --- | --- |
| `search_popularity_mom` 全空，但有 `search_growth_rate` | 用 `search_growth_rate` 当 mom | `mom_from_growth_rate` |
| `mom` 全空，但 `yoy` 在 | 走 `mom_proxy = sign(yoy) * min(|yoy|, 1.0)` | `mom_from_yoy_proxy` |
| `search_popularity` 空，用 `search_value` | head_value = search_value | `head_from_search_value` |
| 多源 mom 仅 1 个非空 | volatility = 0（无法计算） | `volatility_unmeasurable` |
| `yoy` 全空 | 不影响分类，仅报告标注 | `no_yoy` |

每个 fallbacks 标记落到 `TrendRecord.fallbacks[]`，并在报告 §1 数据来源说明中按出现率聚合。

### 3.6 与 keyword_demand 的指标共用

| 指标 | keyword_demand 用法 | trend_demand 用法 |
| --- | --- | --- |
| `search_popularity` | KDS scale 子项 | head_value 主源 |
| `search_popularity_mom` | KDS growth 子项 | mom 主源 |
| `search_popularity_yoy` | KDS growth 子项 | yoy 主源 |
| `search_growth_rate` | KDS growth 降级 | mom 降级 |
| `search_value_trend` | 不直接用 | slope_7d 主源 |
| `demand_supply_ratio` | KDS competition 子项 | 不用 |
| `pay_rate / pay_buyers` | KDS conversion 子项 | 仅 stable_head 排序参考 |

两包从同一份 `metric_records.json` 派生，但消费不同字段，逻辑互不影响。

## 4. 报告 5 节

`report.md` 的节序严格按 `manifest.report_sections` 渲染，业务语言化，零工程术语。

### 4.1 §1 数据来源说明

模板：

```
本次分析覆盖类目「{entity_canonical}」，时间窗 {start_date} 至 {end_date}（共 {N} 天）。
有效数据源 {effective_apis}/{total_apis} 个：{api_cn_names_joined}。
共归一关键词 {total_keywords} 条；其中 {classified_count} 条进入趋势分类，
{insufficient_data_count} 条因数据不足未分类。
降级触发统计：{fallback_distribution}（如「29% 关键词使用搜索人气环比代理；7% 缺同比」）。
```

不出现 `mom / yoy / slope_7d` 等英文/缩写；统一替换为「环比 / 同比 / 7 日斜率」。

### 4.2 §2 上升 TOP10

模板：

```
近期搜索人气增长最快的 10 个关键词（按月环比降序）：

| 排名 | 关键词 | 环比 | 同比 | 体量 | 主要来源 |
| --- | --- | --- | --- | --- | --- |
| 1 | {keyword} | +XX% | +XX% | {head_value} | {source_apis_cn} |
...
```

每个关键词在表后附 1 行业务解释（按规则模板化生成）：

```
- {keyword}：环比 +{mom}%，体量 {head_value}（{level}）。{narrative}
  narrative 模板：
    若 mom > 0.5：「短期热度大幅抬升，建议关注铺货节奏」
    若 0.2 < mom ≤ 0.5：「热度温和上行，可纳入观察」
    若 yoy > 0 且 mom > 0：「环比同比双增，趋势可信度高」
```

### 4.3 §3 下滑 TOP10

格式同 §2，按月环比升序（最负在前）。narrative 模板：

```
若 mom < -0.5：「热度快速回落，建议核查季节因素或竞品分流」
若 -0.5 ≤ mom < -0.2：「热度走低，注意 ROI 拐点」
若 yoy < 0 且 mom < 0：「环比同比双降，建议降低投放优先级」
```

### 4.4 §4 异动 TOP10

按 volatility 降序。模板：

```
波动较大（多源数据不一致）的关键词，建议人工核查后再决策：

| 排名 | 关键词 | 波动度 | 多源环比 | 体量 | 主要来源 |
| --- | --- | --- | --- | --- | --- |
| 1 | {keyword} | 0.62 | [+45%, -12%, +18%] | {head_value} | {source_apis_cn} |
...
```

每条附注源不一致的可能原因（来源接口的统计窗口/口径差异）。

### 4.5 §5 稳定头部 TOP10

按 head_value 降序，且 |mom| ≤ stable_band。模板：

```
体量稳定且环比变化不大的头部关键词（持续运营基本盘）：

| 排名 | 关键词 | 体量 | 环比 | 同比 |
...
```

### 4.6 不在报告范围

- 关键词标签（intent / persona / 等）：trend_demand 不打标，留 keyword_demand。
- KDS / 蓝海评分：不展示。
- 投放预算建议：留独立「投放策略包」（未规划）。

## 5. strategy 注册

### 5.1 keyword_strategies.yaml 增量

```yaml
trend_v1:
  pack: trend_demand
  version: 1
  description: keyword_trend 默认阈值版本（mom 20% / 稳定带 10% / 异动 0.4）
  thresholds_ref: registry/trend_thresholds.yaml
  locked: false
```

### 5.2 strategy 切换语义

`keyword_trend` 的 strategy 主要是「阈值组合 + 字段优先级」的版本号；公式无需切换。后续若引入：

- `trend_v2`：基于 7 日 slope 的拟合趋势
- `trend_seasonal_v1`：剔除季节因素的趋势

均通过新增 `trend_v*.yaml` + `keyword_strategies.yaml` 条目实现，`src/packs/keyword_analysis_pack/keyword_trend/strategies/<name>.ts` 提供阈值加载器。

## 6. 三件套工具

### 6.1 命名

| 工具 | name |
| --- | --- |
| 分析入口 | `analyze_keyword_trend` |
| 列 runs | `list_keyword_trend_runs` |
| 对比 runs | `compare_keyword_trend_runs` |

命名遵循 11 号 §7.1：`<verb>_<capability>(_runs)`，全局唯一。

### 6.2 analyze_keyword_trend 输入差异

与 11 号 §7.2 通用契约一致，差异只在：

- `top_n` 默认 10（每桶 TOP10）
- 不需要 `per_demand_type_top`（无标签桶）
- 默认 `date_range = T-30..T-3`（30 天窗口对齐 mom/yoy 计算）

### 6.3 输出 schema

```yaml
output_success:
  kind: keyword_trend_run
  run_id: string
  run_dir: string
  namespace: keyword_analysis_pack
  capability: keyword_trend
  entity:
    name: string
    id: string
    resolution: taxonomy | user_id | auto_resolved | partial_no_id | mock_fixture_fallback
  trend:
    rising: TrendSummary[]
    falling: TrendSummary[]
    volatile: TrendSummary[]
    stable_head: TrendSummary[]
  classification_stats:
    total: number
    classified: number
    insufficient_data: number
    by_label: Record<rising|stable|falling|volatile, number>
  summary_path: string
  report_path: string
  pull_report?: PullReportSummary
```

### 6.4 compare_keyword_trend_runs 差异

不复用 keyword_demand 的 KDS 分布 diff；改为：

```yaml
output_success:
  kind: compare_keyword_trend_result
  run_a: RunMeta
  run_b: RunMeta
  config_diff: Record<key, {a, b}>
  bucket_overlap:                              # 4 桶各自的 TOP K 重叠率
    rising: {overlap_rate, common_keywords}
    falling: {overlap_rate, common_keywords}
    volatile: {overlap_rate, common_keywords}
    stable_head: {overlap_rate, common_keywords}
  bucket_movers:                               # 跨桶迁移
    new_rising: string[]
    no_longer_rising: string[]
    new_falling: string[]
    no_longer_falling: string[]
    became_volatile: string[]
  recommendation: string
```

## 7. SKILL.md

[.pi/skills/keyword-trend/SKILL.md](db-archaeologist-pi-spec-pack/.pi/skills/keyword-trend/SKILL.md) 在 Phase 2 新建。要点：

### 7.1 触发词

```
- 趋势 / 走势 / 涨跌
- 上升词 / 上涨词 / 涨幅 / 增长
- 下滑词 / 下跌词 / 跌幅 / 衰退
- 异动 / 异常波动 / 波动
- 环比 / 同比 / mom / yoy / qoq
```

### 7.2 与 keyword-demand 的路由优先级

总入口 SKILL（[.pi/skills/db-archaeologist/SKILL.md](db-archaeologist-pi-spec-pack/.pi/skills/db-archaeologist/SKILL.md)）路由原则：

| 用户问句特征 | 路由到 capability |
| --- | --- |
| 含「值得做 / 蓝海 / TOP / 推荐」无趋势词 | `keyword_demand` |
| 含「涨/跌/趋势/走势/异动/环比/同比」 | `keyword_trend` |
| 同时含两者（「最值得做的趋势词」） | `keyword_trend`（趋势优先） |
| 仅类目名无业务诉求 | 反问澄清，不默认任一 capability |

元工具层路径：上层 `propose_insight_plan` 也按该规则给出 `recommended_capability`，由 LLM 决定是否直接调用对应 `analyze_*`，避免在 sibling capability 间瞎切。

### 7.3 默认行为话术

> 用户提到趋势相关问题时，默认调 `analyze_keyword_trend`，参数 `entity` 填类目名，`live` 不填（框架自动按 `LIVE_PROBE` 升级）。`date_range` 不填（默认 30 天窗口）。

### 7.4 错误模式回流

| error | 回复模板 |
| --- | --- |
| `entity_not_resolved` | 同 keyword_demand |
| `pull_no_data` | "类目「{entity}」近 30 天数据不足，无法判断趋势。建议：1）确认 LIVE_PROBE；2）联系上游确认接口可用性。" |
| `live_disabled` | 同 keyword_demand |
| `env_missing` | 同 keyword_demand |
| `trend_insufficient_data`（capability 私有） | "类目「{entity}」绝大多数关键词缺月环比/同比指标，趋势分类无效。可能原因：上游接口窗口未结清。建议拉长 date_range。" |

`trend_insufficient_data` 是 `keyword_trend` capability 私有错误码（11 号 §7.5 5 类之外），触发条件：`classification_stats.classified / total < 0.3`。

### 7.5 不要做的事

- 不要把「上升 TOP」混淆为「值得做 TOP」；上升 ≠ 值得做（需结合体量、转化）。
- 不要建议在「异动」桶的关键词上加投放，先核查口径。
- 不要在用户没要求时切 `strategy`；保持 `trend_v1`。

## 8. 验收路径

### 8.1 沙箱回归

```bash
cd db-archaeologist-pi-spec-pack
npm run rebuild:all                            # 必须 10 stage 全绿
npm run test:golden                            # keyword_demand 9 + 兼容 1 + keyword_trend 2 = 12 全绿
npm run smoke:pi                               # 11 + 3 = 14 工具 ALL GREEN（含元工具增量）
node web/_smoke.mjs                            # 包含 /api/keyword_analysis_pack/keyword_trend/* 端点 ALL GREEN
node --check $(find src/packs/keyword_analysis_pack/keyword_trend -name '*.ts')
```

新增 2 条 golden case：

- `keyword_trend_fixture_basic`：fixture 模式跑「入户地垫」，断言 4 桶非空、`stable_head` TOP1 体量降序。
- `keyword_trend_fallback_mom_from_growth_rate`：构造仅有 `search_growth_rate` 的 fixture，断言降级标记触发。

### 8.2 fixture 准备

```
fixtures/keyword_trend_mock/
  category_入户地垫.json                       # 复用 keyword_demand 的 probe results
  category_厨房地垫.json
```

JSON 直接拷贝 keyword_demand 同名 fixture（共享 6 P0 接口的响应），无需新建样本。

### 8.3 真机 LIVE 验证

在真实 Terminal.app 跑：

```bash
PI_CODING_AGENT_DIR="$(pwd)/.pi-home/agent" \
LIVE_PROBE=true \
npm run trend:demo -- 桌布 trend_v1 --live
```

新增 `npm run trend:demo` 脚本（[scripts/keyword_trend_demo.ts](db-archaeologist-pi-spec-pack/scripts/keyword_trend_demo.ts)）。

期望：

- `RunMeta.namespace = "keyword_analysis_pack"`，`RunMeta.capability = "keyword_trend"`
- `pull_report.effective_apis ≥ 5`
- `trend_result.rising[].length ≥ 3`，每条 mom > 0.20
- `trend_result.falling[].length ≥ 3`，每条 mom < -0.20
- `report.md` 5 节齐备，§1 数据来源说明含降级触发统计
- `RunMeta.date_range = {start: T-30, end: T-3}`

### 8.4 跨 capability 同 entity 对照

跑完 keyword_trend run 后，跑：

```bash
LIVE_PROBE=true npm run keyword:demo -- 桌布 baseline_v1 --live
```

人工核对：

- 两个 run 的 `metric_records.json` 主键集合（keyword）重叠率 ≥ 90%（同源数据应高度一致）
- `keyword_demand` 报告 §3 TOP5 与 `keyword_trend` 报告 §2 上升 TOP10 的交集 ≥ 1（验证两种视角合理交叉）
- 任一交集词的 `head_value` 在两个 run 中数值一致（来自同一份 normalized record）
- 两个 run_dir 路径分别落在 `registry/derived/keyword_analysis_pack/keyword_demand/` 与 `registry/derived/keyword_analysis_pack/keyword_trend/`（验证 namespace 共目录、capability 隔离子目录）

### 8.5 web Inspector 验证

```bash
PORT=8888 LIVE_PROBE=false npm run web
```

人工点击：

- Inspector「Capability 切换器」可在同 namespace 下的 `keyword_demand` / `keyword_trend` 间切换 run 列表。
- `/api/keyword_analysis_pack/keyword_trend/runs` 返回最新 run；点击进入可看 `report.md`。
- `/api/keyword_analysis_pack/keyword_trend/compare?a=<runA>&b=<runB>` 返回 4 桶重叠率与 movers。

### 8.6 SKILL 路由验证

启动 pi 后输入：

```
看下"客厅地毯"最近哪些词在涨
```

期望：

- 命中 `analyze_keyword_trend`（不命中 `analyze_keyword_demand`）
- 自动 live、自动 30 天窗口
- 返回 RunEnvelope 含 4 桶摘要

再输入：

```
"客厅地毯"最值得做的趋势词
```

期望：

- 路由到 `analyze_keyword_trend`（按 §7.2，趋势优先）

## 9. KOIF 集成

### 9.1 角色

`keyword_trend` 是 KOIF（Keyword Operating Intelligence Framework）8 个评分能力中的「趋势强度评估」，对应 `score_domain = trend`。在 KOIF Router（`propose_koif_strategy`）的 score_vector 中，本 capability 提供 `tms` 这一维度。

KOIF 全景与 8 capability 关系见 [14_KOIF_NAMESPACE_OVERVIEW.md](14_KOIF_NAMESPACE_OVERVIEW.md)；KOIF Router 元工具规范见 [15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md)。

### 9.2 Router 消费契约

KOIF Router 在 S3 load runs / S4 aggregate scores 阶段从本 capability 的 RunEnvelope 中读取以下产物：

| 产物文件 | 字段路径 | 用途 |
| --- | --- | --- |
| `run.meta.json` | `entity.canonical / entity.id` | 关联 router_run 的 entity |
| `run.meta.json` | `resolution.kind` | 判断是否 partial / mock_fixture_fallback |
| `trend_result.json` | `rising[].tms` / `falling[].tms` / `volatile[].tms` / `stable_head[].tms` | 主分数：TMS（0-100） |
| `trend_result.json` | `rising[].trend_label` | 趋势形态标签，供 Router action 模板渲染 |
| `trend_result.json` | `rising[].keyword` | 上升词列表（TOP N），传给 Router 用于 action 优先级 |
| `trend_result.json` | `rising[].metrics.mom` / `yoy` | 环比/同比原始值，供 Router 渲染话术（如「月环比 +45%」） |

Router 仅读 4 桶（rising / falling / volatile / stable_head），不读 `excluded.*`。

### 9.3 TMS 计算公式（KOIF 专用）

TMS（Trend Momentum Score）在 `trend_compute` stage 中按以下公式为每个 TrendRecord 计算：

```typescript
tms = 0.4 × normalize(mom, -1, 1)       // 月环比权重 40%
    + 0.3 × normalize(yoy, -1, 1)       // 同比权重 30%
    + 0.3 × trendLabelScore             // 趋势形态权重 30%

normalize(x, min, max) = clamp((x - min) / (max - min) * 100, 0, 100)

trendLabelScore = {
  rising: 100,
  volatile: 75,
  stable: 50,
  falling: 25
}
```

降级规则：
- 缺 `mom`：从 `yoy` 代理，权重调整为 `0.5 × yoy + 0.5 × trendLabelScore`
- 缺 `yoy`：从 `mom` 代理，权重调整为 `0.6 × mom + 0.4 × trendLabelScore`
- 同时缺 `mom` 与 `yoy`：`tms = null`，该词不进入 Router 聚合

TMS 落到 `TrendRecord.tms` 字段，Router 读取时按 4 桶分别取均值（或加权，由 Router 配置）。

### 9.4 TMS 在 score_vector 中的位置

```typescript
// Phase 2 默认聚合规则（Router S4）
score_vector.scores.tms = mean(
  trend_result.rising.filter(r => r.tms != null).map(r => r.tms)
)

score_vector.score_explanation.trend = "基于 <N> 个上升词，月环比均值 <mom_avg>%"
```

Phase 2 TMS 聚合策略：
- 仅取 `rising` 桶（上升词）的 TMS 均值，忽略其他 3 桶
- 如果 `rising.length === 0` 或所有 `rising[].tms === null`，TMS 不进入 score_vector，标记为 `unavailable`
- Phase 3+ 可引入 4 桶加权聚合（如 rising×0.5 + volatile×0.3 + stable_head×0.2）

### 9.5 路由触发条件

Phase 2 路由规则中涉及 TMS 的条件（详见 `registry/koif_route_rules.yaml`）：

- `trend_test`：`tms >= 75 && kds >= 60`（TMS 主导，需 KDS 辅助）
- `content_candidate`：`kds >= 70 && tms >= 70`（KDS + TMS 联合）

### 9.6 Action 模板对接

Phase 2 三类 action 中，TMS 参与的有：

- `content_topic`：`tms >= 70 && kds >= 60` 触发；模板从 `trend_result.rising[]` 取 TOP 3 高 TMS 词，渲染「可围绕 <keywords> 制作内容话题，把握趋势窗口期（月环比 +<mom>%）」
- `paid_test`：`kds >= 80 && tms >= 60` 触发；模板取 rising 词 + KDS ≥ 80 交集，强调「强需求 + 趋势加持」

完整 action 模板见 `registry/koif_action_templates.yaml`。

### 9.7 与 keyword_demand 的协同

KOIF Router 在 S2 并行触发两个 capability：

```typescript
// Router S2: invoke capabilities
const [demandRun, trendRun] = await Promise.all([
  analyzeKeywordDemand({ entity, live, date_range }),
  analyzeKeywordTrend({ entity, live, date_range })
]);

// Router S3: load runs
const demandScores = readJson(`${demandRun.run_dir}/keyword_scores.json`);
const trendResult = readJson(`${trendRun.run_dir}/trend_result.json`);

// Router S4: aggregate
score_vector.scores.kds = mean(demandScores.records.map(r => r.kds));
score_vector.scores.tms = mean(trendResult.rising.map(r => r.tms));
```

两 capability 复用同一份 S1 resolve（category taxonomy）+ S2 pull（6 P0 接口）数据，但各自独立 RunEnvelope，互不干扰。

### 9.8 缓存复用

同 keyword_demand（详见 12 号 §10.7），Router 可复用最近 24h 内同 entity + strategy + date_range 的 run。

### 9.9 Phase 3+ 演进

Phase 3+ KOIF 扩展时，本 capability 不需要改动：
- `score_domain = trend` 已固定
- TMS 公式稳定（3 因子加权）
- 输出格式（`trend_result.json` + `TrendRecord.tms`）已规范化
- 新策略（如 `trend_seasonal_v1`）落地时 Router 透传 strategy 参数即可

---

## 10. 不在本规范范围

- 趋势预测（未来 N 天预测）：留独立「预测包」。
- 季节性剔除：未来 `trend_seasonal_v1` 引入。
- 关键词级别的事件归因（哪个事件引发涨跌）：未规划。
- 与 keyword_demand 的联合报告（同 entity 一次出综合报告）：留 namespace 内「跨 capability 联合」能力（Phase N+2）。
- `keyword_blue_ocean`（namespace 内第三个 sibling capability）：占位未实现。
- 评价 / 主图 / 详情 / 社媒等其他 namespace 的 capability：本规范不涉及，保持框架空椅子。