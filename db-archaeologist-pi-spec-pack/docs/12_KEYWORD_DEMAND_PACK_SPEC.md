# Keyword Demand Pack Specification

本规范定义 `keyword_demand` capability 在 [11_ANALYSIS_PACK_FRAMEWORK_SPEC.md](11_ANALYSIS_PACK_FRAMEWORK_SPEC.md) 框架下的实例化形态。所有未在本文档说明的内容均回退到 11 号规范。

## 1. 包定位

### 1.1 业务问题

把「用户提一个品类，3 分钟拿到一份可信、可解释、可追溯的关键词需求清单」从一次性原型升级为可重跑、可对比、可降级的标准能力。

### 1.2 与框架的关系

- `namespace = keyword_analysis_pack`
- `capability = keyword_demand`
- `score_domain = demand`（KOIF 专用，详见 §8）
- `koif_aggregatable = true`（可被 KOIF Router 消费）
- `siblings = [keyword_trend, keyword_blue_ocean]`（占位，trend 在 Phase 2 落地，blue_ocean 暂不实现）
- `entity_kind = category`
- `stages_used` 跑满 8 步（resolve / pull / shape / normalize / classify / score / rank / report）
- `default_live = true`，沙箱无 `LIVE_PROBE` 时返 `live_disabled` + actionable hints；不静默回落 fixture
- `supported_strategies = [baseline_v1, semantic_v2_stub, llm_voc_v3_stub]`，`default_strategy = baseline_v1`
- 私有业务公式：KDS（4 子项加权 + intent_multiplier）
- `insight_templates = [keyword_demand_overview, blue_ocean_opportunities]`：元工具层（11 号 §12）路由用，让上层 `propose_insight_plan` 在用户问「该类目关键词怎么样」时能定位到本 capability

**KOIF 角色**：本 capability 是 KOIF（Keyword Operating Intelligence Framework）8 个评分能力中的「需求强度评估」，输出 KDS（Keyword Demand Score，0-100）作为 score_vector 的 `demand` 维度。Phase 2 KOIF Router 从本 capability 的 `<entity>_scores.json` 提取 KDS + intent_multiplier，用于路由老品优化/趋势测试/内容种草策略。详见 §8 与 [14_KOIF_NAMESPACE_OVERVIEW.md](14_KOIF_NAMESPACE_OVERVIEW.md)。

### 1.3 物理目录现状（hybrid 期）

本 capability 处于「runtime pack_id 已切换 / 物理目录未迁」的 hybrid 状态：

| 维度 | 当前事实 | 目标（按 11 号 §4.1） |
| --- | --- | --- |
| `manifest.namespace` | `keyword_analysis_pack` | 同左 |
| `manifest.capability` | `keyword_demand` | 同左 |
| `run_dir 根` | `registry/derived/keyword_analysis_pack/<run_id>/`（已落） | `registry/derived/keyword_analysis_pack/keyword_demand/<run_id>/` |
| 模块物理路径 | `src/services/keyword_demand/*.ts` | `src/packs/keyword_analysis_pack/keyword_demand/*.ts` |
| `keyword_analysis_packs.json` | `default_pack_id = "keyword_analysis_pack"` | 同左（与 namespace 同名，可读为 namespace 默认 capability） |

迁移按 11 号 §4.5 兼容路径分两阶段：先在新目录建 manifest + shim（旧 path reexport），再切 import。本规范 §3、§4、§7 描述「目标态」，并标注 hybrid 期的兼容点。

### 1.4 核心数据形态

```yaml
EntityContext:
  kind: category
  id: string                           # 类目 id（taxonomy / lookup_api 解析所得）
  canonical: string                    # 规范名（taxonomy 命中时）
  resolution_kind: taxonomy | user_id | auto_resolved | partial_no_id | mock_fixture_fallback

MetricRecord:
  keyword: string
  source_apis: string[]
  metrics:
    search_popularity: number
    search_popularity_mom: number
    transaction_index: number
    competition_intensity: number
    blue_ocean_score: number
    is_ad_keyword: boolean
    # ...

EnrichedRecord = MetricRecord & {
  labels: { intent: string[]; product_type: string[]; place: string[]; persona: string[]; ... }
  matched_terms: { label: term[] }
  intent_multiplier: number
}

ScoredRecord = EnrichedRecord & {
  scores: { scale: number; growth: number; conversion: number; competition: number }
  kds: number                          # 0..100
  koif_context?: {                     # KOIF Router 消费用，可选；详见 §8
    score_domain: "demand"
    aggregatable_for_router: boolean
    intent_multiplier: number          # 已落到 ScoredRecord.intent_multiplier，此处冗余暴露给 Router
  }
}
```

## 2. PackManifest 实例

### 2.1 manifest.yaml

