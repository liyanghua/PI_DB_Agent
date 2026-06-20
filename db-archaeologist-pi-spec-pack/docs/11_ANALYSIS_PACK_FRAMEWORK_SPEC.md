# Analysis Pack Framework Specification

## 1. 目的与边界

### 1.1 价值

把 `keyword_demand` 这类「自然语言 entity → 多源拉数 → 归一 → 业务报告」的流程从一次性实现升级为可复用骨架。框架在 spec-pack 内承担三件事：

- 给「关键词需求 / 趋势 / 竞品 / 评价 / 主图 / 详情 / 社媒」等分析能力共用同一套 `RunEnvelope` 与共享 lib（`resolve / pull / shape / normalize / compare`），把新增分析包的边际成本压到 1-2 天。
- 给 pi extension、web Inspector、golden case 提供统一的目录、文件、工具、错误码契约，避免每多一个分析能力就重写一遍 web 路由、SKILL.md 与回归用例。
- 把每个分析包的"业务公式 + 业务术语"显式集中在包内（`src/packs/<pack_id>/`），与共享底座解耦，使 Phase N+1 调整 KDS、趋势阈值或情感词典时只动 1 个包，不污染其他包。

### 1.1.1 KOIF 业务定位

`keyword_analysis_pack` namespace 的业务身份是 **KOIF（Keyword Operating Intelligence Framework，关键词经营洞察框架）**。KOIF 在工程层落到本框架的 namespace + capability 二级结构上：

| KOIF 业务概念 | 工程层落点 |
| --- | --- |
| KOIF namespace（关键词经营洞察） | `namespace = keyword_analysis_pack` |
| 8 个评分能力（KDS/TMS/PVS/CES/PFS/NOS/BDS/CPS） | 8 个 sibling capability，各自一份 manifest + 三件套工具 |
| score_vector（关键词的 8 维评分向量） | 跨 capability 聚合产物，由元工具 KOIF Router 生成 |
| strategy_routes（老品优化/开新品/内容种草/付费投流） | KOIF Router 元工具按 `koif_route_rules.yaml` 决策 |
| next_actions（每条策略的具体动作） | KOIF Router 元工具按 `koif_action_templates.yaml` 渲染 |

KOIF 全景见 [14_KOIF_NAMESPACE_OVERVIEW.md](14_KOIF_NAMESPACE_OVERVIEW.md)；KOIF Router 元工具见 [15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md) 与本规范 §12.2。

Phase 2 KOIF 落地范围：仅 `keyword_demand`（KDS）+ `keyword_trend`（TMS）两个 capability + KOIF Router 骨架；其余 6 个 capability（PVS/CES/PFS/NOS/BDS/CPS）以 stub 形式在 14 号 Appendix 占位，留 Phase 3+ 落地。

### 1.2 边界

- **不替换 ApiAssetCard 主链**：分析包是 `ApiAssetCard` 的下游消费者；`registry/derived/api_asset_cards.json` 和 `tool_registry.yaml` 的生成路径保持不变。
- **不引入 npm 依赖**：所有 stage / lib 用 Node builtins 实现，YAML 用 [src/lib/yaml_lite.ts](db-archaeologist-pi-spec-pack/src/lib/yaml_lite.ts)，schema 校验用 [src/lib/schema.ts](db-archaeologist-pi-spec-pack/src/lib/schema.ts)。
- **不做完整 BI 平台**：无任务调度、无人工标注闭环、无 vector store、无任务队列；分析包是按需触发的离散 run。
- **不做插件动态加载**：所有 pack 在编译期 `static import`；pack loader 仅扫描 `src/packs/*/manifest.yaml` 做注册校验。
- **不强制每个包都跑 8 stage**：包按需子集（trend_demand 跳过 classify/score/rank）。

### 1.3 不在本规范范围

- 各包的具体业务公式、阈值、报告文案：由对应 `docs/12_<pack>_PACK_SPEC.md` 等独立 spec 定义。
- 跨 pack 联合分析（同一 entity 一次出多包报告）：留 Phase N+2。
- 真实凭据/账号/secret 的 vault 设计：当前仍走 `.env` + `ZICHEN_*` 系列。
- 视觉/NLP 通用 stage 库：评价 / 主图 / 详情包真正落地后再下沉。

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| namespace | 家族包，承载同一业务域的多个 capability，对应 `src/packs/<namespace>/` 目录。1 namespace 可注入 N capability，如 `keyword_analysis_pack` 之下挂 `keyword_demand / keyword_trend / keyword_blue_ocean`。 |
| capability | 叶子能力，1 capability = 1 三件套工具 + 1 SKILL.md，对应 `src/packs/<namespace>/<capability>/` 目录与 1 份 `manifest.yaml`。 |
| pack | 旧术语；本规范统一为 `namespace + capability` 二元组，遗留文本里 `pack_id` 一律读作 `capability` 名。 |
| stage | pipeline 中的一个标准处理步，命名固定（S0..S8），capability 按需选用。 |
| RunEnvelope | 单次 run 的统一文件夹结构，落在 `registry/derived/<namespace>/<capability>/<run_id>/`。 |
| EntityContext | S1 resolve 的输出，描述「这次 run 的目标实体」是什么。 |
| strategy | 同一 namespace 内可切换的算法/权重组合，如 `baseline_v1` / `semantic_v2`。strategy 在 namespace 级别注册，capability 通过 `default_strategy` 引用。 |
| RunMeta | 单 run 的元数据 JSON，落在 `<run_dir>/run.meta.json`。 |
| _lib | 全局共享底座目录 `src/packs/_lib/`，纯函数、无业务语义、跨 namespace 复用。 |
| _shared | namespace 内共享目录 `src/packs/<namespace>/_shared/`，仅同 namespace 下的 capability 可读写。 |
| insight_template | 元工具层概念；`registry/seed/insight_templates.seed.yaml` 中的一条 topic 模板，声明可消费的 capability、字段 role、报告 schema。 |
| topic | 用户输入的洞察方向自然语言（如「竞争格局分析」），由元工具 `propose_insight_plan` 路由到具体 capability 的三件套。 |
| role | InsightPlan 给 API 字段打的语义角色（dimension / metric_main / metric_aux / time / id），决定下游模板取数顺序。 |
| KOIF | Keyword Operating Intelligence Framework，关键词经营洞察框架。`keyword_analysis_pack` namespace 的业务别名，承载 8 个评分能力 + KOIF Router 元工具。详见 docs/14。 |
| score_domain | capability 在 KOIF 中所归属的评分维度，取值 `demand / trend / paid / content / product_fit / new_opportunity / blue_ocean / competition` 之一。写入 `manifest.yaml` 的同名字段，是 KOIF Router 跨 capability 聚合 score_vector 的依据。 |
| score_vector | KOIF 跨 capability 聚合的关键词评分向量，形如 `{kds, tms, pvs, ces, pfs, nos, bds, cps}`，由 KOIF Router 在 `koif_routes/<router_run_id>/score_vector.json` 生成。Phase 2 仅含 `kds` 与 `tms`。 |
| strategy_routes | KOIF Router 根据 `koif_route_rules.yaml` 推导出的经营策略集合，如 `old_product_optimization / trend_test / content_candidate`。 |
| next_actions | KOIF Router 根据 `koif_action_templates.yaml` 渲染的可执行动作建议，每条含 `action / keywords / reason / template_id`。 |
| meta_tool | 元工具层概念；不走 stage pipeline，跨 capability 聚合或路由。当前包含 `propose_insight_plan`（通用洞察规划）与 `propose_koif_strategy`（KOIF 经营策略路由）。 |
| operating_intelligence | KOIF 业务术语，指「以经营动作为终点的洞察输出」，区别于「以指标解读为终点的传统报告」。next_actions 是其落地形态。 |

## 3. Stage 8 步标准契约

### 3.1 概述

每个 stage 是 `(input, ctx) => (output, trace)` 纯函数，包按需选用。每步输出立刻按统一文件名落到 `<run_dir>/`，便于 Inspector 回放与 LLM 追溯。

stage 间传递用 `in-memory object`，不通过文件；落盘只为人工审查与复现诊断。

### 3.2 S0: load_config

**输入**：
- `manifest: PackManifest`（从 `src/packs/<pack_id>/manifest.yaml` 加载）
- `user_input: unknown`（pi 工具传入的原始参数）

