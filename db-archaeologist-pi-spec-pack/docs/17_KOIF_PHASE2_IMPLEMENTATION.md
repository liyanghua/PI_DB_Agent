# 17 — KOIF Phase 2 实施摘要（TMS + Router 骨架）

> 配套 spec：[14 KOIF Namespace Overview](./14_KOIF_NAMESPACE_OVERVIEW.md) · [15 KOIF Router Spec](./15_KOIF_ROUTER_SPEC.md) · [12 Keyword Demand Pack](./12_KEYWORD_DEMAND_PACK_SPEC.md) · [13 Trend Demand Pack](./13_TREND_DEMAND_PACK_SPEC.md)
>
> 本手册只覆盖**实施侧的设计摘要**——模块责任、数据形态、接口契约、阈值表、决策依据、真机验收步骤。完整代码以仓库 `src/` 与 `registry/` 为准，本文不再贴代码片段。

---

## §0 范围与交付物

### 0.1 Phase 2 一句话目标

把 KOIF 的 KDS + TMS 两个分数喂进 Router 元工具，输出 `strategy_routes + next_actions`，pi 与 web 入口都能调通，并通过 fixture 模式 golden case。

### 0.2 本轮新增/修改的工程产物

| 类型 | 路径 | 操作 | 作用 |
| --- | --- | --- | --- |
| service | `src/services/keyword_trend/{types,compute_tms,index,trace}.ts` | 新建 | TMS 计算 capability |
| service | `src/services/koif_router/{types,resolve,invoke,aggregate,route,actions,write,index}.ts` | 新建 | Router S1~S7 |
| tool | `src/tools/{analyze_keyword_trend,propose_koif_strategy,list_koif_routes,get_koif_route}.ts` | 新建 | pi/web 入口 |
| extension | `.pi/extensions/db_archaeologist.extension.ts` | 改 | 12 → 16 个工具 |
| skill | `.pi/skills/koif-router/SKILL.md` | 新建 | 触发词与默认调用顺序 |
| skill | `.pi/skills/keyword-trend/SKILL.md` | 新建 | TMS 触发词 |
| registry | `registry/keyword_trend_weights.yaml` | 新建 | TMS 子分权重 + 阈值 |
| registry | `registry/koif_route_rules.yaml` | 已建（Phase 1） | Phase 2 简化路由 |
| registry | `registry/koif_action_templates.yaml` | 已建（Phase 1） | 3 类 action 模板 |
| fixtures | `fixtures/keyword_trend_mock/category_入户地垫.json` | 新建（可复用 demand 同名 fixture） | TMS fixture |
| web | `web/server.mjs` | 改 | 增 `/api/koif_routes/*` 5 个路由 |
| golden | `tests/golden_cases/api_qa_cases.yaml` | 改 | 增 `koif_router_kds_tms_baseline` |
| golden | `tests/golden.test.ts` | 改 | KOIF case dispatcher |

### 0.3 落盘根目录约定