```yaml
namespace: keyword_analysis_pack
capability: keyword_demand
namespace_cn_name: 关键词分析
cn_name: 关键词需求分析
version: 1.0.0
entity_kind: category
description: 给一个类目，输出 KDS 排序的关键词需求 TOP 榜与归因解释。

score_domain: demand                # KOIF：本 capability 归属的评分维度
koif_aggregatable: true             # 可被 KOIF Router 跨 capability 聚合

siblings:
  - keyword_trend           # Phase 2 落地
  - keyword_blue_ocean      # 占位，未实现

stages_used:
  - resolve
  - pull
  - shape
  - normalize
  - classify
  - score
  - rank
  - report

registry_refs:
  config:
    - registry/category_taxonomy.yaml
    - registry/keyword_field_mapping.yaml
    - registry/keyword_strategies.yaml
  namespace_shared:
    - registry/keyword_taxonomy.yaml
    - registry/keyword_taxonomy.baseline_v1.locked.yaml
  capability_private:
    - registry/kds_weights.yaml
    - registry/kds_weights.baseline_v1.locked.yaml

default_strategy: baseline_v1
supported_strategies:
  - baseline_v1
  - semantic_v2_stub
  - llm_voc_v3_stub
default_live: true
default_date_range: T-9..T-3

lookup_api: data_keywords_category_list

report_sections:
  - id: data_source
    cn: 数据来源说明
    required: true
  - id: trust_level
    cn: 可信度评估
    required: true
  - id: top_overall
    cn: TOP5 关键词归因
    required: true
  - id: top_by_demand_type
    cn: 各需求类型 TOP10
    required: true
  - id: blue_ocean
    cn: 蓝海机会词
    required: false
  - id: rejected
    cn: 被剔除关键词
    required: false
  - id: degradation
    cn: 降级与缺口
    required: false
  - id: known_gaps
    cn: 已知 GAP
    required: false
  - id: actions
    cn: 行动建议
    required: true

tools:
  analyze: analyze_keyword_demand
  list_runs: list_keyword_demand_runs   # 新名；list_keyword_runs 双写 alias 保留 ≥ 2 版本
  compare: compare_keyword_demand_runs  # 新名；compare_keyword_runs 双写 alias 保留 ≥ 2 版本

skill:
  path: .pi/skills/keyword-demand/SKILL.md
  trigger_keywords:
    - 关键词
    - 需求词
    - 蓝海词
    - 搜索词
    - 关键词需求
    - 关键词分析
    - keyword

fixture_dir: fixtures/keyword_demand_mock
diagnostic_root: registry/derived/keyword_analysis_pack/keyword_demand/_diag

insight_templates:
  - keyword_demand_overview
  - blue_ocean_opportunities
```

### 2.2 与 11 号规范字段对照

| manifest 字段 | 11 号 §5.2 schema | 备注 |
| --- | --- | --- |
| `namespace` | 必填 | 与目录第 1 级一致 |
| `capability` | 必填 | 与目录第 2 级一致；全局唯一 |
| `entity_kind` | `category` | 与 `category_taxonomy.yaml` 配套 |
| `stages_used[5]` | `classify` | capability 私有别名，对应框架 S5 enrich |
| `default_live` | `true` | 与 11 号 §9 默认值矩阵一致 |
| `supported_strategies` | 必填 | 全部需在 `keyword_strategies.yaml` 注册 |
| `lookup_api` | `data_keywords_category_list` | auto-resolve 用 |
| `tools.*` | 三件套 | 命名严格匹配 11 号 §7.1（`<verb>_<capability>(_runs)`） |
| `insight_templates[]` | 选填 | 元工具路由用，见 11 号 §12 |

## 3. 现有代码到框架的迁移映射

### 3.1 _lib 下沉清单

下列文件将拆分为「业务无关骨架（迁 _lib）」+「capability 私有逻辑（留包内）」：

| 现有文件 | 框架 stage | _lib 下沉部分 | capability 内保留部分 |
| --- | --- | --- | --- |
| `src/services/keyword_demand/trace.ts` | RunEnvelope | `buildRunId / hashConfig / initRun / finalizeRun / writeStageOutput / writeDiagnosticOnly / listRuns / getRunMeta` | 无 |
| `src/services/keyword_demand/resolve.ts` | S1 | `resolveByTaxonomy + ResolutionInfo + mock_fixture_fallback 第 5 态` | category 专属 hint 文案 |
| `src/services/keyword_demand/auto_resolve.ts` | S1 | `autoResolveViaLookupApi`（按 `manifest.lookup_api` 通用化） | 类目 id 字段名 `class_three_id` 解析（移到 manifest 配置项） |
| `src/services/keyword_demand/live_pull.ts` | S2 | `renderRequestTemplate + serialPull + per_api_status 归一 + context_mismatch 校验` | 无（`response_context` 由 `keyword_field_mapping.yaml` 配置驱动） |
| `src/services/keyword_demand/shape.ts` | S3 | `response_root 解析 + shape_report 生成` | 无 |
| `src/services/keyword_demand/normalize.ts` | S4 | `多源合并 + merge_order_priority + field_map + normalize_report` | 无 |
| `src/services/keyword_demand/classify.ts` | S5 | 无 | 全保留（12 类标签匹配，业务语义强） |
| `src/services/keyword_demand/score.ts` | S6 | 无 | 全保留 |
| `src/services/keyword_demand/strategies/baseline_v1.ts` | S6 | `pctRank + minMax + weightedSum + intentMultiplier` 原语 | KDS 公式 + 4 子项权重 + intent 规则 |
| `src/services/keyword_demand/strategies/semantic_v2_stub.ts` | S6 | 同上 | capability 私有 stub |
| `src/services/keyword_demand/strategies/llm_voc_v3_stub.ts` | S6 | 同上 | capability 私有 stub |
| `src/services/keyword_demand/rank.ts` | S7 | 无 | 全保留 |
| `src/services/keyword_demand/report.ts` | S8 | 无 | 全保留（9 节业务文案） |
| `src/services/keyword_demand/compare.ts` | 工具 | `TOP 重叠 + Spearman + Kendall + NDCG + 词位移 + 分数分布 diff` | 标签分布 diff（KDS 强相关） |
| `src/services/keyword_demand/eval.ts` | 工具 | `metric 计算骨架（precision/recall/ndcg）` | golden case schema |
| `src/services/keyword_demand/types.ts` | _ | `RunMeta / EntityContext / PullReportSummary / NormalizeReport` | `KdsScore / DemandLabels / KeywordRecord` |
| `src/services/keyword_demand/index.ts` | runner | 无 | 改为 `runStages(manifest, input, packStages)` |

### 3.2 迁移后的目标目录