**输出**：
- `RunConfig`：包含 `strategy`、`weights`、`taxonomy`、`field_mapping` 等配置对象
- 产物文件：无（manifest 本身已落盘）

**跳过规则**：不可跳过。

**备注**：读取 `manifest.registry_refs.config` 声明的 yaml/json，按 `src/lib/schema.ts` 校验 schema；不合法直接抛错。

### 3.3 S1: resolve

**输入**：
- `entity_name: string`（用户输入，如 "入户地垫"）
- `entity_id?: string`（用户显式传入，如 "121364010"）
- `live: boolean`
- `config: RunConfig`（含 taxonomy + lookup_api 配置）

**输出**：
- `EntityContext`:
  ```yaml
  kind: category | item | shop | brand | comment_set | image | url
  id?: string                       # 解析到的 entity_id
  canonical: string                 # 规范名（taxonomy 命中时用 canonical_name）
  resolution_kind: taxonomy | user_id | auto_resolved | partial_no_id | mock_fixture_fallback
  auto_resolve_trace?: object       # auto-resolve 时返回的候选列表与耗时
  mock_fixture_fallback?: object    # 仅 fixture 模式 + taxonomy miss 时填，含 candidates[5] + score + reason
  ```
- 产物文件：`resolution.json`

**跳过规则**：当 `entity_kind` 不需要 id（如 `url` 类 entity）时可跳过。

**降级路径（5 态）**：
1. `taxonomy`：命中 `category_taxonomy.yaml` 的 canonical_name / tertiary_category / aliases。
2. `user_id`：taxonomy miss 但用户显式传 `entity_id`，直接采纳。
3. `auto_resolved`（仅 live=true）：调 `manifest.lookup_api`（如 `data_keywords_category_list`）反查 entity_id，命中即返。
4. `partial_no_id`（仅 live=true）：auto-resolve 也失败时，以 `id=undefined` 继续跑 S2，让接口在缺 id 时退化。
5. `mock_fixture_fallback`（仅 live=false）：fixture 模式下 taxonomy miss 时，按 alias / contains 在 taxonomy 中打分，选 top1 已知类目继续跑，trace 落 candidates[5]+score+reason。**仅服务单测、golden case、离线 demo**；任何 live run 不允许走此分支。

**错误条件**：仅当 live=true 且降级到 `partial_no_id` 后 S2 全部接口失败，才上抛 `entity_not_resolved`；fixture 模式不返此错。

### 3.4 S2: pull

**输入**：
- `EntityContext`
- `date_range: {start_date, end_date}`
- `field_mapping: FieldMapping`（含 `apis[].request_template / response_root / keyword_field`）

**输出**：
- `probe_results: Record<api_id, ApiProbeResult>`（每接口的完整响应、HTTP 状态、耗时）
- `pull_report: PullReportSummary`（每接口状态归一、有效接口数、总关键词数）
- 产物文件：`live_probe_results.json` + `pull_report.json`

**跳过规则**：当 `live=false` 时读 `fixtures/<pack_id>/<entity>.json`，不走 S2；fixture 路径由包自己定义。

**备注**：
- 串行调用 `probeApiSample`（每接口间隔 150ms，避免限流）。
- `request_template` 渲染占位符：`{entity_id}` / `{start_date}` / `{end_date}` / `{tenant_id}` / `{user_id}`。
- 状态归一为 10 类：`ok / empty / business_empty / business_failed / data_root_null / root_path_mismatch / keyword_field_missing / context_mismatch / skipped_missing_entity_id / http_error / network_error / timeout / live_disabled / env_missing / not_registered`。
- `context_mismatch` 门控：按 `field_mapping.apis[*].response_context.{category_field, date_field}` 校验返回样本的类目/日期是否与请求一致，不一致则 `status=context_mismatch`，样本清空。

### 3.5 S3: shape

**输入**：
- `probe_results: Record<api_id, ApiProbeResult>`
- `field_mapping: FieldMapping`（含 `apis[].response_root / keyword_field`）

**输出**：
- `rawByApi: Record<api_id, RawRecord[]>`（规整为统一 `Record<string, unknown>[]`）
- `shape_report: ShapeReport`（每接口的 `data_kind / inner_field / count`）
- 产物文件：`shape_report.json`

**跳过规则**：不可跳过（除非 live=false 走 fixture 分支）。

**备注**：
- `response_root = "data.result[]"` → 取 `probe.response.top: unknown[]` 直接用。
- `response_root = "data"` 单对象 → 尝试从对象里找数组字段（候选：`list / data / records / keywords / items`），抽出来；若找不到数组则把对象作为单元素数组 `[obj]`。
- 非对象元素（数字/字符串）→ 跳过，标 `unexpected_payload`。

### 3.6 S4: normalize

**输入**：
- `rawByApi: Record<api_id, RawRecord[]>`
- `field_mapping: FieldMapping`（含 `apis[].field_map / merge_order_priority / keyword_field`）

**输出**：
- `metric_records: MetricRecord[]`（按 entity 维度合并，如 keyword）
- `normalize_report: NormalizeReport`（字段覆盖率、merge 决胜源、降级触发）
- 产物文件：`metric_records.json` + `normalize_report.json`

**跳过规则**：不可跳过。

**备注**：
- 按 `keyword_field`（通用名 `entity_field`）分组。
- 同一 entity 多源字段按 `merge_order_priority` 取首个非空值。
- `field_map` 做字段重命名（如 `search_popularity_mom` ← `search_popularity_mom` / `search_growth_rate`）。

### 3.7 S5: enrich

**输入**：
- `metric_records: MetricRecord[]`
- `pack_private_config: object`（如 `keyword_taxonomy` / `sentiment_lexicon`）

**输出**：
- `enriched_records: EnrichedRecord[]`（打标后的记录）
- `enrichment_trace: object[]`（每条 entity 的标签命中 trace）
- 产物文件：`enrichment_trace.jsonl`

**跳过规则**：可选；trend_demand 跳过。

**备注**：
- 包私有 stage，业务语义强。
- keyword_demand 的 S5 是 `classify`（12 类标签匹配）。
- 评价包的 S5 是 `sentiment`（情感打分）。
- 主图包的 S5 是 `vision`（视觉要素提取）。

### 3.8 S6: score

**输入**：
- `enriched_records: EnrichedRecord[]`
- `weights: Weights`（strategy 对应的权重 yaml）

**输出**：
- `scored_records: ScoredRecord[]`（每 entity 含 `scores.{scale, growth, ...} + kds`）
- `score_trace: object[]`（每条 entity 的子项计算 trace，可回溯 pctRank / fallback）
- 产物文件：`score_trace.jsonl` + `<entity>_scores.json`

**跳过规则**：可选；trend_demand 跳过。

**备注**：
- 包私有 stage，公式在 `src/packs/<pack_id>/strategies/<strategy>.ts`。
- keyword_demand 的 S6 按 KDS 公式（4 子项权重 + intent_multiplier）。
- 评价包的 S6 按情感强度 + 提及频次。

### 3.9 S7: rank

**输入**：
- `scored_records: ScoredRecord[]`
- `rank_options: {top_n, per_type_top, ...}`

**输出**：
- `rank_result: RankResult`:
  ```yaml
  top_overall: ScoredRecord[]           # 总榜 TOP N
  top_by_type: Record<type, ScoredRecord[]>
  top_by_metric: Record<metric, ScoredRecord[]>
  ```
- 产物文件：`<entity>_top.json`

**跳过规则**：可选；trend_demand 跳过（替换为包私有 `trend_compute` stage）。

**备注**：
- 按分数降序排序 + 切片。
- `top_by_type` 按 S5 打的标签分组排序。

### 3.10 S8: report

**输入**：
- `RunMeta`（含 pull_report / normalize_report）
- `rank_result: RankResult` 或 包私有计算结果（如 trend_demand 的 `{rising, falling, volatile, stable}`）
- `manifest.report_sections: ReportSection[]`

**输出**：
- `report.md`：业务报告（中文、零工程术语、分节按 manifest 声明）
- `run_summary.md`：1 屏摘要（300-500 字）
- 产物文件：`report.md` + `run_summary.md`

**跳过规则**：不可跳过。

**备注**：
- 模板在 `src/packs/<pack_id>/report.ts`。
- keyword_demand 报告 9 节（数据来源 / 可信度 / TOP5 归因 / 各需求类型 / 蓝海 / reject / 降级 / 已知 GAP / 行动建议）。
- trend_demand 报告 5 节（数据来源 / 上升 TOP10 / 下滑 TOP10 / 异动 TOP10 / 稳定头部 TOP10）。