| 数据 | 根 | 说明 |
| --- | --- | --- |
| `keyword_demand` runs（已有） | `registry/derived/keyword_demand/<run_id>/` | capability 派生品 |
| `keyword_trend` runs（新） | `registry/derived/keyword_trend/<run_id>/` | capability 派生品 |
| `koif_router` runs（新） | `registry/koif_routes/<router_run_id>/` | **元工具产物，平级于 derived/** |

> 决策：Router 是元工具消费者而非 capability，落 `registry/koif_routes/` 平级根；`registry/derived/` 仍专属 capability 自身派生品。

---

## §1 TMS Capability — `keyword_trend`

### 1.1 模块责任

```
src/services/keyword_trend/
├── types.ts          类型定义：TrendInput / TrendRecord / TrendRunMeta / TmsWeights / TmsSubScore
├── compute_tms.ts    子分函数（mom/yoy/slope/consistency）+ TMS 合成 + trend_label 判定
├── trace.ts          run_id 生成 + run 目录初始化/读取/列举（mirror keyword_demand/trace.ts）
└── index.ts          analyzeKeywordTrend(input) 编排器：S1 resolve → S2 pull → S3 normalize → S4 compute → S5 落盘
```

**复用关系**：`resolve.ts / live_pull.ts / shape.ts / normalize.ts` 不重新实现，全部 `import` 自 `src/services/keyword_demand/`。TMS 与 KDS 共用同一份 `KeywordMetricRecord` 原始数据，只是消费的字段子集不同。

### 1.2 TMS 数学模型（Phase 2 简化）

依据 KOIF.md §5。Phase 2 实现 4 个子分，去掉对 BI 接口的依赖，仅用关键词域已 field_mapping 的字段近似：

| 子分 | 权重 | 主输入字段 | 缺值降级 |
| --- | --- | --- | --- |
| MoMScore（月环比强度） | 0.40 | `search_popularity_mom` | neutral_50 |
| YoYScore（年同比强度） | 0.30 | `search_popularity_yoy` | neutral_50 |
| SlopeScore（趋势斜率） | 0.20 | `trend_slope` → `search_growth_rate` | 二级 fallback → neutral_50 |
| ConsistencyScore（连续性） | 0.10 | `search_value_trend ∈ {rising,stable,falling}` | neutral_50 |

**合成**：`TMS = round(0.40·MoM + 0.30·YoY + 0.20·Slope + 0.10·Consistency)`，定义域 `[0, 100]`。

**趋势标签**（Phase 2 仅 3 类）：

| 区间 | trend_label | cn_name |
| --- | --- | --- |
| TMS ≥ 70 | `rising` | 上升 |
| 40 ≤ TMS < 70 | `stable` | 平稳 |
| TMS < 40 | `falling` | 下降 |

子分桶切分点定义在 `registry/keyword_trend_weights.yaml`，运行时哈希进 `weights_hash`，参与 `config_hash`。

### 1.3 数据形态（接口签名）

| 类型 | 关键字段 | 说明 |
| --- | --- | --- |
| `TrendRecord` | extends `KeywordMetricRecord`，加 `scores{mom,yoy,slope,consistency,tms}`、`trend_label`、`explanation{subscores[],rank_reason}` | 单关键词打分结果 |
| `TmsSubScore` | `name`、`inputs[]`（含 var/value/bucket）、`result`、`fallback_chain?` | 单子分追溯 |
| `TrendRunMeta` | `run_id`、`capability="keyword_trend"`、`score_domain="trend"`、`koif_aggregatable=true`、`category`、`category_id`、`weights_hash`、`config_hash`、`live_probe`、`pull_report`、`total/rising/stable/falling_count` | run 元数据，KOIF Router 直接读它 |
| `TrendResult` | `meta`、`records[]`、`top_rising[]`、`top_falling[]` | 落盘 `trend_result.json` |

### 1.4 入口契约

```
analyzeKeywordTrend(input: AnalyzeKeywordTrendInput)
  : Promise<AnalyzeKeywordTrendOutput | AnalyzeKeywordTrendError>
```

| 入参 | 类型 | 默认 |
| --- | --- | --- |
| `category` | string | 必填 |
| `category_id?` | string | resolve 时按 V2 规则匹配 |
| `live?` | boolean | `false`（fixture 模式） |
| `date_range?` | `{start_date,end_date}` | live 模式默认近 30 天 |
| `top_n?` | number | 20 |

**输出**：`{ meta, records, top_rising, top_falling, run_dir }`，`run_dir = registry/derived/keyword_trend/<run_id>/`，落两份产物：`run.meta.json`、`trend_result.json`、`trend_summary.md`。

### 1.5 fixture 复用策略

`fixtures/keyword_trend_mock/category_<name>.json` 缺失时，自动回落 `fixtures/keyword_demand_mock/category_<name>.json`（同源 raw_by_api，KDS/TMS 共享）。Phase 2 不强制单独造 TMS fixture。

### 1.6 决策依据

| 选择 | 依据 |
| --- | --- |
| 与 keyword_demand 同根 fixture | KOIF.md §5.1 规定 KDS/TMS 同输入域；避免 fixture 漂移 |
| 子分桶用阈值表而非连续函数 | 与 `kds_weights.yaml` 风格统一，可解释、易调参、可哈希 |
| 缺值 neutral_50 | KOIF.md §5.4 保守原则：缺值不应被惩罚为 0，否则 TMS 整体偏低 |
| 趋势仅 3 档 | Phase 2 路由规则只用 `rising/stable/falling`，6 档没有路由消费方 |

---

## §2 KOIF Router — `koif_router`

### 2.1 模块责任

```
src/services/koif_router/
├── types.ts        RouterInput / RouterOutput / ScoreVector / StrategyRoute / NextAction / RouterRunMeta
├── resolve.ts      S1：归一 category（直接复用 keyword_demand.resolve）
├── invoke.ts       S2：并行调用各 capability 的 analyze 函数（按 capabilities[] 入参分发）
├── aggregate.ts    S3+S4：扫各 run_dir → 读 meta + result → 聚合成 ScoreVector
├── route.ts        S5：apply registry/koif_route_rules.yaml，按条件命中 strategy_routes[]
├── actions.ts      S6：apply registry/koif_action_templates.yaml，按 strategy 渲染 next_actions[]
├── write.ts        S7：落盘 router_meta / score_vector / strategy_routes / next_actions / router_report.md
└── index.ts        proposeKoifStrategy(input) 编排器，串 S1~S7
```

### 2.2 数据流（一图）

```
LLM/UI ──▶ propose_koif_strategy(category, capabilities=["kds","tms"])
                │
        S1 resolve category
                │
        S2 fan-out invoke
        ├─▶ analyze_keyword_demand → KDS run_dir
        └─▶ analyze_keyword_trend  → TMS run_dir
                │
        S3 read run.meta + scores 落盘文件
                │
        S4 aggregate per-keyword → ScoreVector { keyword, scores{kds,tms,...}, available_scores }
                │
        S5 route.ts apply rules → strategy_routes[]
                │
        S6 actions.ts apply templates → next_actions[]
                │
        S7 write router_run → registry/koif_routes/<router_run_id>/
                │
        return { router_run_id, strategy_routes, next_actions, score_vector_top_n }
```

### 2.3 入口契约

```
proposeKoifStrategy(input: ProposeKoifStrategyInput)
  : Promise<ProposeKoifStrategyOutput | ProposeKoifStrategyError>
```

| 入参 | 类型 | 说明 |
| --- | --- | --- |
| `category` | string | 必填 |
| `category_id?` | string | resolve 优先匹配 |
| `capabilities?` | `("kds"\|"tms")[]` | 默认 `["kds","tms"]`（Phase 2 全集） |
| `live?` | boolean | `false`（默认 fixture） |
| `top_n?` | number | strategy_routes 内 keyword 列表截断长度（默认 10） |

**输出**：

| 字段 | 说明 |
| --- | --- |
| `router_run_id` | 与 capability run_id 同构，前缀 `router_v1__` |
| `strategy_routes` | 命中策略数组，每条含 `strategy_id`/`hit_keywords[]`/`reason`/`confidence` |
| `next_actions` | 渲染后的行动建议数组，每条含 `action_id`/`title`/`keywords[]`/`payload` |
| `score_vector_top_n` | TOP N 关键词的合并分数预览（不返全量，全量在 run_dir） |
| `capability_runs` | `{ kds: run_id, tms: run_id }` 用于追溯 |

### 2.4 router_run 产物

```
registry/koif_routes/<router_run_id>/
├── router_meta.json        触发的 capabilities + 各 capability run_id + 路由规则 hash
├── score_vector.json       全量聚合分数（按 keyword 合并 KDS+TMS）
├── strategy_routes.json    命中策略详细
├── next_actions.json       行动建议详细
└── router_report.md        业务报告（KOIF.md §13 风格，纯中文）
```

### 2.5 路由规则（Phase 2 仅 3 条）

依据 `registry/koif_route_rules.yaml`：

| strategy_id | 命中条件 | 业务含义 |
| --- | --- | --- |
| `old_product_optimization` | `kds >= 70` | 老品标题/主图重写 |
| `trend_test` | `tms >= 75 AND kds >= 60` | 上升期付费/直播测款 |
| `content_candidate` | `kds >= 70 AND tms >= 70` | 内容种草候选（CES 缺失时用 KDS+TMS 代理） |

> 三条规则可同时命中，输出顺序按命中关键词数降序。`confidence` = 命中关键词数 / 全量关键词数（Phase 2 简化口径）。

### 2.6 行动建议模板（Phase 2 三类）

依据 `registry/koif_action_templates.yaml`：

| action_id | 触发 strategy | 模板要点 |
| --- | --- | --- |
| `title_rewrite` | `old_product_optimization` | 给出 TOP K 关键词 + 重写要点（搜索词嵌入位置/同义扩展） |
| `content_topic` | `content_candidate` | 给出 TOP K 关键词 + 推荐切入角度（疑问/对比/场景） |
| `paid_test` | `trend_test` | 给出 TOP K 关键词 + 建议预算分档/出价区间（仅占位，Phase 3 接 PVS） |

### 2.7 错误模式

| code | 触发 | 处理 |
| --- | --- | --- |
| `koif_no_capabilities_available` | 所有传入 capability 在 live 模式被关闭 | 直接返回 error，不落盘 |
| `koif_score_aggregation_failed` | 任一 capability 返回 error 或产物缺失 | 标记该 capability `unavailable`，其余继续，`available_scores` 反映现实 |
| `koif_route_no_hit` | 全部规则未命中 | 返回空 `strategy_routes[]`，`router_report.md` 给出"无显著策略"摘要 |
| `koif_category_unresolved` | resolve 失败 | 透传 `keyword_demand.resolve` 的错误 |

### 2.8 决策依据

| 选择 | 依据 |
| --- | --- |
| Router 单独 service 子目录而非塞 keyword_demand | 业务定位（元工具）≠ capability；将来扩 PVS/CES 不动 keyword_* |
| S2 fan-out 不并发限流 | Phase 2 capability 数 ≤ 2，复杂度可忽略；Phase 3 引 worker_pool |
| confidence = 命中比例 | 简单可解释；Phase 3 引入加权置信（按 kds×tms 几何平均） |
| Router 不持久化全量 score_vector 到 LLM 返回 | 长 prompt 风险；只回 TOP N + run_id，详情让 LLM 用 `get_koif_route` 拉 |

---

## §3 工具封装

### 3.1 pi extension 注册（12 → 16 个）

`.pi/extensions/db_archaeologist.extension.ts` 增 4 个工具：

| 工具名 | 入参核心字段 | 输出核心字段 | 服务后端 |
| --- | --- | --- | --- |
| `analyze_keyword_trend` | category, category_id?, live?, top_n? | run_id, top_rising/falling, trend_summary 路径 | `keyword_trend.index` |
| `propose_koif_strategy` | category, capabilities?, live?, top_n? | router_run_id, strategy_routes, next_actions, capability_runs | `koif_router.index` |
| `list_koif_routes` | category?, limit? | runs[] (router_run_id + summary) | `koif_router.write.listRuns` |
| `get_koif_route` | router_run_id | router_meta, score_vector, strategy_routes, next_actions, report_md | `koif_router.write.readRun` |

### 3.2 web BFF 路由（5 个）

`web/server.mjs` 增：

| 方法 | 路径 | 转发至 |
| --- | --- | --- |
| POST | `/api/koif_routes/propose` | `propose_koif_strategy` |
| GET | `/api/koif_routes/runs` | `list_koif_routes` |
| GET | `/api/koif_routes/run/:id` | `get_koif_route` |
| GET | `/api/koif_routes/run/:id/report` | 直读 `router_report.md` |
| GET | `/api/koif_routes/run/:id/actions` | 直读 `next_actions.json` |

### 3.3 skills

| skill | 触发词 | 默认调用顺序 |
| --- | --- | --- |
| `keyword-trend` | "趋势/上升/下降/势头/会火吗" | `analyze_keyword_trend` → 必要时 `get_api_asset_card` 解释字段 |
| `koif-router` | "经营机会/综合分析/怎么做/策略/路由" | `propose_koif_strategy` → 取 `router_run_id` → `get_koif_route` 拉详情 |

错误回流：当 capability 报错时，skill 提示用户切 fixture 或检查 category 拼写，不允许 LLM 自行降级到无 run_id 的"凭印象回答"。

---

## §4 Registry 摘要

### 4.1 `registry/keyword_trend_weights.yaml`（新）

字段层级：

```
version / formula_id="tms_v1"
base_tms: { mom, yoy, slope, consistency }   # 权重和=1.0
mom_score: { primary: 桶切分→分数, fallback_neutral }
yoy_score: { primary, fallback_neutral }
slope_score: { primary, fallback_only_growth_rate, fallback_neutral }
consistency_score: { rising, stable, falling, fallback_neutral }
trend_labels: [{min, max, code, cn_name}, ...]   # 3 档
```

**初值表**：

| 子分 | 桶切分 → 分数 |
| --- | --- |
| MoM primary | ≥0.5→100 ≥0.2→80 ≥0.05→65 ≥0→50 ≥-0.1→35 <-0.1→15 |
| YoY primary | ≥0.3→100 ≥0.1→80 ≥0→60 ≥-0.1→40 <-0.1→20 |
| Slope primary | ≥0.5→100 ≥0.1→75 ≥0→55 <0→25 |
| Slope fallback (growth_rate) | ≥0.2→80 ≥0→55 <0→25 |
| Consistency | rising→100 stable→60 falling→20 |

### 4.2 `registry/koif_route_rules.yaml`（Phase 1 已建，Phase 2 锁定）

字段层级：

```
version / formula_id="koif_router_v1_kds_tms"
rules:
  - strategy_id: old_product_optimization
    when:   { kds: { gte: 70 } }
    weight: 1.0
  - strategy_id: trend_test
    when:   { kds: { gte: 60 }, tms: { gte: 75 } }
    weight: 1.0
  - strategy_id: content_candidate
    when:   { kds: { gte: 70 }, tms: { gte: 70 } }
    weight: 1.0
  # Phase 3+ paid_optimization / new_product_launch / blue_ocean ...
```

### 4.3 `registry/koif_action_templates.yaml`（Phase 1 已建，Phase 2 锁定）

字段层级：

```
templates:
  title_rewrite:
    triggered_by: [old_product_optimization]
    payload_schema: { keywords[], rewrite_hints[] }
    title_cn: 老品标题重写候选
  content_topic:
    triggered_by: [content_candidate]
    payload_schema: { keywords[], angles[] }
    title_cn: 内容种草角度建议
  paid_test:
    triggered_by: [trend_test]
    payload_schema: { keywords[], budget_band, bid_range }
    title_cn: 趋势测款投放候选
```

---

## §5 Fixtures 与 Golden

### 5.1 fixture 现状

| capability | fixture | 说明 |
| --- | --- | --- |
| `keyword_demand` | `fixtures/keyword_demand_mock/category_入户地垫.json` | 已存在 |
| `keyword_trend` | 复用上一项（`compute_tms` 直接读 `keyword_demand` 的 raw_by_api） | Phase 2 不单独造 |

### 5.2 Golden case：`koif_router_kds_tms_baseline`

**输入**：`{ category: "入户地垫", capabilities: ["kds","tms"], live: false, top_n: 5 }`

**断言点**（`tests/golden_cases/api_qa_cases.yaml` 内）：

| 断言 | 期望 |
| --- | --- |
| 调用入口 | `propose_koif_strategy` |
| `router_run_id` | 非空，匹配 `^router_v1__\d{12}__.+__[0-9a-f]{8}$` |
| `capability_runs.kds` | 非空，且对应 run_dir 存在 `entity_scores.json` |
| `capability_runs.tms` | 非空，且对应 run_dir 存在 `trend_result.json` |
| `strategy_routes` | 非空数组，至少包含 `old_product_optimization` |
| `next_actions` | 非空数组，至少一条 `action_id == "title_rewrite"` |
| router_run 产物 | `registry/koif_routes/<id>/` 下 `router_meta.json` `score_vector.json` `strategy_routes.json` `next_actions.json` `router_report.md` 全部生成 |
| `score_vector.json` | TOP 关键词 `available_scores` 包含 `["kds","tms"]` |

**dispatcher 改动**：`tests/golden.test.ts` 增 `case_kind: koif_router` 分支，失败时打印 `router_run_id` 与命中 strategy_id 列表，便于排查。

---

## §6 真机验收步骤

> 沙盒不允许执行 `npm` / `pi`，下列步骤必须在 macOS Terminal.app 真机执行。每步附**期望输出**与**失败回退**。

### 6.1 离线 smoke（无 LLM、无网）

```
cd /Users/yichen/Desktop/OntologyBrain/PI_AGENT/db-archaeologist-pi-spec-pack
npm run rebuild:all          # 期望 10 stage 全 ✓
DBA_PI_SMOKE=1 npm run smoke:pi   # 期望 16 个 tool 注册 + ALL GREEN
npm run test:golden          # 期望 10/10 GREEN（原 9 + 新增 koif_router_kds_tms_baseline）
```

| 失败信号 | 排查 |
| --- | --- |
| `koif_score_aggregation_failed` | 检查 `fixtures/keyword_trend_mock/` 与 `fixtures/keyword_demand_mock/` 是否同名同源 |
| `router_run_id` 非匹配 | 检查 `koif_router/trace.ts`（Phase 2 复用 keyword_trend trace 模式）run_id 拼装 |
| golden 抓不到 `next_actions` | 检查 `koif_action_templates.yaml` 的 `triggered_by` 是否对齐 strategy_id |

### 6.2 web 端到端

```
npm run web    # 默认 :4173
node web/_smoke.mjs   # 期望含 koif_routes propose / runs / run/:id 全 200
```

浏览器验证：访问 `http://127.0.0.1:4173`，Inspector 增 `KOIF Routes` 标签（Phase 2 仅展示 runs 列表 + run 详情 JSON，UI 美化留 Phase 3）。

### 6.3 真机 LIVE_PROBE pi

```
cd <spec-pack>
PI_CODING_AGENT_DIR="$(pwd)/.pi-home/agent" \
LIVE_PROBE=true \
pi --model aicodemirror/gpt-5.5
```

输入 prompt：

```
帮我看下"桌布"这个词的关键词经营机会
```

**期望路径**：

1. LLM 命中 `koif-router` skill
2. 调 `propose_koif_strategy({category:"桌布", capabilities:["kds","tms"], live:true})`
3. Router 内部 fan-out → 实拉 6 个 P0 关键词接口（`AppCodeKey`/`TenantId`/`UserId` 来自 `.env`）
4. 输出 `router_run_id` + 命中策略 + 行动建议（纯中文，无工程术语）
5. `registry/koif_routes/<id>/router_report.md` 落盘并被 LLM 引用

### 6.4 验收清单

- [ ] `npm run smoke:pi` 16 工具全注册
- [ ] `npm run test:golden` 10/10
- [ ] `web/_smoke.mjs` ALL GREEN（含 koif_routes/*）
- [ ] 真机 LLM 跑通"桌布"case，回答中提到 `router_run_id` 与至少一条 action
- [ ] `registry/koif_routes/` 至少留下一份真机 run 目录，5 个产物齐全
- [ ] `git status` 仅含本次预期文件，无误改

---

## §7 回滚预案

| 触发条件 | 回滚动作 | 影响面 |
| --- | --- | --- |
| TMS 公式有重大偏差 | 撤回 `keyword_trend_weights.yaml`、`compute_tms.ts`，禁用 `analyze_keyword_trend` 工具注册；Router 自动降级为 KDS-only | 不影响 KDS / golden case 全过；`strategy_routes` 仅命中 `old_product_optimization` |
| Router 路由结果错乱 | 把 `koif_route_rules.yaml` 的 3 条 rule 全部 `enabled: false`，Router 仍能产出 `score_vector.json`（用于离线诊断），返回 `koif_route_no_hit` | LLM 仍可拿 score_vector，给"无策略"提示而非误导 |
| pi 真机调用大量超时 | 在 extension 注册时给 `analyze_keyword_trend` 设 `live: false` 默认；必要时整体下线 `propose_koif_strategy` 工具，保留 `analyze_keyword_*` | web 不受影响；LLM 退化为单分析包工具 |
| Router run_dir 写盘异常 | `koif_router/write.ts` 改为 best-effort（落盘失败仍返回内存结果），并打印 warn；golden case 临时跳过落盘断言 | 短期容错，长期需修盘 IO |
| Phase 2 产物影响现网 | `git revert` 范围：本次新增 4 个 service 子目录 + 4 个 tool 文件 + extension/web 改动 + golden case 新行；registry 3 份 yaml 保留作 spec 备查（不影响运行） | 完全回到 Phase 1 spec-only 状态 |

---

## §8 后续

完成 Phase 2 后，Phase 3 路径见 `docs/14 §6 Appendix` 与 `docs/15 §7`：优先 PVS（付费价值）+ CPS（竞争压力），需要先补付费域 9 接口与竞争域 19 接口的 `field_mapping.yaml`，Router 路由规则增 `paid_optimization` 一节。