```
src/packs/_lib/
  run_envelope.ts          # ← trace.ts 通用部分
  resolve_framework.ts     # ← resolve.ts + auto_resolve.ts 通用部分
  live_pull_framework.ts   # ← live_pull.ts 通用部分
  shape_framework.ts       # ← shape.ts
  normalize_framework.ts   # ← normalize.ts
  score_lib.ts             # ← strategies/baseline_v1.ts 内的原语
  compare_lib.ts           # ← compare.ts 通用部分
  eval_lib.ts              # ← eval.ts 通用部分
  types.ts                 # ← types.ts 通用部分
  runner.ts                # 新文件，按 manifest.stages_used 调度

src/packs/keyword_analysis_pack/
  _shared/                 # namespace 共享（兄弟 capability 复用）
    keyword_taxonomy_loader.ts
    types.ts               # KeywordRecord 等 namespace 通用类型
  keyword_demand/
    manifest.yaml          # 新文件
    index.ts               # 改写为 runner 入口
    classify.ts            # 原文件迁入
    score.ts               # 原文件迁入
    rank.ts                # 原文件迁入
    report.ts              # 原文件迁入
    compare.ts             # capability 私有 diff（标签分布）
    strategies/
      baseline_v1.ts       # 仅保留 KDS 公式 + intent 规则
      semantic_v2_stub.ts
      llm_voc_v3_stub.ts
    types.ts               # capability 私有类型（KdsScore / DemandLabels）

src/services/keyword_demand/
  *.ts                     # 全部改为 thin shim：export * from "../../packs/keyword_analysis_pack/keyword_demand/..."
                           # 或 export * from "../../packs/_lib/..."
  strategies/*.ts          # thin shim
```

shim 文件统一只做 `export * from "..."`，过渡期 ≥ 2 个版本，第三个版本删除。物理迁移与 import 切换分两次提交（见 §7.6）。

### 3.3 受影响的 import 路径

下列 11 处对 `src/services/keyword_demand/*` 的 import 必须能透明指向新位置：

- `src/tools/analyze_keyword_demand.ts`
- `src/tools/list_keyword_runs.ts` → 新名 `list_keyword_demand_runs.ts`，旧名 thin shim
- `src/tools/compare_keyword_runs.ts` → 新名 `compare_keyword_demand_runs.ts`，旧名 thin shim
- `scripts/keyword_demo.ts`
- `scripts/keyword_compare.ts`
- `scripts/keyword_eval.ts`
- `tests/golden.test.ts`
- `web/server.mjs`（`/api/keyword/*` → `/api/keyword_analysis_pack/keyword_demand/*` 双写）
- `.pi/extensions/db_archaeologist.extension.ts`
- `src/services/insight_planner.ts`（如有 cross-ref）
- `scripts/rebuild_all.ts`（间接）

shim 保留期内全部不动。Phase 2 第二个版本起，逐文件改为新 path。

### 3.4 工具名兼容矩阵

| 旧工具名 | 新工具名 | 兼容策略 |
| --- | --- | --- |
| `analyze_keyword_demand` | `analyze_keyword_demand` | 不变 |
| `list_keyword_runs` | `list_keyword_demand_runs` | 双写 alias，pi extension 同时注册两名；SKILL.md 用新名 |
| `compare_keyword_runs` | `compare_keyword_demand_runs` | 同上 |

双写期 ≥ 2 个版本。所有新代码、SKILL.md、文档统一引用新名；旧名仅保留 LLM 历史触发兼容。

## 4. 行为兼容矩阵

迁移前后所有 user-facing 行为必须字节级一致。

| 维度 | 迁移前 | 迁移后 | 变化 |
| --- | --- | --- | --- |
| `analyze_keyword_demand` 工具名 | `analyze_keyword_demand` | `analyze_keyword_demand` | 无 |
| `list_*` 工具名 | `list_keyword_runs` | `list_keyword_demand_runs` + `list_keyword_runs`（alias） | **新名为主，旧名 alias** |
| `compare_*` 工具名 | `compare_keyword_runs` | `compare_keyword_demand_runs` + `compare_keyword_runs`（alias） | 同上 |
| 输入 schema | `category + category_id? + strategy? + live? + date_range? + top_n? + per_demand_type_top? + run_id_hint?` | 同左，新增 `entity` 别名兼容（`category` 仍兼容 ≥1 版本） | 增加 `entity` 别名 |
| 输出 schema | `keyword_demand_run / keyword_demand_error` | 同左 | 无 |
| `run_id` 命名 | `<YYYYMMDDHHmm>__<strategy>__<category_id>__<sha8>` | `<YYYYMMDDHHmm>__<strategy>__<entity_id>__<sha8>` | 无（`category_id` ⇄ `entity_id` 同义） |
| `run_dir` 路径 | `registry/derived/keyword_analysis_pack/<run_id>/`（hybrid 期） | `registry/derived/keyword_analysis_pack/keyword_demand/<run_id>/`（目标态） | **路径下沉一级；旧路径 alias 读保留 ≥ 2 版本** |
| 文件名：报告 | `keyword_baseline_report.md` | `report.md`（新）+ `keyword_baseline_report.md`（兼容副本） | **新增 `report.md`，旧名保留 ≥1 版本** |
| 文件名：TOP | `category_top_keywords.json` | `keyword_top.json`（新）+ `category_top_keywords.json`（兼容副本） | 同上 |
| 文件名：scores | `keyword_scores.json` | `keyword_scores.json` | 无 |
| 文件名：metric_records | `metric_records.json` | `metric_records.json` | 无 |
| 文件名：probe | `live_probe_results.json` | `live_probe_results.json` | 无 |
| 文件名：诊断 | `_diag/<run_id>/DIAGNOSTIC_README.md` | `keyword_demand/_diag/<run_id>/DIAGNOSTIC_README.md` | 路径下沉 |
| `RunMeta` 字段 | 现有字段 | **新增 `namespace / capability / manifest_version / auto_upgraded_to_live`**；保留 `pack_id` 兼容字段 = `namespace` 值 | 增字段，不删字段 |
| 默认 `live` | 工具入参默认 `true`，`LIVE_PROBE!=true` 报 `live_disabled` | 同左，但同时尊重 `manifest.default_live` | 行为不变 |
| 默认 `date_range` | `T-7..T-0` | `T-9..T-3`（见 §5） | **行为变更** |
| 错误码 | `category_not_resolved / pull_no_data / shape_mismatch / live_disabled / env_missing` | 同左 | 无 |
| `resolution_kind` 取值 | `taxonomy / user_id / auto_resolved / partial_no_id` | `taxonomy / user_id / auto_resolved / partial_no_id / mock_fixture_fallback` | **新增第 5 态（fixture 回灌专用）** |
| `live_probe_results.json` 内容 | 同左 | 同左 | 无 |
| `pull_report.json` 内容 | 同左 | 同左 | 无 |
| Inspector 路由 | `/api/keyword/runs` 等 | `/api/keyword_analysis_pack/keyword_demand/{runs,run/:id,compare}`（新）+ `/api/keyword/*`（alias） | 新路由叠加，旧路由保留 ≥2 版本 |
| Web 行为 | 同左 | 同左 | 无 |
| `golden case` | 9 条 | 9 条全部继承 + 新增 1 条「迁移前后 run_dir 文件名兼容」 | 增 1 条，不改旧条 |
| `compare_keyword_runs` 输出 | 同左 | 同左 | 无 |