### 3.11 包私有 stage 替换规则

trend_demand 不跑 S5/S6/S7，自带一个 `trend_compute` stage：

- 位置：在 S4 normalize 之后、S8 report 之前。
- 输入：`metric_records[]`（共用 keyword_demand 的 metric_records 形态）。
- 输出：`{rising, falling, volatile, stable}: TrendRecord[]`。
- 产物文件：`trend_result.json`。

包私有 stage 不写进 `_lib`，不受框架 8-stage 命名约束。

## 4. RunEnvelope

### 4.1 目录结构

```
registry/derived/<namespace>/<capability>/
  <run_id>/                         # 单次正式 run
    run.meta.json                   # RunMeta，详见 §4.3
    input.json                      # 用户原始入参
    resolution.json                 # S1 输出
    pull_report.json                # S2 摘要
    live_probe_results.json         # S2 完整 probe 数据（仅 live 模式）
    shape_report.json               # S3 摘要
    metric_records.json             # S4 输出
    normalize_report.json           # S4 trace
    enrichment_trace.jsonl          # S5（可选，capability 私有）
    score_trace.jsonl               # S6（可选）
    <entity>_scores.json            # S6 输出（可选）
    <entity>_top.json               # S7 输出（可选）
    <pack_private>.json             # capability 私有 stage 输出（如 trend_result.json）
    report.md                       # S8 业务报告（统一文件名）
    run_summary.md                  # S8 1 屏摘要

  _diag/<run_id>/                   # 失败诊断（live_no_keyword_data 等）
    run.meta.json
    pull_report.json
    live_probe_results.json
    DIAGNOSTIC_README.md

  _compare/                         # 两 run 对比
    compare_<runA>__<runB>.md
    compare_<runA>__<runB>.json

  _eval/                            # golden 评测
    <eval_id>.json
```

历史目录 `registry/derived/keyword_demand/` 在 Phase 2 落码时作为 alias 软链或双写保留 ≥ 2 个版本，详见 §4.5。

元工具 `propose_insight_plan` 的产物落 `registry/derived/_insight_plans/<plan_id>.json`，与 capability runs 同级但独立目录，详见 §12。

元工具 `propose_koif_strategy` 的产物落 `registry/koif_routes/<router_run_id>/`，作为跨 capability 的「KOIF 经营策略路由」根目录，独立于 `registry/derived/`：

```
registry/koif_routes/
  <router_run_id>/                  # 单次 router run
    router_meta.json                # 触发的 capabilities + 各自 run_id + 聚合时间戳
    score_vector.json               # 跨 capability 聚合的 8 维评分向量
    strategy_routes.json            # 命中 koif_route_rules.yaml 的策略集合
    next_actions.json               # 按 koif_action_templates.yaml 渲染的行动建议
    router_report.md                # 业务报告（KOIF 经营策略 + TOP actions）
```

`router_run_id` 命名为 `<YYYYMMDDHHmm>__koif__<entity_id>__<sha8>`，`sha8` 覆盖参与的 `capabilities` 列表 + 各 capability 的 `run_id` + `koif_route_rules.yaml` 的内容哈希。详见 [15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md) §3-§4。

### 4.2 run_id 命名

```
<YYYYMMDDHHmm>__<strategy>__<entity_id>__<sha8>
```

- `YYYYMMDDHHmm`：本地时区，run 启动时刻。
- `strategy`：从 `manifest.default_strategy` 或用户传入。
- `entity_id`：S1 解析到的 id；`partial_no_id` / `mock_fixture_fallback` 时用 `partial`。
- `sha8`：`config_hash` 的前 8 位（SHA-256），覆盖 weights / taxonomy / fixture / entity_id / date_range / namespace / capability。

### 4.3 RunMeta JSON Schema

```yaml
run_id: string
namespace: string                   # 必填，如 "keyword_analysis_pack"
capability: string                  # 必填，如 "keyword_demand"
analysis_pack_id: string            # 兼容字段，等同 capability；旧字段，过渡期保留
analysis_pack_name?: string         # 中文显示名，从 manifest.cn_name 来
manifest_version: string            # manifest.yaml 的 version 字段值
strategy: string
version: string                     # capability 实现版本
config_hash: string                 # 完整 SHA-256
weights_hash: string
taxonomy_hash: string
fixture_hash?: string               # 仅 live=false 时填；mock_fixture_fallback 时为 "live_failed"
entity:
  kind: string                      # category / item / shop / brand / ...
  name: string                      # 用户原文（= requested_<kind>）
  id?: string
  canonical?: string                # taxonomy 命中时的规范名（= analysis_<kind>）
requested_category?: string         # 兼容字段；keyword_demand 专用，等同 entity.name
analysis_category?: string          # 兼容字段；keyword_demand 专用，等同 entity.canonical
started_at: string                  # ISO 8601
ended_at?: string
elapsed_ms?: number
stage_timings?: Record<stage, number>
live_probe?: boolean
auto_upgraded_to_live?: boolean     # 默认 live 升级时为 true（详见 §9.2）
date_range?: {start_date, end_date}
date_range_source?: "manifest_default" | "user_input"
resolution?: ResolutionInfo         # 与 EntityContext 同构，含 mock_fixture_fallback 子结构
pull_report?: PullReportSummary
diagnostic?:                        # 仅 _diag/<run_id> 下的 meta 才有
  kind: "live_no_keyword_data" | "pull_no_data" | "shape_mismatch"
  effective_apis: number
  total_keywords: number
  reason: string
```

`namespace + capability` 是新主键；`analysis_pack_id` 是过渡期兼容字段，Phase 2 第一版双写、第二版起以 `capability` 为准。`requested_<kind>` / `analysis_<kind>` 仅 keyword_demand 历史字段保留，新 capability 一律用 `entity.name` / `entity.canonical`。

### 4.4 包间隔离

- `registry/derived/<namespace>/<capability>/` 是单 capability 独占目录；同 namespace 不同 capability 互不读写，跨 namespace 更不可见。
- `listRuns({namespace, capability, ...})` 必须同时传两个 key，框架不提供跨 capability 列表。
- `_compare/` 与 `_eval/` 也按 capability 隔离；不同 capability / 不同 namespace 的 run 不能 cross-compare。

### 4.5 兼容现有 keyword_demand

现有 keyword_demand run 已落在 `registry/derived/keyword_demand/<run_id>/`。Phase 2 迁移时：

1. 主写路径切到 `registry/derived/keyword_analysis_pack/keyword_demand/<run_id>/`。
2. `registry/derived/keyword_demand/` 保留为 alias：双写或符号链接，listRuns 同时扫两份，去重按 `run_id`。
3. 文件名调整：
   - `run.meta.json` ✓
   - `keyword_baseline_report.md` → 框架契约要求改名为 `report.md`（双写期同时落 `keyword_baseline_report.md` 与 `report.md`）
   - `category_top_keywords.json` → 改名为 `keyword_top.json`（双写）
   - `keyword_scores.json` → 不变
4. RunMeta 字段同步双写：旧字段 `analysis_pack_id / requested_category / analysis_category` 保留 1 个版本，新字段 `namespace / capability / entity.*` 立即生效。
5. 过渡期 ≥ 2 个版本后清理 alias 与旧文件名，节奏写在 Phase 2 SOP。

详见 [12_KEYWORD_DEMAND_PACK_SPEC.md](12_KEYWORD_DEMAND_PACK_SPEC.md) §3。

## 5. PackManifest

### 5.1 文件位置

`src/packs/<namespace>/<capability>/manifest.yaml`

由 framework loader 在启动时静态扫描 + 校验；不允许运行时动态加载（避免 ESM loader 与 Cursor sandbox 冲突）。

注册表 `registry/keyword_analysis_packs.json` 同步声明 `namespaces[].capabilities[]` 列表，与磁盘 manifest 校验一致性，不一致则 exit 1。

### 5.2 完整 schema