迁移期内若任何一项变化，视为回归 bug。

## 5. 默认 date_range 调整：T-7..T-0 → T-9..T-3

### 5.1 现状

[src/services/keyword_demand/index.ts](db-archaeologist-pi-spec-pack/src/services/keyword_demand/index.ts) 计算默认窗口为「今天往前 7 天 → 今天」。

### 5.2 问题

- 上游接口（如 `data_blue_keyword_7d_v2`）的指标按 7 天滑动窗口计算；窗口右端必须是「已结清」的天，否则统计未完成。
- 多数指标 T-2 才完成结算（数据落库延迟约 48h），导致默认窗口 `[T-7, T-0]` 包含 2-3 天未结算样本，污染 `search_popularity_mom`。
- 实测：默认窗口 vs `[T-9, T-3]`，TOP20 重叠率约 0.62，`mom` 字段方差差 1.7×，会被诊断标 `context_mismatch` 的概率明显升高。

### 5.3 选型

| 候选窗口 | 优点 | 缺点 |
| --- | --- | --- |
| T-7..T-0 | 用户感知"最新" | 含 T-2..T-0 未结算，方差大 |
| T-9..T-3 | 全窗口已结算 | "最新"概念后移 3 天 |
| T-14..T-7 | 完全保守 | 距今 1 周以上，业务偏旧 |

选 `T-9..T-3`。理由：在「窗口长度 7 天 + 全已结算」两个硬约束下唯一可选。

### 5.4 落地

- `manifest.default_date_range = "T-9..T-3"`
- runner 解析格式 `T-{N}..T-{M}`：`start_date = today - N days`，`end_date = today - M days`，`N > M`，`N - M` 必须等于上游接口约定的窗口长度（7 天）。
- 用户显式传 `date_range` 时不受 manifest 影响。
- 落 `RunMeta.date_range_source = "manifest_default" | "user_input"`，便于追溯。

### 5.5 兼容

旧 run（含 `T-7..T-0`）保留可读；compare 时不强制窗口对齐，仅在 `config_diff` 中显示窗口差异。

### 5.6 二次修订：T-9..T-3 → 上一个完整自然月（2026-Q3）

**触发**：真机回归发现 5/6 P0 接口空数据；除参数对齐问题外，`data_ads_industry_keywords_summary_m` / `data_blue_keyword_7d_v2` 等月度指标接口对 T-9..T-3 这种 7 天日级窗口拿不到样本（业务侧统计单位是月）。

**新策略**：用户未传 `date_range` 时，默认窗口取**上一个完整自然月**。

| 当前日期 | 默认 start_date | 默认 end_date |
| --- | --- | --- |
| 2026-03-15 | 2026-02-01 | 2026-02-28 |
| 2026-07-01 | 2026-06-01 | 2026-06-30 |
| 2027-01-10 | 2026-12-01 | 2026-12-31 |

**理由**：

- `business_date` 在月度接口里要求月初对齐（如 `2026-05-01` 表示 5 月数据集）；过去 7 天窗口（T-9..T-3 跨 5/6 月）会让 `business_date` 找不到落点。
- `summary_m` 接口本身就是月聚合表，日级窗口没意义。
- T-3 沉淀仍然成立：上一个完整自然月在「今天」时早已结算，不会触发未沉淀污染。

**落地**：

- 默认窗口由 [src/services/keyword_demand/live_pull.ts](src/services/keyword_demand/live_pull.ts) 的 `defaultDateRange()` 提供
- 用户显式传 `date_range` 时不受影响
- manifest `default_date_range: "T-9..T-3"` 保留作为「人工指定」hint，不再由代码自动应用
- 与 [docs/18_KEYWORD_FIELD_MAPPING_SPEC.md](docs/18_KEYWORD_FIELD_MAPPING_SPEC.md) §3.4 `date_format=month` 协同：dateRange 仍按日生成；月度接口（如 `data_keyword_trend`）在 mapping 节点声明 `date_format: month`，由 live_pull 在渲染期截短为 `YYYY-MM`

**兼容**：旧 run（T-7..T-0 / T-9..T-3）保留可读，run_id 哈希不同不会冲突。

## 6. SKILL.md 重写要点