```yaml
namespace: string                   # 必填，家族包名；下划线分词，全小写；目录第 1 级
capability: string                  # 必填，叶子能力名；下划线分词，全小写；目录第 2 级
cn_name: string                     # 中文显示名（capability 级）
namespace_cn_name: string           # 中文显示名（namespace 级，所有 capability 共享）
version: string                     # SemVer，capability 级
entity_kind: category | item | shop | brand | comment_set | image | url
description: string

score_domain?: demand | trend | paid | content | product_fit | new_opportunity | blue_ocean | competition
                                    # KOIF 专用；声明该 capability 归属的评分维度。
                                    # 仅 namespace="keyword_analysis_pack" 且该 capability 参与 KOIF Router 聚合时必填。
                                    # Phase 2: keyword_demand (demand) / keyword_trend (trend)
                                    # Phase 3+: paid_value (paid) / content_expansion (content) / product_fit (product_fit) /
                                    #           new_opportunity (new_opportunity) / blue_ocean_demand (blue_ocean) / competition_pressure (competition)
koif_aggregatable?: boolean         # 是否可被 KOIF Router 消费；默认 false，KOIF capability 设为 true

siblings: [string]                  # 同 namespace 下其他 capability 的列表（占位 + 已实现），便于 SKILL 路由提示

stages_used:                        # 必填，按 8-stage 选用；私有 stage 写完整名
  - resolve
  - pull
  - shape
  - normalize
  - classify                        # capability 私有别名，对应 S5 enrich
  - score
  - rank
  - report

registry_refs:
  config:                           # 全局共享 registry，所有 capability 只读
    - registry/category_taxonomy.yaml
    - registry/keyword_field_mapping.yaml
    - registry/keyword_strategies.yaml
  namespace_shared:                 # namespace 内共享 registry，仅同 namespace 的 capability 可读写
    - registry/keyword_taxonomy.yaml
    - registry/keyword_taxonomy.baseline_v1.locked.yaml
  capability_private:               # capability 私有 registry
    - registry/kds_weights.yaml
    - registry/kds_weights.baseline_v1.locked.yaml

default_strategy: string            # 必填，必须在 keyword_strategies.yaml 注册
supported_strategies: [string]      # capability 支持的全部 strategy id；framework 校验是否都在 keyword_strategies.yaml 注册
default_live: boolean               # 默认是否走 live；本规范规定所有 capability 默认 true（见 §9）
default_date_range: string          # 形如 "T-9..T-3"，单位天

lookup_api?: string                 # auto-resolve 用的 lookup api_id（可选）

report_sections:                    # 报告节序，S8 渲染时遵循
  - id: string                      # 节锚点
    cn: string                      # 中文标题
    required: boolean

tools:                              # 三件套工具命名
  analyze: string                   # 必填；"analyze_<capability>"
  list_runs: string                 # 必填；"list_<capability>_runs"
  compare: string                   # 必填；"compare_<capability>_runs"

skill:                              # SKILL.md 路径（相对 spec-pack 根）
  path: string                      # ".pi/skills/<capability>/SKILL.md"
  trigger_keywords: [string]        # 触发词列表，用于 SKILL 路由

fixture_dir?: string                # live=false 时的 fixture 目录
diagnostic_root: string             # _diag 目录路径，默认 "registry/derived/<namespace>/<capability>/_diag"

insight_templates?: [string]        # 该 capability 可消费的 insight_template id 列表（见 §12）
```

### 5.3 校验规则

`scripts/validate_packs.ts`（Phase 2 引入）启动时硬校验：

| 规则 | 失败行为 |
| --- | --- |
| `namespace` 与父目录名一致 | exit 1 |
| `capability` 与叶子目录名一致 | exit 1 |
| `tools.analyze` 命名为 `analyze_<capability>` | exit 1 |
| `tools.list_runs` 命名为 `list_<capability>_runs` | exit 1 |
| `tools.compare` 命名为 `compare_<capability>_runs` | exit 1 |
| 同 `capability` 名在所有 namespace 内全局唯一 | exit 1 |
| `default_strategy ∈ supported_strategies` | exit 1 |
| `supported_strategies[]` 全部在 `keyword_strategies.yaml` 注册 | exit 1 |
| `koif_aggregatable=true` 时 `score_domain` 必填 | exit 1 |
| `score_domain` 在同 namespace 内不重复 | exit 1 |
| `registry_refs.config[]` 文件存在 | exit 1 |
| `registry_refs.namespace_shared[]` 文件存在 | exit 1 |
| `registry_refs.capability_private[]` 文件存在 | exit 1 |
| `stages_used[]` 不能同时为空且不含 report | exit 1 |
| `entity_kind` 在白名单内 | exit 1 |
| `siblings[]` 全部在 `registry/keyword_analysis_packs.json` 的同 namespace 下声明（占位也算） | exit 1 |
| `insight_templates[]` 全部在 `registry/seed/insight_templates.seed.yaml` 注册 | exit 1 |

校验脚本由 `scripts/rebuild_all.ts` 在 Stage 0 之前执行。

### 5.4 manifest 与 PackImpl 的绑定

```ts
// src/packs/<namespace>/<capability>/index.ts
import manifest from "./manifest.yaml";
import { runStages } from "../../_lib/runner.js";
import { resolveCategory } from "../_shared/resolve.js";          // namespace 内复用

export async function runPack(input: PackInput): Promise<PackOutput> {
  return runStages(manifest, input, {
    resolve: resolveCategory,
    pull: livePullKeywordMetrics,
    shape: shapeRawByApi,
    normalize: normalizeKeywordMetrics,
    classify: classifyKeywords,
    score: scoreRecords,
    rank: rankScored,
    report: buildBusinessReport,
  });
}
```

`runStages` 按 `manifest.stages_used` 顺序拉起对应函数；没声明的 stage 跳过。capability 私有 stage 通过同样接口注入。

## 6. 共享 lib 边界与禁区

### 6.1 三层共享层级

代码复用从下到上分三层，任何函数下沉到哪一层由作用域决定：

| 层级 | 路径 | 适用条件 |
| --- | --- | --- |
| 全局 _lib | `src/packs/_lib/` | 跨 namespace 复用（关键词 / 评论 / 主图都用），业务无关 |
| namespace _shared | `src/packs/<namespace>/_shared/` | 同 namespace 跨 capability 复用（demand / trend / blue_ocean 共用），含家族业务语义但跨 capability |
| capability 私有 | `src/packs/<namespace>/<capability>/` | 仅本 capability 使用 |

下沉到 `_lib` 必须同时满足：
1. **业务无关**：不含领域术语（如 "KDS" / "蓝海" / "意图明确度"），不读 namespace 私有 registry。
2. **跨 namespace 复用**：至少被 2 个 namespace 用到。
3. **纯函数**：无副作用、无 fs 写、无外网、无 process.exit。

下沉到 `_shared` 只需满足：
1. **跨 capability 复用**：同 namespace 下被 2+ capability 用到。
2. **不读其他 capability 的私有 registry**。

反例（必须留 capability 内）：
- `classify`：12 类标签定义、`matched_terms` 追踪，强绑定 keyword_demand。
- `score baseline_v1`：KDS 4 子项公式、intent_multiplier 规则，强绑定 keyword_demand。
- `report 9 节模板`：业务文案（"规模高转化稳"），强绑定 keyword_demand。

### 6.2 _lib 目录结构

```
src/packs/_lib/
  run_envelope.ts         # buildRunId / hashConfig / initRun / finalizeRun / writeStageOutput / listRuns / getRunMeta
  resolve_framework.ts    # resolveByTaxonomy + autoResolveViaLookupApi + ResolutionInfo type（含 mock_fixture_fallback）
  live_pull_framework.ts  # renderRequestTemplate + serialPull + context_mismatch 校验 + per_api status 归一
  shape_framework.ts      # response_root 解析（data.result[] / data 单对象 / 嵌套数组）+ shape_report 生成
  normalize_framework.ts  # 多源合并 + merge_order_priority + field_map 映射 + normalize_report
  score_lib.ts            # pctRank / minMax / weightedSum / intentMultiplier（通用打分原语）
  compare_lib.ts          # TOP 重叠 / Spearman / Kendall / NDCG / 词位移 / 分数分布 diff
  types.ts                # RunMeta / EntityContext / PullReportSummary / NormalizeReport / RunEnvelope / PackManifest
  runner.ts               # runStages 调度器（按 manifest.stages_used 顺序拉起 + 默认 live 升级判定）
  insight_plan.ts         # InsightPlan schema + 元工具产物读写（见 §12）
```

### 6.3 _lib 函数签名规范

所有 _lib 函数必须：