[.pi/skills/keyword-demand/SKILL.md](db-archaeologist-pi-spec-pack/.pi/skills/keyword-demand/SKILL.md) 在 Phase 2 重写。要点（按 LLM 路由优先级排）：

### 6.1 触发词

```
- 关键词、需求词、蓝海词、搜索词、词路、关键词需求、关键词分析、keyword
```

### 6.2 默认行为话术

> 用户提到任意类目时，默认调 `analyze_keyword_demand`，参数 `entity` 填类目名，**不要填 `live: false`**。框架会自动按环境（`LIVE_PROBE=true` 时升 live）。

### 6.3 partial_no_id 引导

当 `resolution_kind = partial_no_id`（taxonomy 未命中 + auto_resolve 失败 + 用户没传 entity_id）时：

```
返回 kind="keyword_demand_error", error="entity_not_resolved"
LLM 应在回复里：
  1. 列出 hints（拼写检查 / 传入 entity_id / 开启 live）
  2. 主动追问用户是否有类目 id
  3. 不要重试同一参数，避免死循环
```

### 6.4 错误模式回流话术

| error | LLM 回复模板 |
| --- | --- |
| `entity_not_resolved` | "我没能在类目库里找到「{entity}」，请确认拼写，或提供类目 id。" |
| `pull_no_data` | "类目「{entity}」近期数据不足，已落诊断包 `{diagnostic_dir}`。建议换个时间窗口或检查上游凭据。" |
| `shape_mismatch` | "上游响应结构与预期不一致，已落诊断包 `{diagnostic_dir}`。请联系开发者。" |
| `live_disabled` | "当前未开启 live 探查；如需任意类目分析，请启动时加 `LIVE_PROBE=true`。" |
| `env_missing` | "缺少凭据：{missing_params}。请检查 `.env`。" |

### 6.5 不要做的事

- 不要主动调 `compare_keyword_demand_runs` 除非用户明确说「对比」。
- 不要把 fixture run 当作正式结果引用；fixture run 的 `RunMeta.fixture_hash` 不为空，且 `resolution_kind = mock_fixture_fallback`。
- 不要在用户没要求时切换 `strategy`；保持 `baseline_v1`。
- 不要直接调旧名 `list_keyword_runs / compare_keyword_runs`；优先使用新名（旧名仅作历史兼容）。

## 7. 迁移检查清单（Phase 2 验收）

按以下顺序逐项绿灯，缺一不可。

### 7.1 沙箱回归

```bash
cd db-archaeologist-pi-spec-pack
npm run rebuild:all     # 10 stage 全绿，cards=159 / tools=18 / KG 节点数不变
npm run test:golden     # 9+1 全绿（新增 1 条文件名兼容用例）
npm run smoke:pi        # 11 工具 ALL GREEN
node web/_smoke.mjs     # 12 端点 + Inspector 5 tab ALL GREEN
node --check $(find src/packs -name '*.ts')  # 静态语法检查
```

### 7.2 包内行为快照

```bash
# fixture 模式跑 3 个类目，对照旧 run 的产物逐字节 diff
LIVE_PROBE=false npm run keyword:demo -- 入户地垫 baseline_v1
LIVE_PROBE=false npm run keyword:demo -- 厨房地垫 baseline_v1
LIVE_PROBE=false npm run keyword:demo -- 浴室地垫 baseline_v1

# 对每个类目：
diff <旧 run_dir>/keyword_baseline_report.md <新 run_dir>/report.md
diff <旧 run_dir>/category_top_keywords.json <新 run_dir>/keyword_top.json
diff <旧 run_dir>/keyword_scores.json <新 run_dir>/keyword_scores.json
diff <旧 run_dir>/metric_records.json <新 run_dir>/metric_records.json
```

允许的差异：仅 `RunMeta` 新增字段（`pack_id / manifest_version / auto_upgraded_to_live`）。

### 7.3 真机 LIVE 验证

在真实 Terminal.app 跑（沙箱无外网）：

```bash
PI_CODING_AGENT_DIR="$(pwd)/.pi-home/agent" \
LIVE_PROBE=true \
npm run keyword:demo -- 桌布 baseline_v1 --live
```

期望：

- `RunMeta.auto_upgraded_to_live = false`（用户显式传 `--live`）。
- `pull_report.effective_apis ≥ 5`。
- `keyword_top.json` 的 TOP5 全部包含「桌布 / 桌垫 / 餐桌布」等同义词，**不混入「地垫 / 沙发垫」**（query-override fix 验证点）。
- `RunMeta.date_range = {start: T-9, end: T-3}`。

### 7.4 web Inspector 兼容

```bash
PORT=8888 PI_DEFAULT_MODEL=aicodemirror/gpt-5.5 LIVE_PROBE=false npm run web
```

人工点击：

- `/api/keyword/runs`（旧路径）应返回与 `/api/keyword_analysis_pack/keyword_demand/runs`（新路径）相同结果。
- Inspector「Keyword」tab 仍可正常列 run、看 report、对比。
- 旧 `run_dir`（`registry/derived/keyword_analysis_pack/<run_id>/`）与新 `run_dir`（`registry/derived/keyword_analysis_pack/keyword_demand/<run_id>/`）都能被列出（hybrid 期 `listRuns` 同时扫两层）。

### 7.5 SKILL 路由验证

启动 pi 后，输入：

```
帮我看下"客厅地毯"这个类目的关键词需求
```

期望：

- 命中 `analyze_keyword_demand`（不命中 trend_demand）。
- `live` 自动按环境升级。
- 返回正常 RunEnvelope 或 actionable error。

### 7.6 Git 提交点

迁移分两次提交：

1. 第一个提交：仅落 `_lib` + `src/packs/keyword_demand/` 新代码 + manifest + shim；旧 path 不删。
2. 第二个提交：把 11 处 import 改到新 path；shim 保留。
3. 第三个提交（可选，下一版本）：删 shim。

每次提交前都跑完 §7.1 的沙箱回归。

## 8. 不在本规范范围

- KDS 公式调整（4 子项权重、intent 规则）：在 [docs/biz_spect/keyword_demand_baseline_mvp1_spec.md](db-archaeologist-pi-spec-pack/docs/biz_spect/keyword_demand_baseline_mvp1_spec.md) 维护。
- `keyword_taxonomy.yaml` 的标签新增/调整：业务 review 流程在 SKILL.md 备注。
- LLM-VOC v3 / Semantic v2 的算法实现：仍是 stub，留 Phase 3。
- 跨包对比（与 trend_demand 联动）：留 Phase N+2。
- fixture 的回灌机制（live run → fixture）：留独立 follow-up。

---

## 9. Keyword Insight Pack 扩展规范

### 9.1 定位调整

`keyword_demand` 的第一阶段定位是 KDS 排名工具：给定品类，输出需求分类下按 KDS 排序的 TOP 关键词。

从本节开始，策略包升级为 `keyword insight pack`：

```text
keyword_demand 负责需求强度排序。
keyword_insight 负责解释需求、判断机会、生成动作建议。
```

两者在同一个分析 run 内完成：

```text
resolve → pull → shape → normalize
→ classify → score_kds → rank
→ insight_aggregate
→ report
```

KDS baseline_v1 的公式和权重不在本次升级中调整。新增接口先作为字段补齐、证据层和洞察层，不直接重写 KDS 主公式。

### 9.2 数据层分组

| 数据层 | 接口 | 作用 | 进入 KDS |
| --- | --- | --- | --- |
| KDS 主链 | `/agent/sycm_keyword` | 生意参谋关键词，提供基础搜索、点击、支付、增长字段 | 是 |
| KDS 主链 | `/agent/blue_ocean_keywords_analysis` | 蓝海关键词，补环比、同比、支付买家、供需比 | 是 |
| KDS 主链 | `/data/blue_keyword_7d_v2` | 近 7 天蓝海词，补供需和支付字段 | 是 |
| KDS 主链 | `/data/ads_industry_keywords_summary_m` | 月度行业关键词，补支付买家和供需比 | 是 |
| KDS 主链 | `/data/ads_industry_keywords_7d` | 近 7 天行业关键词趋势指标 | 是 |
| 搜索明细 | `/data/ind/category_keywords_detail_v2` | 类目搜索词明细，优先用于字段补齐 | 是 |
| 搜索明细 | `/data/ind/category_keywords_detail` | 旧版类目搜索词明细，作为兜底 | 是 |
| 需求分类 | `/data/keyword/category_requirements` | 需求分类、搜索值、需求占比 | 间接 |
| 需求分类 | `/data/keyword/category_requirements_v2` | 需求分类 v2、标题/词根、父级需求 | 间接 |
| 词根 | `/keywords_analysis` | 词根需求分析 | 否 |
| 词根 | `/agent/keyword` | 词根入口和词根候选 | 否 |
| 趋势 | `/data/keyword/trend` | 词根趋势、需求分类趋势 | 间接 |
| 趋势 | `/data/bluekeyword/trend` | 关键词趋势分析 | 否 |
| 元素 | `/data/keywords_element_d` | 类目关键词元素总结和建议 | 否 |
| 付费 | `/agent/xiaowan_keywords` | 直通车/小万关键词 | 否 |
| 付费 | `/data/cust/ads_ad_flow_plan_goods_keyword_7d` | 客户付费投流关键词表现 | 否 |
| 类目解析 | `/data/keywords/category_list` | 任意品类名称反查类目 id | 否 |

### 9.3 洞察模块

| 模块 | 输入 | 输出 | 业务用途 |
| --- | --- | --- | --- |
| `demand_strength_insight` | KDS、需求分类、字段覆盖 | 需求分类下 KDS TOP 排名 | 识别主流需求和强需求 |
| `root_insight` | 关键词、词根、搜索值、需求占比 | 词根 TOP、词根需求类型、词根动作 | 标题优化、产品结构、新品方向 |
| `trend_insight` | 搜索增长、环比、同比、趋势字段 | 强趋势、潜力趋势、伪趋势、活动型趋势 | 新品测试、趋势跟进、内容种草 |
| `paid_insight` | 付费点击、转化、花费、UV 价值 | 放量词、亏损词、低效词、拓词机会 | 投流放量、否词、预算调整 |
| `element_insight` | `summary`、`suggestion`、元素字段 | 卖点、内容主题、视觉/主图方向 | 内容种草、主图策划、详情页表达 |
| `action_recommendation` | KDS + 词根 + 趋势 + 付费 + 元素 | 老品优化、新品开发、内容种草、付费投流建议 | 经营动作落地 |

### 9.4 新增 run 输出文件

迁移后每次关键词分析 run 至少保留旧文件，并新增洞察文件。

| 文件 | 必需 | 内容 |
| --- | --- | --- |
| `keyword_scores.json` | 是 | 关键词级 KDS、需求分类、字段来源 |
| `category_top_keywords.json` | 是 | 兼容旧 TOP 输出 |
| `keyword_baseline_report.md` | 是 | 兼容旧业务报告 |
| `normalize_report.json` | 是 | 字段覆盖和多源合并情况 |
| `live_probe_results.json` | live 时 | 上游接口原始探查结果 |
| `dimension_coverage.json` | 是 | 规模、增长、流量、转化、需求分类的数据完整度 |
| `keyword_insights.json` | 是 | 词根、趋势、付费、元素等洞察结果 |
| `action_recommendations.json` | 是 | 面向老品、新品、内容、投流的动作建议 |

### 9.5 `keyword_insights.json` 草案