- 返回 `Result<T, E>` 或 `Promise<Result<T, E>>`，不抛异常（除 schema 校验）。
- 错误用 `{ok: false, error: string, details?: string}` 形式。
- 输入参数不超过 3 个；超过用 object 包。
- 不读 `process.env`（除 runner.ts 读 `LIVE_PROBE`）。

### 6.4 import 路径方向规则

依赖方向从内向外，不可反向：

合法：
```
src/packs/<namespace>/<capability>/*.ts
  -> import from "../_shared/*"
  -> import from "../../_lib/*"

src/packs/<namespace>/_shared/*.ts
  -> import from "../../_lib/*"
```

非法：
```
src/packs/_lib/*.ts
  -> import from "../<namespace>/_shared/*"     ❌ 禁止
  -> import from "../<namespace>/<capability>/*" ❌ 禁止

src/packs/<namespace_a>/<capability_x>/*.ts
  -> import from "../../<namespace_b>/_shared/*" ❌ 禁止跨 namespace
```

### 6.5 历史代码迁移策略

现有 keyword_demand 代码在 `src/services/keyword_demand/`。Phase 2 重构时：

1. 把 `trace / live_pull / shape / normalize / compare` 通用部分迁到 `src/packs/_lib/`（跨 namespace 通用）。
2. 把 `resolve / auto_resolve` 迁到 `src/packs/keyword_analysis_pack/_shared/`（namespace 内 demand / trend / blue_ocean 共用）。
3. 把 `classify / score / rank / report` 迁到 `src/packs/keyword_analysis_pack/keyword_demand/`（capability 私有）。
4. 在 `src/services/keyword_demand/` 保留 thin shim（reexport），过渡期 ≥ 2 个版本。
5. 把 `index.ts` 迁到 `src/packs/keyword_analysis_pack/keyword_demand/index.ts`，改为读 manifest + 调 `runStages`。

旧 import path 保留期见 SOP（Phase 2 交付时附《import path shim 移除节奏》）。

## 7. 三件套工具契约

### 7.1 命名固定

每个 capability 暴露 3 个 pi 工具，命名严格遵循 `<verb>_<capability>` 形式（capability 名全局唯一保证不冲突）：

| 工具 | 命名规则 | 示例 |
| --- | --- | --- |
| 分析入口 | `analyze_<capability>` | `analyze_keyword_demand` / `analyze_keyword_trend` |
| 列 runs | `list_<capability>_runs` | `list_keyword_demand_runs` / `list_keyword_trend_runs` |
| 对比 runs | `compare_<capability>_runs` | `compare_keyword_demand_runs` / `compare_keyword_trend_runs` |

工具命名中**不**带 namespace 前缀，靠 capability 名全局唯一来避免冲突；这一约束写入 §5.3 校验规则。

`list_keyword_runs` / `compare_keyword_runs` 是 keyword_demand 的历史命名，Phase 2 双写 alias 保留 ≥ 2 个版本，详见 [12_KEYWORD_DEMAND_PACK_SPEC.md](12_KEYWORD_DEMAND_PACK_SPEC.md) §3。

### 7.2 analyze_<pack_id> schema

```yaml
input:
  entity: string                    # 必填；自然语言（如 "入户地垫"）
  entity_id?: string                # 可选；用户显式传（如 "121364010"）
  strategy?: string                 # 可选；默认走 manifest.default_strategy
  live?: boolean                    # 可选；默认走 manifest.default_live；框架可自动升级（见 §9.2）
  date_range?:
    start_date: string              # YYYY-MM-DD
    end_date: string
  top_n?: number                    # 可选；默认 20
  per_demand_type_top?: number      # 可选；默认 10（仅 keyword_demand 有此参数）
  run_id_hint?: string              # 可选；提示用，不影响 run_id 计算

output_success:
  kind: "<pack_id>_run"             # "keyword_demand_run" / "trend_demand_run"
  run_id: string
  run_dir: string
  entity:
    name: string
    id: string
    resolution: taxonomy | user_id | auto_resolved | partial_no_id
  top_overall: object[]             # 摘要（前 10）
  top_by_type?: Record<type, object[]>
  summary_path: string              # run_summary.md 绝对路径
  report_path: string               # report.md 绝对路径
  pull_report?: PullReportSummary

output_error:
  kind: "<pack_id>_error"
  error: string                     # 错误码（见 §7.4）
  missing_params?: Record<key, hint>
  hints?: string[]                  # 用户可操作提示
  details?: string
  pull_report?: PullReportSummary
  diagnostic_dir?: string           # _diag/<run_id> 路径（仅特定错误）
  diagnostic_run_id?: string
```

### 7.3 list_<pack_id>_runs schema

```yaml
input:
  limit?: number                    # 默认 20
  entity?: string                   # 按 entity 过滤（如 "入户地垫"）
  strategy?: string                 # 按 strategy 过滤
  run_id?: string                   # 指定 run_id 时返回该 run 的 meta + run_summary.md

output:
  runs: RunMetaSummary[]            # 按 started_at 倒序
  # 或当 input.run_id 传入时：
  run_id: string
  meta: RunMeta
  summary: string                   # run_summary.md 内容
```

### 7.4 compare_<pack_id>_runs schema

```yaml
input:
  run_id_a: string                  # 必填；参照 run（通常是 baseline）
  run_id_b: string                  # 必填；对照 run（候选策略）
  top_k?: number                    # 默认 20

output_success:
  kind: "compare_result"
  run_a: RunMeta
  run_b: RunMeta
  config_diff: Record<key, {a, b}>
  top_k: number
  overlap_rate: number              # TOP K 重叠率
  overlap_keywords: string[]
  ranking_correlation:
    spearman: number
    kendall_tau: number
    ndcg_at_k: number
  top_movers:
    rising: Array<{entity, rank_a, rank_b, score_delta}>
    falling: Array<{entity, rank_a, rank_b, score_delta}>
  score_distribution_diff: Record<level, {a, b, delta}>
  label_distribution_diff?: Record<label, {a, b, delta}>  # 仅 keyword_demand
  per_metric_overlap?: Record<metric, number>
  recommendation: string            # 决策建议（"保留 baseline" / "切换到 B" / "需更多样本"）

output_error:
  kind: "compare_error"
  error: string                     # 错误码
  details: string
```

### 7.5 错误模式 5 类

所有 capability 统一返回以下错误码（`error` 字段值），LLM 按此做分支：

| 错误码 | 含义 | 用户可操作提示（hints[]） |
| --- | --- | --- |
| `entity_not_resolved` | live=true 时 S1 全部降级失败（taxonomy miss + auto_resolve fail + 无 entity_id），走完 partial_no_id 后 S2 全部接口失败 | 1. 检查拼写；2. 传入 entity_id；3. 检查 LIVE_PROBE / ZICHEN_* 凭据 |
| `pull_no_data` | S2 所有接口均失败或空数据 | 1. 检查 LIVE_PROBE=true；2. 检查 ZICHEN_* 凭据；3. 调整 date_range |
| `shape_mismatch` | S3 response_root 与实际响应不匹配 | 1. 查 diagnostic_dir 的 live_probe_results.json；2. 联系开发者 |
| `live_disabled` | manifest.default_live=true 或用户传 live=true，但 LIVE_PROBE!=true | 1. 启动时加 LIVE_PROBE=true；2. 或显式传 live=false 走 fixture（仅单测 / golden / demo） |
| `env_missing` | ZICHEN_HOST / TENANT_ID / USER_ID / APP_CODE_KEY / APP_CODE 缺失 | 1. 补 .env；2. 或联系管理员 |

特别说明：
- live=false 模式下 taxonomy miss 不返 `entity_not_resolved`，而是按 §3.3 走 `mock_fixture_fallback`；只有 fixture 选不出任何候选（taxonomy 为空）才上抛 `entity_not_resolved`。
- 沙箱（无 LIVE_PROBE）默认行为：用户不传 live → 框架按 `manifest.default_live=true` 想升 live → LIVE_PROBE 缺失 → 返 `live_disabled` + actionable hints；不静默回落 fixture。

### 7.6 工具注册路径

所有工具在 [.pi/extensions/db_archaeologist.extension.ts](db-archaeologist-pi-spec-pack/.pi/extensions/db_archaeologist.extension.ts) 静态注册：