```json
{
  "category": "沙发套",
  "date_range": {
    "start_date": "2026-06-13",
    "end_date": "2026-06-20"
  },
  "demand_strength_insight": {
    "top_overall": [],
    "top_by_requirement_category": {
      "功能需求": [],
      "场景需求": [],
      "风格需求": []
    }
  },
  "root_insight": {
    "top_roots": [
      {
        "root": "防滑",
        "requirement_type": "功能需求",
        "keyword_count": 12,
        "search_value": 120000,
        "kds_avg": 72.5,
        "action_hint": "主图做防滑演示，标题加入防滑词"
      }
    ]
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

### 9.6 `action_recommendations.json` 草案

```json
{
  "old_product_optimization": [
    {
      "priority": "high",
      "action": "标题补充高 KDS 功能词",
      "evidence": ["防滑", "防水", "KDS>=70"],
      "applies_when": "已有商品具备功能但标题未承接",
      "data_gaps": []
    }
  ],
  "new_product_development": [
    {
      "priority": "high",
      "action": "开发场景细分款",
      "evidence": ["场景词增长>=20%", "KDS>=70", "供需比高"],
      "applies_when": "类目存在趋势需求且商品承接少"
    }
  ],
  "content_seeding": [
    {
      "priority": "medium",
      "action": "围绕风格/场景词做内容主题",
      "evidence": ["高级感", "奶油风", "元素分析 summary 命中"],
      "applies_when": "风格词增长或元素分析指向审美趋势"
    }
  ],
  "paid_traffic": [
    {
      "priority": "high",
      "action": "放量高转化词，否掉低效高花费词",
      "evidence": ["clk_trans_rate", "uv_value", "tras_cost"],
      "applies_when": "存在付费关键词数据"
    }
  ]
}
```

### 9.7 `dimension_coverage.json` 草案

```json
{
  "scale": {
    "required_fields": ["search_popularity", "pay_buyers"],
    "covered_fields": ["search_popularity"],
    "missing_fields": ["pay_buyers"],
    "fallback_used": true
  },
  "growth": {
    "required_fields": ["search_popularity_mom", "search_popularity_yoy", "trend_slope", "pay_buyers_mom"],
    "covered_fields": ["search_growth_rate"],
    "missing_fields": ["search_popularity_mom", "search_popularity_yoy", "trend_slope", "pay_buyers_mom"],
    "fallback_used": true
  },
  "traffic": {
    "required_fields": ["click_rate", "search_visitors", "tmall_click_share"],
    "covered_fields": ["click_rate"],
    "missing_fields": ["search_visitors", "tmall_click_share"],
    "fallback_used": true
  },
  "conversion": {
    "required_fields": ["pay_rate", "pay_buyers", "conversion_rate"],
    "covered_fields": ["pay_rate"],
    "missing_fields": ["pay_buyers", "conversion_rate"],
    "fallback_used": true
  },
  "requirement_category": {
    "required_fields": ["category_requirements", "title", "parent_name"],
    "covered_fields": [],
    "missing_fields": ["category_requirements", "title", "parent_name"],
    "fallback_used": true
  }
}
```

### 9.8 报告章节结构

`keyword_baseline_report.md` 或新兼容报告必须包含：

```text
0. 数据来源说明
1. 数据完整度与可信度
2. KDS TOP 总榜
3. 需求分类下 KDS TOP 排名
4. 词根洞察：词根 TOP、词根需求类型、标题/产品动作
5. 趋势洞察：强趋势、潜力趋势、伪趋势、活动型趋势
6. 付费洞察：放量词、低效词、拓词、否词
7. 关键词元素洞察：卖点、内容主题、视觉/主图方向
8. 老品优化建议
9. 新品开发建议
10. 内容种草建议
11. 付费投流建议
12. 数据缺口与下次补证
```

### 9.9 前端验收输出

关键词分析前端必须能展示：

- KDS 主榜。
- 需求分类下 KDS TOP。
- 候选接口审计：哪些有数据、哪些业务空、哪些解析失败。
- 维度缺失：规模、增长、流量、转化、需求分类。
- 词根洞察区。
- 趋势洞察区。
- 付费洞察区。
- 关键词元素洞察区。
- 四类动作建议：老品优化、新品开发、内容种草、付费投流。

没有某类数据时，前端显示空状态和原因，不隐藏模块。

### 9.10 商品级增强

默认输入只需要品类：

```json
{
  "category": "沙发套"
}
```

商品级增强输入：

```json
{
  "category": "沙发套",
  "goods_id_list": ["896924077268"],
  "user_id_list": ["1983420822379380738"]
}
```

规则：

- 未提供商品 ID 时，只输出类目级老品优化方向，不判断具体链接承接。
- 提供 `goods_id_list` 后，增加标题、主图、详情、SKU、卖点承接诊断。
- 提供 `user_id_list` 后，增加客户侧付费关键词表现诊断。
- 商品级数据不足时，报告必须写明“商品级承接诊断未开启 / 数据不足”。

### 9.11 后续代码实施任务拆分

| 任务 | 修改范围 | 验收 |
| --- | --- | --- |
| 接口映射扩展 | `registry/keyword_field_mapping.yaml` | 新增接口能进入 source audit |
| 响应解析增强 | `shape.ts` / `normalize.ts` | 支持分页 `data.result[]`、`kw_name`、`title`、`category_requirements` |
| 维度完整度 | 新增 coverage 模块 | 输出 `dimension_coverage.json` |
| 词根洞察 | 新增 root insight 模块 | 输出 `root_insight.top_roots` |
| 趋势洞察 | 新增 trend insight 模块 | 输出趋势等级和趋势词 |
| 付费洞察 | 新增 paid insight 模块 | 输出放量词、低效词、拓词、否词 |
| 元素洞察 | 新增 element insight 模块 | 输出卖点、内容主题、视觉方向 |
| 动作建议 | 新增 recommendation 模块 | 输出四类建议 |
| 报告输出 | `report.ts` | 报告包含 12 个章节 |
| 前端展示 | `web/*` | 页面展示所有洞察区块和空状态 |

### 9.12 验收标准

任意品类分析成功时必须满足：

- 可以生成 KDS 总榜。
- 可以生成需求分类下 KDS TOP。
- 可以展示数据源审计。
- 可以展示维度缺失。
- 可以生成 `keyword_insights.json`。
- 可以生成 `action_recommendations.json`。
- 可以在前端看到词根、趋势、付费、元素和动作建议区块。

数据不足时必须满足：

- 主报告不伪造缺失模块结论。
- 缺失模块明确说明原因。
- KDS 触发 fallback 时明确显示缺失字段和可信度影响。

---

## 10. KOIF 集成

### 10.1 角色

`keyword_demand` 是 KOIF（Keyword Operating Intelligence Framework）8 个评分能力中的「需求强度评估」，对应 `score_domain = demand`。在 KOIF Router（`propose_koif_strategy`）的 score_vector 中，本 capability 提供 `kds` 这一维度。

KOIF 全景与 8 capability 关系见 [14_KOIF_NAMESPACE_OVERVIEW.md](14_KOIF_NAMESPACE_OVERVIEW.md)；KOIF Router 元工具规范见 [15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md)。

### 10.2 Router 消费契约

KOIF Router 在 S3 load runs / S4 aggregate scores 阶段从本 capability 的 RunEnvelope 中读取以下产物：

| 产物文件 | 字段路径 | 用途 |
| --- | --- | --- |
| `run.meta.json` | `entity.canonical / entity.id` | 关联 router_run 的 entity |
| `run.meta.json` | `resolution.kind` | 判断是否 partial / mock_fixture_fallback |
| `<entity>_scores.json`（即 `keyword_scores.json`） | `records[].kds` | 主分数：KDS（0-100） |
| `<entity>_scores.json` | `records[].intent_multiplier` | 意图加权因子，传给 Router 作 action 优先级调权 |
| `<entity>_scores.json` | `records[].keyword` | 关联词列表（TOP N，N 由 Router 配置） |
| `<entity>_scores.json` | `records[].labels.intent` | 用于 action 模板渲染时的话术差异化 |
| `<entity>_top.json`（即 `keyword_top.json`） | `top_overall[]` | 提取 TOP 20 关键词供 Router 渲染 next_actions |

Router 不读 `enrichment_trace.jsonl` / `score_trace.jsonl`，仅取摘要级数据。

### 10.3 KDS 在 score_vector 中的位置

```typescript
score_vector.scores.kds = mean(top_N_records.kds)  // Phase 2 默认 N=20
score_vector.score_explanation.demand = "<根据 KDS 数值与 TOP 词汇生成的简述>"
```

Phase 2 KDS 聚合规则：
- 取 `keyword_top.json` 的 `top_overall[]` 前 20 词
- `score_vector.scores.kds = mean(records[i].kds for i in top_20)`
- 如果 `records.length < 20`，按实际数量取均值
- 如果 `records.length === 0`（live_no_keyword_data），KDS 不进入 score_vector，标记为 `unavailable`

### 10.4 路由触发条件

Phase 2 路由规则中涉及 KDS 的条件（详见 `registry/koif_route_rules.yaml`）：

- `old_product_optimization`：`kds >= 70`（仅需 KDS 即可触发）
- `trend_test`：`kds >= 60 && tms >= 75`（KDS + TMS 联合触发）
- `content_candidate`：`kds >= 70 && tms >= 70`（KDS + TMS 联合触发）

### 10.5 Action 模板对接

Phase 2 三类 action 中，KDS 主导的有：

- `title_rewrite`：`kds >= 70` 触发；模板从 `keyword_top.json` 取 TOP 5 高 KDS 词，渲染「建议在标题中强化 <keywords> 的覆盖」
- `paid_test`：`kds >= 80 && tms >= 60` 触发；模板取 TOP 3 高 KDS + intent 含 `purchase` 的词

完整 action 模板见 `registry/koif_action_templates.yaml`。

### 10.6 与三件套的工作流

```
KOIF Router 工作流（涉及 keyword_demand 部分）：

S2 invoke capabilities：
  Router → analyze_keyword_demand({entity, live, date_range})
  ↓
  capability 三件套跑完整 8-stage，落 RunEnvelope 到
  registry/derived/keyword_analysis_pack/keyword_demand/<run_id>/
  ↓
  返回 run_id 给 Router

S3 load runs：
  Router → 读 <run_id>/run.meta.json + keyword_scores.json + keyword_top.json
  ↓
  提取 KDS + intent_multiplier + TOP keywords

S4 aggregate scores：
  Router → score_vector.scores.kds = mean(top_20.kds)
```

### 10.7 缓存复用

如果同一 entity + strategy + date_range 在最近 24h 内已有成功 run，Router 可复用该 run（通过 `listRuns({namespace, capability: "keyword_demand"})` + 时间过滤），避免重复调上游 API。

复用策略：
- Router S2 先查最近 1 天内的 run（filter by `entity.canonical + strategy + date_range`）
- 命中则跳过 invoke，直接走 S3 读 run 产物
- 未命中或显式传 `force_refresh=true` 时正常调 capability 三件套

复用配置项在 Router 入参中（详见 15 号 §2）。

### 10.8 Phase 3+ 演进

Phase 3+ KOIF 扩展时，本 capability 不需要改动：
- score_domain 已固定为 `demand`
- 输出格式（`<entity>_scores.json` / `<entity>_top.json`）已稳定
- KDS 公式保持 baseline_v1，新策略（semantic_v2 / llm_voc_v3）落地时 Router 透传 strategy 参数即可