```ts
pi.registerTool({
  name: manifest.tools.analyze,
  label: manifest.cn_name,
  description: `${manifest.description}。输入 entity + 可选 entity_id/strategy/live/date_range，返回 RunEnvelope path 和 TOP 摘要。`,
  parameters: Type.Object({
    entity: Type.String({ description: "entity 名（自然语言）" }),
    entity_id: Type.Optional(Type.String()),
    strategy: Type.Optional(Type.String()),
    live: Type.Optional(Type.Boolean({ default: manifest.default_live })),
    // ...
  }),
  execute: async (_id, params) => pack(await analyzeXxxTool(params)),
});
```

三件套工具的 `execute` wrapper 在 `src/tools/` 下，thin shim 调 `src/packs/<pack_id>/index.ts` 入口。

## 8. 注册路径

### 8.1 pi extension 静态注册

每个 capability 的三件套都在 [.pi/extensions/db_archaeologist.extension.ts](db-archaeologist-pi-spec-pack/.pi/extensions/db_archaeologist.extension.ts) 顶部 static import + `pi.registerTool` 注册。

注册顺序：先基础工具（按现有顺序），再元工具，再分析包三件套（按 namespace 字典序 + capability 字典序），便于人工 review。

工具总数：`8 (基础) + 1 (元工具 propose_insight_plan) + 3 * N_capability`。

当前 capability 数 1（keyword_analysis_pack/keyword_demand），工具总数 = 8 + 1 + 3 = 12。
Phase 2 加入 keyword_analysis_pack/keyword_trend 后 = 8 + 1 + 6 = 15。

### 8.2 SKILL.md 一份每 capability

每个 capability 配 `.pi/skills/<capability>/SKILL.md`：

```
.pi/skills/
  db-archaeologist/SKILL.md         # 总入口；列各 capability 工具表 + topic→capability 路由原则 + 元工具入口
  keyword-demand/SKILL.md           # 关键词需求 capability 的 skill
  keyword-trend/SKILL.md            # 关键词趋势 capability 的 skill（Phase 2）
  ...
```

总入口 SKILL.md 是 LLM 的第一道路由，负责：
- 列出所有 capability 的触发关键词（`manifest.skill.trigger_keywords`）
- 给每个 capability 的 SKILL 一句话简介与跳转
- 解释元工具 `propose_insight_plan`：「想要一份分析方案 / 不知道用哪个能力」时引导走元工具
- 处理跨 capability 问题（如"对比关键词需求与趋势"）：引导用户先各自跑 capability，再人工对比，不做跨 capability compare

### 8.3 web 路由模板

[web/server.mjs](db-archaeologist-pi-spec-pack/web/server.mjs) 暴露的路由按 `namespace + capability` 模板化：

```
GET  /api/<namespace>/<capability>/runs               # = list_<capability>_runs
GET  /api/<namespace>/<capability>/run/:id            # 单 run 的 meta + summary
GET  /api/<namespace>/<capability>/compare?a=&b=      # = compare_<capability>_runs
```

历史路径作为 alias 保留 ≥ 2 个版本：
- `/api/keyword/runs` → `/api/keyword_analysis_pack/keyword_demand/runs`
- `/api/keyword/run/:id` → 同上
- `/api/keyword/compare` → 同上

元工具产物路由：

```
GET  /api/insight/templates           # 列 insight_templates
GET  /api/insight/list?limit=50       # 列已落盘的 insight plan
GET  /api/insight/get?plan_id=...     # 取单 plan
POST /api/insight/propose             # 调 propose_insight_plan
POST /api/insight/save                # 保存 plan
```

Inspector 增加「Pack 切换器」（namespace × capability 二级下拉）+「Insight」tab。

### 8.4 golden case 隔离

```
tests/golden_cases/
  keyword_demand_cases.yaml         # capability 私有 golden
  keyword_trend_cases.yaml
  insight_plan_cases.yaml           # 元工具 golden
  ...
  framework/
    run_envelope_cases.yaml         # 框架级（runId 命名 / 文件命名 / RunMeta schema）
    pack_manifest_cases.yaml        # 各 capability manifest 校验
```

`tests/golden.test.ts` 按目录扫描，逐文件跑断言。

## 9. 默认 live 与 fixture 关系

### 9.1 默认值矩阵

framework 规定所有 capability 的 `manifest.default_live = true`，沙箱默认行为不静默回落 fixture：

| 场景 | manifest.default_live | 用户传 live | LIVE_PROBE | 实际行为 |
| --- | --- | --- | --- | --- |
| 真机默认 | true | undefined | true | 走 live；`auto_upgraded_to_live=true` |
| 真机显式 live | true | true | true | 走 live；`auto_upgraded_to_live=false` |
| 真机显式关 live | true | false | true | 走 fixture；仅服务单测 / golden / 离线 demo |
| 沙箱默认 | true | undefined | undefined/false | 返 `live_disabled` 错误 + actionable hints；不走 fixture |
| 沙箱显式关 live | true | false | undefined/false | 走 fixture；fixture miss 时按 §3.3 走 mock_fixture_fallback |

### 9.2 自动升级逻辑

framework runner 在 S1 之前判定：

```ts
const effectiveLive = input.live ?? manifest.default_live;
const liveProbeEnv = process.env.LIVE_PROBE === "true";

if (effectiveLive && !liveProbeEnv) {
  return {
    error: "live_disabled",
    hints: [
      "启动时加 LIVE_PROBE=true 走真实接口",
      "或显式传 live=false 走 fixture（仅单测 / golden case / 离线 demo）",
    ],
  };
}

const autoUpgraded =
  input.live === undefined &&
  manifest.default_live === true &&
  liveProbeEnv;

meta.live_probe = effectiveLive;
meta.auto_upgraded_to_live = autoUpgraded;
```

### 9.3 fixture 的角色

- **仅服务单测 / golden case / 离线 demo**。
- 不承担 "任意 entity" 的兜底；任意 entity 必须 live。
- fixture 路径 `fixtures/<capability>/<entity>.json`，由 capability 自行声明在 `manifest.fixture_dir`。
- fixture miss 时走 `mock_fixture_fallback`（§3.3 第 5 态），不报 `entity_not_resolved`。

### 9.4 测试 / smoke / web 回归对默认 live 的处理

`test:golden` / `smoke:pi` / `web/_smoke.mjs` 在沙箱跑时不能被 `live_disabled` 干扰，统一约定：
- 测试 / smoke 入口显式传 `live=false`，绕过 default_live 升级，走 fixture。
- web 启动若 `LIVE_PROBE` 缺失，Inspector UI 顶部 banner 标注「沙箱模式：默认 fixture」并把表单的 live 默认勾选项改为 false；底层 `analyzeXxx` 调用仍传 `live=false`。

这条规则在 [12_KEYWORD_DEMAND_PACK_SPEC.md](12_KEYWORD_DEMAND_PACK_SPEC.md) §7 验收清单里有具体落地步骤。

## 10. capability 间隔离

### 10.1 runs_root 隔离

- `registry/derived/<namespace>/<capability>/` 独占。
- 框架 listRuns / web 路由按 `namespace + capability` 过滤；不会跨 capability list。
- compare 必须同 capability；不同 capability / 不同 namespace 间不可 compare。

### 10.2 registry 共享区与私有区

| 区 | 路径 | 读写权限 |
| --- | --- | --- |
| 全局共享配置 | `registry/category_taxonomy.yaml` 等 | 所有 capability 只读 |
| 锁版基线 | `registry/*.locked.yaml` | 全局只读，权威 |
| namespace 共享配置 | `registry/keyword_taxonomy.yaml` 等 | 同 namespace 的 capability 可读写 |
| capability 私有配置 | `registry/kds_weights.yaml` 等 | 仅声明该 ref 的 capability 可读写 |
| capability registry 注册表 | `registry/keyword_analysis_packs.json` | 由 framework 校验，rebuild 时与磁盘 manifest 对齐 |
| 派生产物 | `registry/derived/<namespace>/<capability>/` | 仅本 capability 写 |
| 元工具产物 | `registry/derived/_insight_plans/` | 仅 propose_insight_plan 写 |
| 派生 seed | `registry/seed/api_index_seed.json` 等 | 由 `extract:index` 生成，所有 capability 只读 |

### 10.3 capability 不可影响 ApiAssetCard 主链

- capability 不能修改 `registry/derived/api_asset_cards.json` / `tool_registry.yaml` / `kg/*.json`。
- capability 只能读 `api_asset_cards.json`（通过 [src/services/api_runtime.ts](db-archaeologist-pi-spec-pack/src/services/api_runtime.ts) `probeApiSample`）。
- capability 不能新增 `api_id`；要补接口走 `sources/api_docs/_inbox/` + `npm run ingest:rebuild`。

### 10.4 失败诊断隔离

- `registry/derived/<namespace>/<capability>/_diag/<run_id>/` 仅本 capability 写。
- 不同 capability 的 `_diag` 互不可见；framework 不做跨 capability 诊断聚合。

## 11. 不在本规范范围

- 各 capability 业务公式与阈值（在对应 `12_*_PACK_SPEC.md` / `13_*_PACK_SPEC.md` 等定义）。
- 跨 capability 联合分析（同 entity 多 capability 并行 + 报告聚合）。
- pack 动态加载（plugin 形式）。
- 第三方 SDK 接入（社媒包未来需要）。
- 视觉/NLP 通用 stage 库（评价 / 主图包真正落地后再下沉）。
- 真实凭据 vault 设计。

## 12. 分析包之上的元工具层

### 12.1 职责边界

「元工具」是**分析包之上**的工具集合，不属于任何 capability，不走 8-stage runner，不调上游 API。当前元工具层包含两个工具：

| 元工具 | 用途 | 跨 namespace？ | 输出根目录 |
| --- | --- | --- | --- |
| `propose_insight_plan` | 通用洞察规划：把 topic 路由到 insight_template，输出 InsightPlan 草稿 | 是 | `registry/derived/_insight_plans/` |
| `propose_koif_strategy` | KOIF 经营策略路由：跨 KOIF capability 聚合 score_vector，输出 strategy_routes + next_actions | 否（仅 `keyword_analysis_pack`） | `registry/koif_routes/` |

两个元工具并行存在，互不调用；后者的详细规范见 §12.8 与 [15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md)。

#### 12.1.1 propose_insight_plan 的角色

`propose_insight_plan` 只做三件事：

1. **路由**：把用户输入的 topic（如「竞争格局分析」）匹配到一条 insight_template。
2. **粗筛 + 字段角色标注**：基于 template 的 `preferred_domains / required_data_ops`，调 `askApiCatalog` 拉候选 API，给字段打 role（dimension / metric_main / metric_aux / time / id）。
3. **产出 InsightPlan 草稿**：组装 `apis[] / required_params[] / data_ops[] / report_sections[]` + 覆盖度报告 + LLM 精排 prompt。

它**不**消费 capability runs 数据，**不**调上游 API，**不**生成 RunEnvelope；产物是给 LLM / 用户的「该跑哪个 capability、用什么参数」的方案书。

下游消费方式：用户拿到 InsightPlan 后，仍要去调对应 capability 的三件套（`analyze_<capability>`）跑数据。

#### 12.1.2 propose_koif_strategy 的角色

`propose_koif_strategy` 与 `propose_insight_plan` 的关键差异在于**它会主动调用 capability 三件套并聚合结果**：

1. **解析实体**：把用户输入（如「桌布」/「客厅地毯」）解析为 KOIF 通用 entity（kind=category）。
2. **并行触发 KOIF capabilities**：按入参 `capabilities[]` 或默认 `["keyword_demand", "keyword_trend"]` 触发对应三件套，复用各 capability 已落盘的 RunEnvelope。
3. **聚合 score_vector**：从各 capability 的 `<entity>_scores.json` / `trend_result.json` 提取分数，按 `score_domain` 装配为 score_vector。
4. **路由策略**：按 `registry/koif_route_rules.yaml` 推导 strategy_routes（如 `old_product_optimization / trend_test / content_candidate`）。
5. **渲染行动建议**：按 `registry/koif_action_templates.yaml` 输出 next_actions（如 `title_rewrite / content_topic / paid_test`）。

它**会**消费 capability runs 数据，**会**触发 capability 三件套（透传 `live` 参数），**会**生成跨 capability 的 router_run 产物（独立根目录 `registry/koif_routes/`）。

### 12.2 InsightPlan schema

完整 schema 在 [specs/schemas/insight_plan.schema.json](db-archaeologist-pi-spec-pack/specs/schemas/insight_plan.schema.json)。核心字段：

```yaml
plan_id: string                     # <YYYYMMDDHHmm>__<template_key>__<sha8>
topic: string                       # 用户原文
template_key: string                # 命中的 insight_template
template_cn: string                 # 模板中文名
recommended_capabilities: [string]  # 推荐使用的 capability 列表（如 keyword_demand / keyword_trend）
apis: [
  api_id: string
  role: dimension | metric_main | metric_aux | time | id
  fit_score: number                 # 0..1
  field_roles: Record<field, role>
]
required_params: Record<key, hint>
data_ops: [string]                  # 涉及的数据操作（如 "filter_by_date" / "join_by_keyword"）
report_sections: [{id, cn}]
coverage_report:                    # 字段覆盖度
  total_required: number
  covered: number
  missing_fields: [string]
llm_refine_prompt: string           # 精排 prompt 草稿
created_at: string
```

### 12.3 propose_insight_plan 工具契约

```yaml
input:
  topic: string                     # 必填；自然语言洞察方向
  template_key?: string             # 可选；显式指定模板，不传则按 topic 匹配
  candidate_limit?: number          # 默认 12
  scope?:
    time_range?: string
    target_entities?: [string]

output_success:
  kind: "insight_plan"
  plan: InsightPlan                 # 见 §12.2
  available_capabilities: [string]  # 当前 spec-pack 可用的 capability 列表

output_error:
  kind: "insight_plan_error"
  error: string                     # template_not_found / topic_too_vague / ...
  available_templates: [string]
```

### 12.4 与三件套关系

```
用户输入: "我想分析地垫的竞争格局"
   |
   v
propose_insight_plan(topic="地垫的竞争格局")
   |
   产出 InsightPlan：
     - recommended_capabilities: [keyword_demand, keyword_trend]
     - apis: [data_blue_keyword_7d_v2 (metric_main), ...]
     - report_sections: [...]
   |
   v
SKILL / LLM 解析 plan，引导用户逐步调用：
   analyze_keyword_demand({entity: "地垫", ...})
   analyze_keyword_trend({entity: "地垫", ...})
```

InsightPlan 不直接驱动 capability 自动执行；自动编排留 Phase N+2 做。

### 12.5 落盘约定

```
registry/derived/_insight_plans/
  <plan_id>.json                    # InsightPlan JSON
  index.json                        # plan 列表索引（plan_id, topic, template_key, created_at）
```

list / get / save 走元工具自己的 web 路由（§8.3 末段），不复用 capability runs 的 `_compare` / `_eval`。

### 12.6 manifest 与 insight_template 关联

每个 capability 在 `manifest.insight_templates[]` 声明自己可被哪些 template 选中作为 `recommended_capabilities`；`registry/seed/insight_templates.seed.yaml` 反向声明 template 推荐哪些 capability，两边在 `validate_packs.ts` 对齐。

### 12.7 不在本节范围

- LLM 精排 prompt 的真正调用（Phase 2 仅产出 prompt 文本，不发请求）。
- InsightPlan 自动驱动 capability 执行（Phase N+2）。
- plan 与 capability run 的双向追踪（同一 plan 跑了哪些 run，留 follow-up）。

### 12.8 KOIF Router 元工具

#### 12.8.1 定位

`propose_koif_strategy` 是 KOIF（Keyword Operating Intelligence Framework）的元工具层入口，专注于「关键词经营策略路由」。与 `propose_insight_plan` 并列，但更聚焦：

| 维度 | propose_insight_plan | propose_koif_strategy |
| --- | --- | --- |
| namespace 范围 | 通用，跨 namespace | 仅 `keyword_analysis_pack` |
| 输入 | topic（自然语言洞察方向） | entity（类目/品牌/...） + capabilities |
| 输出 | InsightPlan 草稿（方案书） | score_vector + strategy_routes + next_actions（可执行报告） |
| 是否调 capability 三件套 | 否（仅路由） | 是（自动触发 + 聚合） |
| 产物根目录 | `registry/derived/_insight_plans/` | `registry/koif_routes/` |

KOIF Router 的完整规范见 [15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md)；本节仅描述框架层契约。

#### 12.8.2 工具契约

```yaml
input:
  entity: string                    # 必填；类目/品牌等实体自然语言（如「桌布」/「客厅地毯」）
  entity_kind?: string              # 默认 "category"
  category_id?: string              # 可选；显式传 id 跳过 S1 resolve
  capabilities?: [string]           # 默认 ["keyword_demand", "keyword_trend"]（Phase 2 范围）
  live?: boolean                    # 透传给各 capability 三件套；默认 true
  strategy?: string                 # 可选；强制覆盖 route 结果（调试用）
  date_range?: {start_date, end_date}

output_success:
  kind: "koif_router_run"
  router_run_id: string             # <YYYYMMDDHHmm>__koif__<entity_id>__<sha8>
  score_vector: ScoreVector         # 8 维评分向量（Phase 2 仅 kds + tms）
  strategy_routes: [string]         # 命中的策略 id（如 ["old_product_optimization", "trend_test"]）
  next_actions: [Action]            # TOP 5 行动建议（见 §12.8.4）
  capability_runs: Record<capability, run_id>  # 各 capability 的 run_id
  router_report_path: string        # router_report.md 路径

output_error:
  kind: "koif_router_error"
  error: string                     # koif_no_capabilities_available / koif_score_aggregation_failed / ...
  available_capabilities: [string]
```

#### 12.8.3 ScoreVector schema

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
  score_explanation: Record<score_domain, string>;  // 各分数简述（从 report.md 提取）
  available_scores: string[];       // Phase 2 = ["kds", "tms"]
  aggregated_at: string;            // ISO 8601
  router_run_id: string;
}
```

Phase 2 聚合逻辑：
- `kds`：从 `keyword_demand` run 的 `<entity>_scores.json` 提取；字段路径 `records[].kds`
- `tms`：从 `keyword_trend` run 的 `trend_result.json` 计算（按 KOIF 公式 TMS = 0.4×MoM + 0.3×YoY + 0.3×trendLabel）

Phase 3+ 按各 capability 的 `manifest.score_domain` 依次填充 `pvs / ces / pfs / nos / bds / cps`。

#### 12.8.4 Action schema

```typescript
interface Action {
  action: "title_rewrite" | "content_topic" | "paid_test" | ...;  // Phase 2 仅前 3 类
  keywords: string[];               // 关联关键词列表（TOP N）
  reason: string;                   // 业务话术（从 template 渲染）
  template_id: string;              // koif_action_templates.yaml 的 template key
  priority?: number;                // 1-5，1 最高
  estimated_effort?: string;        // "low" | "medium" | "high"
}
```

Phase 2 三类 action 模板来源：
- `title_rewrite`：基于 KDS ≥ 70 的高分词，模板含「建议在标题中强化 <keywords> 的覆盖，提升搜索承接」
- `content_topic`：基于 TMS ≥ 70 + KDS ≥ 60，模板含「可围绕 <keywords> 制作内容话题，把握趋势窗口期」
- `paid_test`：基于 KDS ≥ 80 + TMS ≥ 60，模板含「<keywords> 强需求 + 趋势加持，可小预算测试付费投放」

完整模板定义在 `registry/koif_action_templates.yaml`，见 [15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md) §6。

#### 12.8.5 Router 内部流程（7 步）

```
S1: resolve entity      → 复用 keyword_demand 的 S1（category taxonomy）
S2: invoke capabilities → 并行调 analyze_keyword_demand + analyze_keyword_trend
S3: load runs           → 从 registry/derived/<namespace>/<capability>/<run_id>/ 读 meta + 产物
S4: aggregate scores    → 按 score_domain 装配 score_vector
S5: route               → 按 koif_route_rules.yaml 推导 strategy_routes
S6: generate actions    → 按 koif_action_templates.yaml 渲染 next_actions
S7: write router_run    → 落盘到 registry/koif_routes/<router_run_id>/
```

Phase 2 S5 路由规则简化版（仅 KDS + TMS）：

```yaml
old_product_optimization:
  conditions:
    - kds >= 70
  actions: [title_rewrite]

trend_test:
  conditions:
    - tms >= 75
    - kds >= 60
  actions: [content_topic, paid_test]

content_candidate:
  conditions:
    - kds >= 70
    - tms >= 70
  actions: [content_topic]
```

完整规则文件 `registry/koif_route_rules.yaml` 见 [15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md) §5。

#### 12.8.6 router_run 产物结构

```
registry/koif_routes/
  <router_run_id>/
    router_meta.json        # 元数据：capabilities / capability_runs / aggregated_at / config_hash
    score_vector.json       # ScoreVector 完整对象
    strategy_routes.json    # [{strategy_id, matched_conditions, priority}]
    next_actions.json       # [Action] 数组（按 priority 降序）
    router_report.md        # 业务报告（KOIF 经营策略报告格式，见 KOIF.md §13）
```

`router_meta.json` schema：

```yaml
router_run_id: string
namespace: "keyword_analysis_pack"
entity:
  kind: string
  name: string
  id?: string
  canonical?: string
capabilities: [string]              # 本次触发的 capability 列表
capability_runs: Record<capability, run_id>
live_probe: boolean
aggregated_at: string
router_version: string              # "v1.0-kds-tms"（Phase 2）
config_hash: string                 # 覆盖 capabilities + route_rules.yaml + action_templates.yaml
route_rules_version: string         # koif_route_rules.yaml 的版本哈希
action_templates_version: string    # koif_action_templates.yaml 的版本哈希
```

#### 12.8.7 与 capability 三件套协同

KOIF Router 触发 capability 三件套时，透传 `live` 参数，但不干预 `strategy` / `date_range`（各 capability 按自己 manifest 默认）。

如果某个 capability 已有缓存 run（同 entity + strategy + date_range），Router 可复用该 run（通过 `listRuns` 查找最近 1 天内的 run），避免重复调用上游 API。复用逻辑在 Router S2 实现，详见 15 号 §3.2。

#### 12.8.8 web 路由

```
POST /api/koif_routes/propose           # 调用 propose_koif_strategy 工具
GET  /api/koif_routes/runs              # 列出所有 router_run（分页 + filter by entity / date）
GET  /api/koif_routes/run/:id           # 读取单个 router_run 完整产物
GET  /api/koif_routes/run/:id/report    # 下载 router_report.md
```

与 capability runs 的 web 路由隔离；不复用 `/api/packs/:namespace/:capability/` 前缀。

#### 12.8.9 SKILL 触发

`.pi/skills/koif-router/SKILL.md` 触发词：

- 「关键词经营机会」
- 「综合评分」
- 「怎么做关键词」
- 「策略建议」

SKILL 默认调用 `propose_koif_strategy`，由 LLM 自动决策 `capabilities` 参数（Phase 2 默认 `["keyword_demand", "keyword_trend"]`）。

#### 12.8.10 错误模式

| error | 触发条件 | 行为 |
| --- | --- | --- |
| `koif_no_capabilities_available` | 所有请求的 capability 都 `live_disabled` 或不存在 | 返回 error + available_capabilities |
| `koif_score_aggregation_failed` | capability run 格式不兼容（缺 `<entity>_scores.json` / score_domain 字段） | 返回 error + partial score_vector |
| `koif_route_no_match` | score_vector 所有策略条件都不满足 | 仍输出 score_vector，strategy_routes = []，next_actions = [] |
| `koif_entity_resolve_failed` | S1 resolve 失败（无 taxonomy 命中） | 降级为 `entity.canonical = entity.name`，继续执行 |

`koif_route_no_match` 不视为失败；Router 正常落盘 router_run，report.md 输出「暂无明确策略方向，建议等待更多评分能力（PVS/CES/...）落地后重跑」。

#### 12.8.11 Phase 2 局限与 Phase 3+ 扩展路径

Phase 2 局限：
- 仅 2 个评分能力（KDS + TMS），score_vector 仅 2/8 维度有值
- 路由规则仅 3 条（老品优化 / 趋势测试 / 内容候选）
- 行动建议仅 3 类（title_rewrite / content_topic / paid_test）
- 不支持跨 entity 对比（如「地垫 vs 桌布」）
- 不支持时序策略变化追踪

Phase 3+ 扩展：
- 增 PVS（付费价值）+ CPS（竞争压力），支持付费投流策略
- 增 CES（内容潜力）+ PFS（商品承接），支持内容种草 + 老品诊断
- 增 NOS（新品机会）+ BDS（蓝海需求），支持新品立项决策
- Router 高级能力：跨 entity 对比 / 策略 A/B 验证 / 周期性监控
