# 24 Phase 1 实施方案（Batch 1 · 逐文件 diff 级技术文档）

> 目的：把 [docs/23_KOIF_SUBJECT_KIND_AND_RUNTIME_FUSION_SPEC.md](23_KOIF_SUBJECT_KIND_AND_RUNTIME_FUSION_SPEC.md) §1-§10 的 schema 决议翻译为可执行的代码改动清单。每条改动锚定**文件路径 + 函数 + 改前/改后伪代码**，但本文档本身**不动代码**。Batch 2 按本文档逐步落地。
>
> 状态：Draft，Batch 1 Pending Review（审核门 2）。
>
> 上游：[docs/23](23_KOIF_SUBJECT_KIND_AND_RUNTIME_FUSION_SPEC.md) §6（Router 单入口）/ §7（Decision 命名空间）/ §8（runtime_contract v2）/ §10（四件套）。

## §1 概览与原则

### §1.1 实施 14 步顺序

```text
01  registry/koif_capability_map.yaml                    新建（subject_kinds + capabilities + strategy_card）
02  registry/business_field_mapping/                     新建目录
02a   ├─ keyword.yaml                                    从 registry/keyword_field_mapping.yaml git mv
02b   ├─ category.yaml / item.yaml / shop.yaml / creative.yaml  占位 schema
03  6 处 readYaml 路径常量切换                            keyword_field_mapping 路径迁移
04  src/services/koif_router/types.ts                    ScoreVectorEntry + SubjectKind
05  src/services/koif_router/route.ts                    DSL 正则放宽 [a-z][a-z0-9_]*
06  src/services/koif_router/index.ts                    switch (subject_kind) 分流
07  src/services/koif_decision/types.ts                  DecisionKind 命名空间化 + LEGACY_DECISION_KIND_ALIAS
08  src/services/koif_decision/index.ts                  alias 归一化
09  src/tools/propose_koif_strategy.ts                   Schema 加 subject_kind 可选 enum
10  .pi/extensions/db_archaeologist.extension.ts         propose_koif_strategy 注册参数同步
11  web/lib/workspace.mjs                                新建：load + resolvePlaybookForCategory + cross_node_ref lint
12  web/server.mjs                                       新增 4 个 /api/workspace/* endpoint
13  web/_smoke.mjs                                       新增 5 组断言（capability_map / strategy_card / output_schema / category_params / cross_node_ref）
14  双绿：npm run test + node web/_smoke.mjs + DBA_PI_SMOKE=1 npm run smoke:pi
```

### §1.2 不动行为原则

- Phase 1 keyword 主体的算分、Router 路由、Decision stub 行为 100% 等价于现状（commit 7dfb794）。
- 任何改动若导致 keyword 域 golden 退化（含 `npm run test:golden` / `npm run test:invariants` / 真机三件套 / smoke），必须回退到上一步，根因分析后再上。
- AGENTS.md §8 `keyword_field_mapping.yaml` 五步 SOP 在第 02a 步迁移时强制执行：备份 → mv → 改 4+2 处 → 真机 probe → golden GREEN。

### §1.3 评审锚点

- §2-§3 对应 docs/23 §6-§7（Router/Decision 改造）。
- §4-§5 对应 docs/23 §3 + §10.2 + §10.4（capability_map + business_field_mapping）。
- §6-§7 对应 docs/23 §10.5 + §10.8（web 读侧 + BFF endpoint）。
- §8 对应 docs/23 §10.9（_smoke 断言扩张）。
- §9 是执行 / 回滚 / 验证门顺序。

<!-- §2 PLACEHOLDER -->

## §2 Router 改造（types / route / index）

### §2.1 文件清单与改动范围

| 文件 | 当前 LOC | 改动函数 / 类型 | 行为变化 | 风险等级 |
| --- | --- | --- | --- | --- |
| [src/services/koif_router/types.ts](../src/services/koif_router/types.ts) | 128 | `ScoreVectorEntry` / `CapabilityCode` / 新增 `SubjectKind` | 类型扩展，向后兼容 | 低（类型层） |
| [src/services/koif_router/route.ts](../src/services/koif_router/route.ts) | 85 | `parseCondition` 正则 / `ParsedCondition.metric` 类型 | DSL 放宽 | 低（不识别的 metric 仍视 false） |
| [src/services/koif_router/index.ts](../src/services/koif_router/index.ts) | 211 | `proposeKoifStrategy` 主入口 | 加 `switch (subject_kind)` | 低（默认 `keyword` 走原路径） |
| [src/tools/propose_koif_strategy.ts](../src/tools/propose_koif_strategy.ts) | — | TypeBox Schema 入参 | 加 `subject_kind` 可选 enum | 低 |
| [.pi/extensions/db_archaeologist.extension.ts](../.pi/extensions/db_archaeologist.extension.ts) line ~262 | — | `propose_koif_strategy` 注册参数 | 同 schema | 低 |

### §2.2 types.ts 改造（diff 级）

**新增类型**：

```ts
export type SubjectKind =
  | "keyword"
  | "item"
  | "shop"
  | "creative"
  | "category"
  | "content";

export const SUBJECT_KIND_VALUES: ReadonlyArray<SubjectKind> = [
  "keyword", "item", "shop", "creative", "category", "content",
];

export const SUBJECT_KIND_PHASE1_IMPLEMENTED: ReadonlyArray<SubjectKind> = ["keyword"];
```

**`ScoreVectorEntry` 改前**（types.ts:60-72）：

```ts
export interface ScoreVectorEntry {
  keyword: string;
  category: string;
  scores: Partial<Record<"kds" | "tms" | "pvs" | "ces" | "pfs" | "nos" | "bds" | "cps", number>>;
  available_scores: string[];
  trend_label?: "rising" | "stable" | "falling";
  kds_level?: string;
  cps_bucket?: "strong" | "medium" | "weak";
  cpc_source?: "paid" | "fallback" | "missing";
  rank_reason?: string;
}
```

**`ScoreVectorEntry` 改后**：

```ts
export interface ScoreVectorEntry {
  subject_kind: SubjectKind;            // 新增（强类型）
  subject_id: string;                   // 新增（关键词文本 / item_id / shop_id ...）
  subject_label?: string;               // 新增（可读名）
  keyword: string;                      // 保留：keyword 主体的 alias = subject_id；其他主体写空字符串
  category: string;
  scores: Record<string, number>;       // 放宽：metric 名由 capability_map 注册表权威定义
  available_scores: string[];
  trend_label?: "rising" | "stable" | "falling";
  kds_level?: string;
  cps_bucket?: "strong" | "medium" | "weak";
  cpc_source?: "paid" | "fallback" | "missing";
  rank_reason?: string;
}
```

**兼容点**：

- 历史 `registry/koif_routes/<run_id>/score_vector.json` 文件无 `subject_kind` / `subject_id` 字段。`aggregate.ts` / `write.ts` / `route.ts` 读盘时按 `entry.subject_kind ?? "keyword"` / `entry.subject_id ?? entry.keyword` 兜底（§2.4 详述）。
- `keyword: string` 字段保留到 Phase 2。

**`CapabilityCode` 改前**：

```ts
export type CapabilityCode = "kds" | "tms" | "cps";
```

**`CapabilityCode` 改后**：

```ts
// Phase 1: keyword 主体仍是 "kds" | "tms" | "cps"；保留枚举语义，仅放宽到 string 用于扩展
export type CapabilityCode = string;
export const KEYWORD_CAPABILITY_CODES: ReadonlyArray<"kds" | "tms" | "cps"> = ["kds", "tms", "cps"];
```

**`ProposeKoifStrategyInput` 改前**：

```ts
export interface ProposeKoifStrategyInput {
  category: string;
  category_id?: string;
  capabilities?: CapabilityCode[];
  live?: boolean;
  top_n?: number;
}
```

**改后**：

```ts
export interface ProposeKoifStrategyInput {
  subject_kind?: SubjectKind;           // 新增（可选，默认 "keyword"）
  category: string;
  category_id?: string;
  capabilities?: CapabilityCode[];
  live?: boolean;
  top_n?: number;
}
```

### §2.3 route.ts 改造（DSL 正则放宽）

**改前**（route.ts:23）：

```ts
const m = raw.match(/^\s*(kds|tms|pvs|ces|pfs|nos|bds|cps)\s*(>=|<=|>|<|==)\s*(-?[\d.]+)\s*$/i);
```

**改后**：

```ts
const m = raw.match(/^\s*([a-z][a-z0-9_]*)\s*(>=|<=|>|<|==)\s*(-?[\d.]+)\s*$/i);
```

**`ParsedCondition.metric` 类型放宽**：

```ts
// 改前
interface ParsedCondition {
  metric: "kds" | "tms" | "pvs" | "ces" | "pfs" | "nos" | "bds" | "cps";
  ...
}

// 改后
interface ParsedCondition {
  metric: string;                       // 放宽到任意小写下划线 metric 名
  ...
}
```

**`evalCondition` 取值兜底**（route.ts:30-40）已经按 `entry.scores[cond.metric]` 索引，metric 不在 `scores` 中时返 `false`，无需改动。`renderReason` 同理只需改 capture group 类型。

**回归测试 PIN 点**：

- `tests/golden.test.ts` 现有 keyword 域的 8 metric 条件全部仍能 parse + match，行为零变化。
- 新增 unit test：`route.test.ts` 增加 case `"ihs >= 70"` 不识别 metric → 整条 condition 不命中、不 throw。

### §2.4 index.ts 主入口分流

**改前**（index.ts:24-35）：

```ts
export async function proposeKoifStrategy(
  input: ProposeKoifStrategyInput,
): Promise<ProposeKoifStrategyOutput | ProposeKoifStrategyError> {
  const startedAt = new Date().toISOString();
  const requestedCategory = input.category.trim();
  const live = input.live ?? false;
  const capabilities: CapabilityCode[] = input.capabilities ?? ["kds", "tms", "cps"];

  // S0: 加载配置
  const rules = readYaml<RouteRulesConfig>(join(ROOT, "registry/koif_route_rules.yaml"));
  ...
```

**改后**：

```ts
export async function proposeKoifStrategy(
  input: ProposeKoifStrategyInput,
): Promise<ProposeKoifStrategyOutput | ProposeKoifStrategyError> {
  const subjectKind: SubjectKind = input.subject_kind ?? "keyword";

  // Phase 1: 仅 keyword 走完整逻辑；其余主体 fail-fast
  if (!SUBJECT_KIND_PHASE1_IMPLEMENTED.includes(subjectKind)) {
    return {
      error: "subject_unsupported_phase1",
      details: `Phase 1 仅支持 keyword 主体；当前 subject_kind=${subjectKind}。规划见 docs/23 §4`,
    };
  }

  const startedAt = new Date().toISOString();
  const requestedCategory = input.category.trim();
  const live = input.live ?? false;
  const capabilities: CapabilityCode[] = input.capabilities ?? ["kds", "tms", "cps"];

  // S0: 加载配置（keyword 域当前不变；下个迁移点是 koif_subjects/keyword/）
  const rules = readYaml<RouteRulesConfig>(join(ROOT, "registry/koif_route_rules.yaml"));
  ...
```

**`aggregate.ts` 兼容写法**（不改函数体，只在写 entry 时补字段）：

```ts
// aggregate.ts: buildScoreVectorEntry 内
return {
  subject_kind: "keyword",              // Phase 1 固定写入 keyword
  subject_id: keyword,
  keyword,                              // alias 保留
  category,
  scores,
  available_scores,
  ...
};
```

**`write.ts` 写盘兼容**：

- `score_vector.json` 仍按 `ScoreVectorEntry` 序列化，新增 `subject_kind` / `subject_id` 字段对老消费者无害（JSON.parse 多字段 OK）。
- 历史 run 反读时 `aggregate.ts` 兼容代码：`subject_kind = entry.subject_kind ?? "keyword"; subject_id = entry.subject_id ?? entry.keyword;`。

### §2.5 propose_koif_strategy.ts 工具 Schema

**改前**（推断当前 TypeBox schema）：

```ts
const InputSchema = Type.Object({
  category: Type.String(),
  category_id: Type.Optional(Type.String()),
  capabilities: Type.Optional(Type.Array(Type.Union([Type.Literal("kds"), Type.Literal("tms"), Type.Literal("cps")]))),
  live: Type.Optional(Type.Boolean()),
  top_n: Type.Optional(Type.Number()),
});
```

**改后**：

```ts
const InputSchema = Type.Object({
  subject_kind: Type.Optional(Type.Union([
    Type.Literal("keyword"),
    Type.Literal("item"),
    Type.Literal("shop"),
    Type.Literal("creative"),
    Type.Literal("category"),
    Type.Literal("content"),
  ])),
  category: Type.String(),
  category_id: Type.Optional(Type.String()),
  capabilities: Type.Optional(Type.Array(Type.String())),  // 放宽
  live: Type.Optional(Type.Boolean()),
  top_n: Type.Optional(Type.Number()),
});
```

**`scripts/typebox_stub.mjs` 已含 `Literal` + `Union`**，无需改 stub。

### §2.6 .pi/extensions 注册同步

[.pi/extensions/db_archaeologist.extension.ts](../.pi/extensions/db_archaeologist.extension.ts) line ~262 `name: "propose_koif_strategy"` 块的 inputs 定义同步加 `subject_kind`：

```ts
{
  name: "propose_koif_strategy",
  inputs: {
    subject_kind: Type.Optional(Type.Union([
      Type.Literal("keyword"), Type.Literal("item"), Type.Literal("shop"),
      Type.Literal("creative"), Type.Literal("category"), Type.Literal("content"),
    ]), { description: "评分主体；Phase 1 仅 keyword 实施" }),
    category: Type.String({ description: "三级类目名" }),
    ...
  },
}
```

## §3 Decision 命名空间化（types / index）

### §3.1 文件清单

| 文件 | 当前 LOC | 改动 | 行为变化 |
| --- | --- | --- | --- |
| [src/services/koif_decision/types.ts](../src/services/koif_decision/types.ts) | 83 | `DecisionKind` → 命名空间形态 + 新增 `LEGACY_DECISION_KIND_ALIAS` | 类型 + 常量扩展 |
| [src/services/koif_decision/index.ts](../src/services/koif_decision/index.ts) | 94 | `proposeKoifDecision` 入口加 alias 归一化 | 兼容旧调用 |

### §3.2 types.ts 改造

**改前**（types.ts:4-18）：

```ts
export type DecisionKind =
  | "paid_test_plan"
  | "sku_supply_plan"
  | "content_calendar"
  | "defensive_paid_plan"
  | "category_entry_plan";

export const DECISION_KIND_VALUES: ReadonlyArray<DecisionKind> = [
  "paid_test_plan",
  "sku_supply_plan",
  "content_calendar",
  "defensive_paid_plan",
  "category_entry_plan",
];
```

**改后**：

```ts
export type DecisionKind =
  | "keyword.paid_test_plan"
  | "keyword.sku_supply_plan"
  | "keyword.content_calendar"
  | "keyword.defensive_paid_plan"
  | "keyword.category_entry_plan";

export const DECISION_KIND_VALUES: ReadonlyArray<DecisionKind> = [
  "keyword.paid_test_plan",
  "keyword.sku_supply_plan",
  "keyword.content_calendar",
  "keyword.defensive_paid_plan",
  "keyword.category_entry_plan",
];

// 旧扁平命名 → 新命名空间命名（向后兼容映射）
export const LEGACY_DECISION_KIND_ALIAS: Readonly<Record<string, DecisionKind>> = {
  paid_test_plan:      "keyword.paid_test_plan",
  sku_supply_plan:     "keyword.sku_supply_plan",
  content_calendar:    "keyword.content_calendar",
  defensive_paid_plan: "keyword.defensive_paid_plan",
  category_entry_plan: "keyword.category_entry_plan",
};

export function normalizeDecisionKind(input: string): DecisionKind | null {
  const trimmed = String(input ?? "").trim();
  if (DECISION_KIND_VALUES.includes(trimmed as DecisionKind)) return trimmed as DecisionKind;
  if (trimmed in LEGACY_DECISION_KIND_ALIAS) return LEGACY_DECISION_KIND_ALIAS[trimmed];
  return null;
}
```

### §3.3 index.ts 入口归一化

**改前**（index.ts:38-50）：

```ts
const decisionKind = String(input?.decision_kind ?? "").trim() as DecisionKind;
if (!DECISION_KIND_VALUES.includes(decisionKind)) {
  return { kind: "koif_decision_error", error: "decision_kind_unsupported", ... };
}
```

**改后**：

```ts
const normalizedKind = normalizeDecisionKind(input?.decision_kind ?? "");
if (!normalizedKind) {
  return {
    kind: "koif_decision_error",
    error: "decision_kind_unsupported",
    message: `decision_kind=${input?.decision_kind ?? "(empty)"} 不在合法枚举内（含 alias）。`,
    hints: [
      `合法枚举：${DECISION_KIND_VALUES.join(", ")}`,
      `兼容别名：${Object.keys(LEGACY_DECISION_KIND_ALIAS).join(", ")} → keyword.<kind>`,
      "Phase 3 内所有 decision_kind 都返 decision_layer_phase3_stub，但需要先合法",
    ],
    router_run_id: routerRunId,
  };
}
const decisionKind = normalizedKind;
```

下游所有 `decisionKind` 引用保持不变；Phase 1 仍返 `decision_layer_phase3_stub`，行为零变化。

### §3.4 .pi/extensions 注册同步

[.pi/extensions/db_archaeologist.extension.ts](../.pi/extensions/db_archaeologist.extension.ts) line ~297 `name: "propose_koif_decision"` 块的 `decision_kind` 描述加 alias 提示：

```ts
decision_kind: Type.String({
  description: "决策类型；命名空间形态 keyword.<kind>（旧扁平名称自动归一化）",
}),
```

类型保持 `Type.String`，不收紧到 enum，以便兼容期接收旧调用。

<!-- §4 PLACEHOLDER -->

## §4 capability_map 创建（registry/koif_capability_map.yaml）

### §4.1 文件状态

- 路径：`registry/koif_capability_map.yaml`
- 当前状态：**不存在**（grep 全工作区无引用，docs/23 §3 是首次提案）。
- 创建时机：Batch 2 步骤 01。
- 加载方：[web/lib/workspace.mjs](../web/lib/workspace.mjs)（§6 新建模块）+ Phase 2 的 `capability_resolver`（Phase 1 不实现）。
- 写盘格式：YAML，由 `src/lib/yaml_lite.ts` 解析，不引入 npm 依赖。

### §4.2 schema_version 与顶层结构

```yaml
schema_version: koif-capability-map-v1
```

顶层 4 段：

```text
subject_kinds:    # 6 主体注册表（status + score_metrics）
capabilities:     # 双键索引（capability 名 → {subject_kind, namespace, router_owned, ...}）
  <name>:
    strategy_card:    # §10.2 策略本体（仅 router_owned=false 或 router_owned=true 都可挂）
    ...
defaults:         # 全局默认（如 default_subject_kind: keyword）
notes:            # 自由说明
```

### §4.3 Phase 1 注册的 7 capability（完整 yaml）

```yaml
schema_version: koif-capability-map-v1

subject_kinds:
  keyword:
    status: implemented
    score_metrics: [kds, tms, cps, pvs, ces, pfs, nos, bds]
  item:     { status: planned, score_metrics: [] }
  shop:     { status: planned, score_metrics: [] }
  creative: { status: planned, score_metrics: [] }
  category: { status: planned, score_metrics: [] }
  content:  { status: planned, score_metrics: [] }

capabilities:
  keyword_demand:
    subject_kind: keyword
    namespace: archaeology
    router_owned: true
    score_metric: kds
    candidates: [propose_koif_strategy, analyze_keyword_demand]
    strategy_card:
      schema_version: strategy-card-v1
      doc_anchors:
        - source_path: docs/biz_spec/marketing_insight/关键词分析后的 8 个必输出结论与判断标准.md
          kb_page_id: openkb-page-eight-keyword-conclusions
      output_dimensions: [需求结构, 人群需求, 场景需求, 功能需求, 属性需求, 趋势需求, 痛点需求, 升级需求]
      judgments:
        - id: trend_keyword
          label: 趋势关键词
          condition: "tms >= 70 and search_volume_growth_rate >= 0.30"
          output_field: { demand_dimension: 趋势需求 }
        - id: mainstream_keyword
          label: 主流需求
          condition: "search_volume_share >= 0.05"
          output_field: { demand_dimension: 需求结构 }
      品类_overrides: {}            # Phase 1 留空，由 category_params 注入

  keyword_competition:
    subject_kind: keyword
    namespace: archaeology
    router_owned: true
    score_metric: cps
    candidates: [propose_koif_strategy, analyze_keyword_competition]
    strategy_card:
      schema_version: strategy-card-v1
      doc_anchors: []              # 文档锚点待补
      output_dimensions: []
      judgments: []
      品类_overrides: {}

  keyword_trend:
    subject_kind: keyword
    namespace: archaeology
    router_owned: true
    score_metric: tms
    candidates: [propose_koif_strategy, analyze_keyword_trend]
    strategy_card: { schema_version: strategy-card-v1, doc_anchors: [], output_dimensions: [], judgments: [], 品类_overrides: {} }

  category_market_analysis:
    subject_kind: category
    namespace: archaeology
    router_owned: false
    candidates: [analyze_category_top_products]
    strategy_card: { schema_version: strategy-card-v1, doc_anchors: [], output_dimensions: [], judgments: [], 品类_overrides: {} }

  review_qa_pain_analysis:
    subject_kind: keyword
    namespace: archaeology
    router_owned: false
    candidates: []                  # Phase 1 unresolved（lint=unresolved_capability，UI 标红，不阻塞）
    strategy_card: { schema_version: strategy-card-v1, doc_anchors: [], output_dimensions: [], judgments: [], 品类_overrides: {} }

  price_band_opportunity:
    subject_kind: category
    namespace: archaeology
    router_owned: false
    candidates: []
    strategy_card: { schema_version: strategy-card-v1, doc_anchors: [], output_dimensions: [], judgments: [], 品类_overrides: {} }

  opportunity_score:
    subject_kind: keyword
    namespace: decision_layer
    router_owned: false
    candidates: [propose_koif_decision]
    strategy_card: { schema_version: strategy-card-v1, doc_anchors: [], output_dimensions: [], judgments: [], 品类_overrides: {} }

defaults:
  default_subject_kind: keyword

notes: |
  Phase 1：本文件仅供 web/lib/workspace.mjs 只读 lint 使用，不参与 Router/Decision 运行时分发。
  扩展节奏见 docs/23 §4（轻档 / 重档 SOP）；新增 capability 必须先在此处登记。
```

### §4.4 与 playbook.json 的闭环 lint

[registry/derived/scenario_workspace/scenarios/marketing_insight/playbook/playbook.json](../registry/derived/scenario_workspace/scenarios/marketing_insight/playbook/playbook.json) 有 10 个 node，逐 node `runtime_request.capability` 必须能在本文件 `capabilities` 下找到主键。Phase 1 lint 状态机：

| node.capability | capability_map 命中？ | candidates | UI 状态 |
| --- | --- | --- | --- |
| 命中 + candidates 非空 | ✓ | ✓ | 绿（可路由） |
| 命中 + candidates 空 | ✓ | ✗ | 黄（unresolved_capability） |
| 不命中 | ✗ | — | 红（unknown_capability） |
| router_owned=true 但 candidates 不含 propose_koif_strategy | — | ✗ | 红（router_integrity_violation） |
| subject_kind 状态为 planned | — | — | 灰（subject_planned） |

### §4.5 与现有 registry 的边界

- `koif_route_rules.yaml` / `koif_action_templates.yaml` / `keyword_strategies.yaml` / `keyword_field_mapping.yaml`：Phase 1 不动，仍是 keyword 域权威。
- `koif_capability_map.yaml`：Phase 1 仅是**只读 lint 索引**，不替代上述任一文件。

## §5 business_field_mapping 目录迁移

### §5.1 现有 keyword_field_mapping.yaml 加载点（实测）

执行 `rg keyword_field_mapping` 实测加载点（Batch 1 调研结果）：

| 路径 | 行号 | 用途 |
| --- | --- | --- |
| [src/services/keyword_demand/index.ts](../src/services/keyword_demand/index.ts) | 91 | `analyze_keyword_demand` 入口 readYaml |
| [src/services/keyword_competition/index.ts](../src/services/keyword_competition/index.ts) | 92 | `analyze_keyword_competition` 入口 readYaml |
| [src/services/keyword_trend/index.ts](../src/services/keyword_trend/index.ts) | 60 | `analyze_keyword_trend` 入口 readYaml |
| [src/services/koif_router/resolve.ts](../src/services/koif_router/resolve.ts) | 23 | Router category resolve readYaml |
| [tests/golden.test.ts](../tests/golden.test.ts) | 224 | golden test fixture readYaml |
| [tests/invariants.test.ts](../tests/invariants.test.ts) | — | mapping_schema_lint 不变量 |
| [src/services/keyword_demand/report.ts](../src/services/keyword_demand/report.ts) | 501 | 错误提示字符串引用文件名（不动） |

总计：**6 处真正的 readYaml 路径常量**（4 src + 2 tests）+ 1 处错误提示字符串（保留为 `keyword_field_mapping.yaml` 不变，下游用户可读性）。

> 注：docs/23 §10.4 原写"三处"为初步估算，本节以实测为准修正为 6 处。

### §5.2 目录创建（Batch 2 步骤 02 + 02b）

```text
registry/business_field_mapping/
  keyword.yaml         # 由现有 registry/keyword_field_mapping.yaml git mv（保 git 历史）
  category.yaml        # 占位
  item.yaml            # 占位
  shop.yaml            # 占位
  creative.yaml        # 占位
  README.md            # 1 段说明 + 引用 docs/23 §10.4
```

### §5.3 keyword.yaml 迁移流程（AGENTS §8 五步 SOP 强制）

```text
S1 备份
   cp registry/keyword_field_mapping.yaml \
      registry/_archive/keyword_field_mapping.<YYYYMMDD-HHmm>.yaml

S2 git mv（保 git 历史）
   git mv registry/keyword_field_mapping.yaml \
          registry/business_field_mapping/keyword.yaml

S3 同步 6 处加载点常量
   sed-style 替换字符串：
     "registry/keyword_field_mapping.yaml"
       → "registry/business_field_mapping/keyword.yaml"
   生效文件：
     src/services/keyword_demand/index.ts:91
     src/services/keyword_competition/index.ts:92
     src/services/keyword_trend/index.ts:60
     src/services/koif_router/resolve.ts:23
     tests/golden.test.ts:224
     tests/invariants.test.ts:<匹配行>
   不动：src/services/keyword_demand/report.ts:501（错误提示文案保留旧名以利用户检索）

S4 真机 probe
   投流域 + 需求域 + 沙发垫窗口 LIVE probe（Terminal.app 三件套）
   验证 status=ok / HTTP 200 / 字段提取正常

S5 双绿
   npm run test:golden     → GREEN
   npm run test:invariants → GREEN
   DBA_PI_SMOKE=1 npm run smoke:pi → GREEN
   node web/_smoke.mjs     → GREEN
```

### §5.4 占位 yaml schema（category/item/shop/creative）

每份占位文件统一形态：

```yaml
schema_version: business-field-mapping-v1
subject_kind: <name>
status: phase1_placeholder           # Phase 1 fail-fast 标记
phase1_behavior: |
  Phase 1 仅 schema 占位，运行时按此 subject_kind 查找会返
  mapping_unsupported_phase1。规划见 docs/23 §10.4。

apis: {}
fields: {}
aggregation: {}
```

运行时取 mapping 时统一封装函数（Phase 1 仅 keyword 调用，但接口提前定义）：

```ts
// 伪代码（Phase 2 落地）：
function loadBusinessFieldMapping(subject_kind: SubjectKind): BFM | { error: string } {
  const path = `registry/business_field_mapping/${subject_kind}.yaml`;
  if (!existsSync(path)) return { error: "mapping_subject_unknown" };
  const m = readYaml<BFM>(path);
  if (m.status === "phase1_placeholder") {
    return { error: "mapping_unsupported_phase1", subject_kind };
  }
  return m;
}
```

### §5.5 README.md（目录索引）

```markdown
# business_field_mapping

按 `subject_kind` 分文件存放业务字段 → 数仓 API 映射（schema 三段式：apis / fields / aggregation）。

| 文件 | subject_kind | Phase 1 状态 |
| --- | --- | --- |
| keyword.yaml  | keyword  | implemented（自 registry/keyword_field_mapping.yaml 迁移） |
| category.yaml | category | phase1_placeholder |
| item.yaml     | item     | phase1_placeholder |
| shop.yaml     | shop     | phase1_placeholder |
| creative.yaml | creative | phase1_placeholder |

修订纪律见 [docs/18 §5](../../docs/18_KEYWORD_FIELD_MAPPING_SPEC.md) 五步 SOP；扩展规范见 [docs/23 §10.4](../../docs/23_KOIF_SUBJECT_KIND_AND_RUNTIME_FUSION_SPEC.md)。
```

### §5.6 invariants 同步

[tests/invariants.test.ts](../tests/invariants.test.ts) 现有 `mapping_schema_lint` 仅校验 keyword.yaml。Batch 2 内不扩展校验范围，仅同步路径常量。新增主体的 schema 校验在该主体 `status: implemented` 时一并增量加 invariant。

## §6 web/lib/workspace.mjs 新建（只读 loader + 闭环 lint + cross_node_ref 校验）

### §6.1 文件状态

- 路径：`web/lib/workspace.mjs`
- 当前状态：**不存在**（grep 全工作区无引用）。
- 创建时机：Batch 2 步骤 11。
- 体量参考：[web/lib/registry-snapshot.mjs](../web/lib/registry-snapshot.mjs)（81 行 2401 字节）。预估 220-260 行。
- 零外部依赖：仅 Node builtins（`node:fs/promises` + `node:path`），不引入 npm。
- 与 `src/lib/yaml_lite.ts` 的关系：本模块运行在 web BFF 内（Node 入口为 `.mjs`），需要 yaml 解析时复用 `src/lib/yaml_lite.ts`，通过 `scripts/ts_loader.mjs` 已就位的 hook 直接 import；不再造轮子。

### §6.2 模块导出契约

```text
web/lib/workspace.mjs
  ├─ getScenarioIndex()                 → { schema_version, scenarios[], missions[] } | null
  ├─ getScenario(scenario_id)           → { manifest, playbook, schema_tags, kb_manifest, gate_policy, artifact_templates } | null
  ├─ getPlaybook(scenario_id)           → playbook json | null
  ├─ getSchemaTags(scenario_id)         → schema_tags json | null
  ├─ getMission(mission_id)             → mission json | null
  ├─ getCapabilityMap()                 → capability_map yaml-as-json | null
  ├─ getArtifactTemplate(scenario_id, artifact_id) → template json | null
  ├─ resolvePlaybookForCategory(scenario_id, category_id?) → { instance, lints[] }
  ├─ lintCapabilityMapAgainstPlaybook(scenario_id) → { lints[] }
  └─ lintCrossNodeRefs(scenario_id)     → { lints[] }
```

所有函数纯只读，零 fs 写。所有路径常量集中在文件顶部 `PATHS` 常量块。所有 try/catch 缺失文件直接返 `null`（与 registry-snapshot.mjs 风格一致）。

### §6.3 文件骨架（伪代码）

```js
// web/lib/workspace.mjs
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.env.SPEC_PACK_ROOT || process.cwd();
const WS_BASE = "registry/derived/scenario_workspace";

const PATHS = {
  scenarioIndex: `${WS_BASE}/scenario_index.json`,
  scenarioDir: (sid) => `${WS_BASE}/scenarios/${sid}`,
  playbook: (sid) => `${WS_BASE}/scenarios/${sid}/playbook/playbook.json`,
  manifest: (sid) => `${WS_BASE}/scenarios/${sid}/scenario_manifest.json`,
  schemaTags: (sid) => `${WS_BASE}/scenarios/${sid}/schema/schema_tags.json`,
  kbManifest: (sid) => `${WS_BASE}/scenarios/${sid}/kb/kb_manifest.json`,
  gatePolicy: (sid) => `${WS_BASE}/scenarios/${sid}/playbook/gate_policy.json`,
  artifactTemplate: (sid, aid) =>
    `${WS_BASE}/scenarios/${sid}/playbook/artifact_templates/${aid}.json`,
  artifactDir: (sid) => `${WS_BASE}/scenarios/${sid}/playbook/artifact_templates`,
  mission: (mid) => `${WS_BASE}/missions/${mid}/mission.json`,
  capabilityMap: "registry/koif_capability_map.yaml",
};

async function readJsonSafe(rel) {
  try { return JSON.parse(await readFile(path.join(ROOT, rel), "utf8")); }
  catch { return null; }
}

async function readYamlSafe(rel) {
  // 复用 src/lib/yaml_lite.ts 的 parseYaml；ts_loader 已注册 hook
  try {
    const { parseYaml } = await import(path.join(ROOT, "src/lib/yaml_lite.ts"));
    return parseYaml(await readFile(path.join(ROOT, rel), "utf8"));
  } catch { return null; }
}
```

### §6.4 getScenario 数据合成

```js
export async function getScenario(scenario_id) {
  const manifest = await readJsonSafe(PATHS.manifest(scenario_id));
  if (!manifest) return null;
  const playbook = await readJsonSafe(PATHS.playbook(scenario_id));
  const schema_tags = await readJsonSafe(PATHS.schemaTags(scenario_id));
  const kb_manifest = await readJsonSafe(PATHS.kbManifest(scenario_id));
  const gate_policy = await readJsonSafe(PATHS.gatePolicy(scenario_id));
  const artifact_templates = await listArtifactTemplates(scenario_id);
  return { scenario_id, manifest, playbook, schema_tags, kb_manifest, gate_policy, artifact_templates };
}

async function listArtifactTemplates(sid) {
  try {
    const dir = path.join(ROOT, PATHS.artifactDir(sid));
    const files = await readdir(dir);
    const out = [];
    for (const f of files.filter((x) => x.endsWith(".json"))) {
      const j = await readJsonSafe(path.join(PATHS.artifactDir(sid), f));
      if (j) out.push(j);
    }
    return out;
  } catch { return []; }
}
```

### §6.5 resolvePlaybookForCategory（Phase 1 兼容现有 playbook.json）

docs/23 §10.5 决议：Phase 1 adapter 不拆 template，spec-pack 把 `playbook.json` 视为 instance；新增 `category_params_path` 可选字段，未提供时按"通用品类"。

```js
export async function resolvePlaybookForCategory(scenario_id, category_id) {
  const playbook = await getPlaybook(scenario_id);
  if (!playbook) return { instance: null, lints: [{ level: "error", code: "playbook_not_found" }] };

  const lints = [];
  // Phase 1 不做实质 merge：直接返回 playbook 作为 instance
  const instance = JSON.parse(JSON.stringify(playbook));

  if (!category_id) {
    lints.push({ level: "info", code: "category_default_universal",
      message: "未提供 category_id，按通用品类解析" });
  }

  // Lint 1：strategy_card 含 品类_overrides 但无 category_params 输入
  const cmap = await getCapabilityMap();
  if (cmap?.capabilities) {
    for (const node of instance.nodes || []) {
      const cap = cmap.capabilities[node.runtime_request?.capability];
      const overrides = cap?.strategy_card?.["品类_overrides"];
      if (overrides && Object.keys(overrides).length > 0 && !category_id) {
        lints.push({
          level: "warn",
          code: "category_params_required",
          node_id: node.node_id,
          capability: node.runtime_request.capability,
          message: "strategy_card 含 品类_overrides，但未提供 category_id",
        });
      }
    }
  }

  // 实例 hash 用于 _smoke 断言"切换品类时实例 hash 变化"——Phase 1 因为不实质 merge
  // 故 hash 仅取决于 (scenario_id, category_id ?? "__universal__")
  instance.__resolution = {
    scenario_id, category_id: category_id ?? null,
    instance_hash: stableHash([scenario_id, category_id ?? "__universal__"]),
  };
  return { instance, lints };
}

function stableHash(parts) {
  // FNV-1a 32bit；仅供 lint 闭环识别变化，不参与安全
  let h = 0x811c9dc5;
  const s = JSON.stringify(parts);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193);
  }
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}
```

### §6.6 lintCapabilityMapAgainstPlaybook（§4.4 lint 状态机落地）

```js
export async function lintCapabilityMapAgainstPlaybook(scenario_id) {
  const lints = [];
  const playbook = await getPlaybook(scenario_id);
  const cmap = await getCapabilityMap();
  if (!playbook) return { lints: [{ level: "error", code: "playbook_not_found" }] };
  if (!cmap)     return { lints: [{ level: "error", code: "capability_map_not_found" }] };

  const cap_table = cmap.capabilities || {};
  const sk_table  = cmap.subject_kinds || {};

  for (const node of playbook.nodes || []) {
    const cap_name = node.runtime_request?.capability;
    if (!cap_name) {
      // strategy / hermes_request / human_review_gate 等无 capability 节点跳过
      continue;
    }
    const cap = cap_table[cap_name];
    if (!cap) {
      lints.push({ level: "error", code: "unknown_capability",
        node_id: node.node_id, capability: cap_name }); continue;
    }
    const sk_status = sk_table[cap.subject_kind]?.status;
    if (sk_status === "planned") {
      lints.push({ level: "info", code: "subject_planned",
        node_id: node.node_id, subject_kind: cap.subject_kind });
    }
    if (cap.router_owned === true && !(cap.candidates || []).includes("propose_koif_strategy")) {
      lints.push({ level: "error", code: "router_integrity_violation",
        node_id: node.node_id, capability: cap_name });
    }
    if (!(cap.candidates && cap.candidates.length > 0)) {
      lints.push({ level: "warn", code: "unresolved_capability",
        node_id: node.node_id, capability: cap_name });
    }
  }
  return { lints };
}
```

### §6.7 lintCrossNodeRefs（§10.3 `@{node_id}.artifact.{template_id}.{field}` 语法校验）

Phase 1 仅做语法校验 + 引用合法性检查，不实际取值。

```js
const CROSS_NODE_REF_RE = /^@([a-z_][a-z0-9_]*)\.artifact\.([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_.\[\]]*)$/i;

export async function lintCrossNodeRefs(scenario_id) {
  const lints = [];
  const sc = await getScenario(scenario_id);
  if (!sc?.playbook) return { lints: [{ level: "error", code: "playbook_not_found" }] };

  const node_ids   = new Set((sc.playbook.nodes || []).map((n) => n.node_id));
  const node_arts  = new Map(); // node_id -> Set(artifact_id)
  for (const n of sc.playbook.nodes || []) {
    node_arts.set(n.node_id, new Set(n.artifact_templates || []));
  }

  for (const tmpl of sc.artifact_templates || []) {
    const schema = tmpl.output_schema;
    if (!schema) {
      lints.push({ level: "info", code: "output_schema_absent",
        artifact_id: tmpl.artifact_id }); continue;
    }
    walk(schema, (val, path_) => {
      if (typeof val !== "string" || !val.startsWith("@")) return;
      const m = val.match(CROSS_NODE_REF_RE);
      if (!m) {
        lints.push({ level: "error", code: "cross_node_ref_syntax",
          artifact_id: tmpl.artifact_id, path: path_, raw: val });
        return;
      }
      const [, refNode, refArt] = m;
      if (!node_ids.has(refNode)) {
        lints.push({ level: "error", code: "cross_node_ref_unknown_node",
          artifact_id: tmpl.artifact_id, path: path_, ref_node: refNode });
      } else if (!node_arts.get(refNode)?.has(refArt)) {
        lints.push({ level: "error", code: "cross_node_ref_unknown_artifact",
          artifact_id: tmpl.artifact_id, path: path_, ref_node: refNode, ref_artifact: refArt });
      }
    });
  }
  return { lints };
}

function walk(node, visit, prefix = "") {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, visit, `${prefix}[${i}]`));
  } else if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) walk(v, visit, prefix ? `${prefix}.${k}` : k);
  } else {
    visit(node, prefix);
  }
}
```

### §6.8 与 server.mjs 的接口契约

server.mjs 不直接读 fs，全部走本模块函数。本模块的所有错误一律返 `null` + `lints[]`，不抛异常；server.mjs 仅做 HTTP 层 4xx/5xx 包装。

### §6.9 不做（边界）

- 不实施 `category_params/<category_id>.json` 的真实 merge（docs/23 §10.5 决议：Phase 2）。
- 不实施 cross_node_ref 取值（Phase 1 仅语法 + 节点存在性校验）。
- 不缓存任何文件（registry-snapshot.mjs 已确立"每次请求实时读"风格，避免与 `/api/registry/refresh` 的 rebuild 流程冲突）。

## §7 web/server.mjs `/api/workspace/*` endpoint 新增

### §7.1 现状与改动范围

`grep -n "/api/workspace"` 全工作区无匹配。Batch 2 步骤 12 内全新增。

| route | method | 用途 | 实现来源 |
| --- | --- | --- | --- |
| `/api/workspace/scenario_index` | GET | 场景列表 | `getScenarioIndex()` |
| `/api/workspace/scenarios/:sid` | GET | 单场景全聚合（manifest + playbook + schema_tags + kb_manifest + gate_policy + artifacts） | `getScenario(sid)` |
| `/api/workspace/scenarios/:sid/playbook` | GET | 仅 playbook | `getPlaybook(sid)` |
| `/api/workspace/scenarios/:sid/schema` | GET | 仅 schema_tags | `getSchemaTags(sid)` |
| `/api/workspace/scenarios/:sid/artifact_templates/:aid` | GET | 单 artifact 模板 | `getArtifactTemplate(sid, aid)` |
| `/api/workspace/scenarios/:sid/lint` | GET | 闭环 lint（capability_map × playbook + cross_node_ref） | `lintCapabilityMapAgainstPlaybook(sid)` + `lintCrossNodeRefs(sid)` |
| `/api/workspace/missions/:mid` | GET | 单 mission | `getMission(mid)` |
| `/api/workspace/capability_map` | GET | capability_map.yaml as json | `getCapabilityMap()` |
| `/api/workspace/resolve_instance` | POST | dry-run resolve（{scenario_id, category_id?}） | `resolvePlaybookForCategory(...)` |

总计 **9 个 endpoint**（覆盖 docs/22 §"PI-Agent Follow-Up Interface" 的 4 个 base endpoint + docs/23 §10.8 的 2 个新 endpoint + lint/capability_map/artifact 3 个 helper endpoint）。

### §7.2 路由插入位置

在 [web/server.mjs](../web/server.mjs) 现有 `handleApi` 函数内（line ~204 起），所有 `/api/workspace/*` 路由插入到 `/api/registry/refresh`（line ~220）之后、`/api/stream`（line ~241）之前。GET 类全部走前缀匹配，POST 类放到 switch (route) case 内。

### §7.3 server.mjs 改造（伪代码）

**文件顶部 import 增补**（line ~30 附近，现有 `getSnapshot`/`callInsight` 同级）：

```js
import {
  getScenarioIndex, getScenario, getPlaybook, getSchemaTags,
  getArtifactTemplate, getMission, getCapabilityMap,
  resolvePlaybookForCategory,
  lintCapabilityMapAgainstPlaybook, lintCrossNodeRefs,
} from "./lib/workspace.mjs";
```

**handleApi 内 GET 路由块**（line ~220 附近插入）：

```js
if (route === "/api/workspace/scenario_index" && req.method === "GET") {
  const idx = await getScenarioIndex();
  if (!idx) return sendJson(res, 404, { error: "scenario_index_not_found" });
  return sendJson(res, 200, idx);
}

if (route === "/api/workspace/capability_map" && req.method === "GET") {
  const cmap = await getCapabilityMap();
  if (!cmap) return sendJson(res, 404, { error: "capability_map_not_found" });
  return sendJson(res, 200, cmap);
}

const M_SCENARIO          = route.match(/^\/api\/workspace\/scenarios\/([^/]+)$/);
const M_PLAYBOOK          = route.match(/^\/api\/workspace\/scenarios\/([^/]+)\/playbook$/);
const M_SCHEMA            = route.match(/^\/api\/workspace\/scenarios\/([^/]+)\/schema$/);
const M_ARTIFACT          = route.match(/^\/api\/workspace\/scenarios\/([^/]+)\/artifact_templates\/([^/]+)$/);
const M_LINT              = route.match(/^\/api\/workspace\/scenarios\/([^/]+)\/lint$/);
const M_MISSION           = route.match(/^\/api\/workspace\/missions\/([^/]+)$/);

if (M_SCENARIO && req.method === "GET") {
  const sc = await getScenario(decodeURIComponent(M_SCENARIO[1]));
  if (!sc) return sendJson(res, 404, { error: "scenario_not_found" });
  return sendJson(res, 200, sc);
}
if (M_PLAYBOOK && req.method === "GET") {
  const pb = await getPlaybook(decodeURIComponent(M_PLAYBOOK[1]));
  if (!pb) return sendJson(res, 404, { error: "playbook_not_found" });
  return sendJson(res, 200, pb);
}
if (M_SCHEMA && req.method === "GET") {
  const st = await getSchemaTags(decodeURIComponent(M_SCHEMA[1]));
  if (!st) return sendJson(res, 404, { error: "schema_tags_not_found" });
  return sendJson(res, 200, st);
}
if (M_ARTIFACT && req.method === "GET") {
  const sid = decodeURIComponent(M_ARTIFACT[1]);
  const aid = decodeURIComponent(M_ARTIFACT[2]);
  const tmpl = await getArtifactTemplate(sid, aid);
  if (!tmpl) return sendJson(res, 404, { error: "artifact_template_not_found" });
  return sendJson(res, 200, tmpl);
}
if (M_LINT && req.method === "GET") {
  const sid = decodeURIComponent(M_LINT[1]);
  const a = await lintCapabilityMapAgainstPlaybook(sid);
  const b = await lintCrossNodeRefs(sid);
  return sendJson(res, 200, {
    scenario_id: sid,
    lints: [...(a.lints || []), ...(b.lints || [])],
  });
}
if (M_MISSION && req.method === "GET") {
  const m = await getMission(decodeURIComponent(M_MISSION[1]));
  if (!m) return sendJson(res, 404, { error: "mission_not_found" });
  return sendJson(res, 200, m);
}
```

**POST 块**（现有 `case "/api/koif_routes/propose"` 同级追加，line ~709 附近）：

```js
case "/api/workspace/resolve_instance": {
  const body = await readJsonBody(req);
  const sid = String(body?.scenario_id ?? "").trim();
  if (!sid) return sendJson(res, 400, { error: "scenario_id required" });
  const cat = body?.category_id ? String(body.category_id) : undefined;
  const result = await resolvePlaybookForCategory(sid, cat);
  return sendJson(res, 200, result);
}
```

### §7.4 头部注释同步

server.mjs line 4-15 头注释加 9 个新 endpoint 的一行说明（不影响行为，仅文档）：

```text
//   - GET  /api/workspace/scenario_index
//   - GET  /api/workspace/scenarios/:sid
//   - GET  /api/workspace/scenarios/:sid/playbook
//   - GET  /api/workspace/scenarios/:sid/schema
//   - GET  /api/workspace/scenarios/:sid/artifact_templates/:aid
//   - GET  /api/workspace/scenarios/:sid/lint
//   - GET  /api/workspace/missions/:mid
//   - GET  /api/workspace/capability_map
//   - POST /api/workspace/resolve_instance  { scenario_id, category_id? }
```

### §7.5 错误形态约定

- `404 { error: "...not_found" }`：派生产物缺失（rebuild 未跑或 scenario_id 写错）。
- `400 { error: "..." }`：POST body 缺必填字段。
- `500 { error: msg }`：workspace.mjs 抛异常时（理论上不发生，本模块已全部 try/catch 兜底）。
- `200 { ..., lints: [...] }`：lint endpoint 即使有 error 级 lint 也返 200，业务由 UI 自行渲染红黄灰状态。

### §7.6 不做（边界）

- 不引入鉴权（与现有 BFF 一致，沙箱内单用户）。
- 不做缓存层（同 §6.9）。
- 不暴露 fs 写接口（Phase 1 read-only，与 docs/22 "PI-Agent Follow-Up Interface" 段"first integration should be read-only"对齐）。

## §8 web/_smoke.mjs 断言扩张

### §8.1 现状

[web/_smoke.mjs](../web/_smoke.mjs) 当前 336 行 17418 字节，依次覆盖：snapshot / markdown / details 分发（qa/plan/card/lineage/domain/issues）/ probe（blocked/ok/error）/ store（upstream_error / inspector tab / keyword analysis）。零 workspace 断言。

### §8.2 新增断言块（接在文件末尾 `console.log("OK")` 之前）

```js
// ─────────────────────────────────────────────
// workspace endpoints (offline，直接调 lib/workspace.mjs)
// ─────────────────────────────────────────────
const ws = await import("./lib/workspace.mjs");

const idx = await ws.getScenarioIndex();
assert.ok(idx, "scenario_index must exist");
assert.equal(idx.schema_version, "business-strategy-scenario-index-v1");
assert.ok(Array.isArray(idx.scenarios) && idx.scenarios.length >= 1);
assert.ok(idx.scenarios.find((s) => s.scenario_id === "marketing_insight"));

const sc = await ws.getScenario("marketing_insight");
assert.ok(sc, "marketing_insight scenario must load");
assert.ok(sc.playbook, "playbook present");
assert.equal(sc.playbook.scenario_id, "marketing_insight");
assert.ok(Array.isArray(sc.playbook.nodes) && sc.playbook.nodes.length === 10,
  "10 playbook nodes");
assert.ok(sc.schema_tags, "schema_tags present");
assert.equal(sc.schema_tags.schema_version, "biz-strategy-meta-v2");
assert.ok(Array.isArray(sc.artifact_templates) && sc.artifact_templates.length >= 17,
  "17 artifact templates");

console.log("[workspace] scenario_index + scenario + 10 nodes OK");

// ─────────────────────────────────────────────
// capability_map × playbook lint
// ─────────────────────────────────────────────
const cmap = await ws.getCapabilityMap();
assert.ok(cmap, "koif_capability_map.yaml must load");
assert.equal(cmap.schema_version, "koif-capability-map-v1");
assert.ok(cmap.capabilities?.keyword_demand, "capability keyword_demand registered");
assert.equal(cmap.capabilities.keyword_demand.subject_kind, "keyword");
assert.equal(cmap.capabilities.keyword_demand.router_owned, true);
assert.ok(Array.isArray(cmap.capabilities.keyword_demand.candidates));
assert.ok(cmap.capabilities.keyword_demand.candidates.includes("propose_koif_strategy"));

// strategy_card 字段闭环：keyword_demand 必有 schema_version + judgments[]
const sc1 = cmap.capabilities.keyword_demand.strategy_card;
assert.ok(sc1, "strategy_card present on keyword_demand");
assert.equal(sc1.schema_version, "strategy-card-v1");
assert.ok(Array.isArray(sc1.judgments));
assert.ok(sc1.judgments.find((j) => j.id === "trend_keyword"));

const lintA = await ws.lintCapabilityMapAgainstPlaybook("marketing_insight");
// Phase 1 期望：unknown_capability=0 / router_integrity_violation=0
const errLints = (lintA.lints || []).filter((l) => l.level === "error");
const unknownCount = errLints.filter((l) => l.code === "unknown_capability").length;
const routerViolCount = errLints.filter((l) => l.code === "router_integrity_violation").length;
assert.equal(unknownCount, 0, "no unknown_capability on Phase 1 playbook");
assert.equal(routerViolCount, 0, "no router_integrity_violation");

// 允许有 unresolved_capability=warn（Phase 1 review_qa_pain_analysis / price_band_opportunity 占位）
console.log("[workspace] capability_map lint OK; warn lints =",
  (lintA.lints || []).filter((l) => l.level === "warn").length);

// ─────────────────────────────────────────────
// cross_node_ref 语法校验
// ─────────────────────────────────────────────
const lintB = await ws.lintCrossNodeRefs("marketing_insight");
const synErr = (lintB.lints || []).filter((l) => l.code === "cross_node_ref_syntax");
const unkNode = (lintB.lints || []).filter((l) => l.code === "cross_node_ref_unknown_node");
const unkArt  = (lintB.lints || []).filter((l) => l.code === "cross_node_ref_unknown_artifact");
assert.equal(synErr.length, 0, "cross_node_ref must parse with new DSL");
assert.equal(unkNode.length, 0, "all referenced nodes exist");
assert.equal(unkArt.length, 0, "all referenced artifacts exist on the source node");
console.log("[workspace] cross_node_ref lint OK");

// ─────────────────────────────────────────────
// resolve_instance：universal vs category 实例 hash 必须不同
// ─────────────────────────────────────────────
const r0 = await ws.resolvePlaybookForCategory("marketing_insight");           // 无 category_id
const r1 = await ws.resolvePlaybookForCategory("marketing_insight", "121364010"); // 沙发垫
const r2 = await ws.resolvePlaybookForCategory("marketing_insight", "50012345");  // 手机壳
assert.ok(r0.instance && r1.instance && r2.instance);
assert.notEqual(r0.instance.__resolution.instance_hash, r1.instance.__resolution.instance_hash,
  "universal vs 沙发垫 hash differ");
assert.notEqual(r1.instance.__resolution.instance_hash, r2.instance.__resolution.instance_hash,
  "沙发垫 vs 手机壳 hash differ");

// universal 调用应包含 category_default_universal info lint
assert.ok((r0.lints || []).find((l) => l.code === "category_default_universal"));
console.log("[workspace] resolve_instance hash differentiation OK");

// ─────────────────────────────────────────────
// output_schema 字段表非空（Phase 1 至少 keyword_demand_table 必须有）
// ─────────────────────────────────────────────
const tmpl = await ws.getArtifactTemplate("marketing_insight", "keyword_demand_table");
assert.ok(tmpl, "keyword_demand_table template loads");
assert.equal(tmpl.artifact_id, "keyword_demand_table");
assert.ok(tmpl.output_schema, "output_schema must be non-empty after Batch 2 backfill");
assert.equal(tmpl.output_schema.schema_version, "artifact-output-v1");
console.log("[workspace] artifact output_schema OK");
```

### §8.3 断言对齐 docs/22 §"Market Insight Smoke Expectations"

| docs/22 期望 | _smoke 新断言对齐 |
| --- | --- |
| `scenario_index.json` 存在 | `getScenarioIndex()` 非空 |
| `scenario_count = 1` | `idx.scenarios.length >= 1` + `marketing_insight` 命中 |
| 10 个 playbook 节点 | `sc.playbook.nodes.length === 10` |
| `schema_tags.schema_version = biz-strategy-meta-v2` | 直接 equal 校验 |

`mission_count = 1` / `客户业务专家视角 13 tags` / `经营增长目标维度 13 tags` 这三条期望在现有 adapter smoke 里已覆盖（adapter 包内 `python workspace_adapter.py validate`），spec-pack `_smoke.mjs` 不重复实施，避免双重维护。

### §8.4 失败回退策略

- 任一 assert 失败：`_smoke.mjs` 进程 exit 1，与现有断言一致。
- 失败时优先看是否：①capability_map.yaml 缺字段 ②playbook.json 节点 capability 写错 ③artifact_templates 缺 output_schema 字段。三者都属 Batch 2 编码漏项，须修代码而非弱化断言。
- AGENTS §6 golden case 要求与本 smoke 互不干扰：golden 校验 keyword 域算分；smoke 校验 workspace lint。

## §9 执行 / 验证门 / 回滚

### §9.1 Batch 2 执行顺序（与 §1.1 14 步对齐）

```text
┌────────┬──────────────────────────────────────────────┬───────────────────────┐
│ 步骤   │ 动作                                         │ 验证                  │
├────────┼──────────────────────────────────────────────┼───────────────────────┤
│ 01     │ 创建 registry/koif_capability_map.yaml       │ readYaml 解析通过     │
│ 02     │ mkdir registry/business_field_mapping/       │ 目录存在              │
│ 02a    │ git mv keyword_field_mapping.yaml → bfm/key… │ git status 干净       │
│ 02b    │ 写 4 份占位 + README.md                      │ readYaml 解析通过     │
│ 03     │ 替换 6 处加载点路径常量                      │ rg 旧路径 0 命中      │
│ 04-06  │ koif_router types/route/index 改造           │ tsc 0 error           │
│ 07-08  │ koif_decision types/index 改造               │ tsc 0 error           │
│ 09     │ propose_koif_strategy.ts schema 加 subject_…│ tsc 0 error           │
│ 10     │ .pi/extensions 注册同步                      │ DBA_PI_SMOKE=1 GREEN  │
│ 11     │ web/lib/workspace.mjs 新建                   │ node --check GREEN    │
│ 12     │ web/server.mjs 加 9 endpoint                 │ node --check GREEN    │
│ 13     │ web/_smoke.mjs 加 §8.2 断言块                │ node web/_smoke.mjs   │
│ 14     │ 双绿 + 真机三件套                            │ 见 §9.2               │
└────────┴──────────────────────────────────────────────┴───────────────────────┘
```

### §9.2 第 14 步双绿门（沙箱可执行）

```bash
cd /Users/yichen/Desktop/OntologyBrain/PI_AGENT/db-archaeologist-pi-spec-pack

# 1. 类型检查（仅语法）
node --check web/server.mjs
node --check web/lib/workspace.mjs
node --check web/_smoke.mjs

# 2. golden + invariants（沙箱内 OK）
npm run test:golden
npm run test:invariants

# 3. spec-pack pi smoke（typebox stub）
DBA_PI_SMOKE=1 npm run smoke:pi

# 4. web 模块离线 smoke
node web/_smoke.mjs
```

预期：4 项全 GREEN，且 `_smoke` 输出新增 5 行：

```text
[workspace] scenario_index + scenario + 10 nodes OK
[workspace] capability_map lint OK; warn lints = N
[workspace] cross_node_ref lint OK
[workspace] resolve_instance hash differentiation OK
[workspace] artifact output_schema OK
```

### §9.3 真机三件套（仅 Terminal.app）

第 03 步 keyword_field_mapping 路径迁移 + 第 04-06 步 Router 改造完成后，必须在 Terminal.app 跑以下 LIVE probe 验证：

```bash
# 投流域 keyword_field_missing 修复回归
LIVE_PROBE=true node --import ./scripts/ts_loader.mjs scripts/probe_keyword_competition_live.ts \
  --category "客厅地毯" --window last_7_days

# 需求域 mock_fixture_fallback 不破
LIVE_PROBE=true node --import ./scripts/ts_loader.mjs scripts/probe_keyword_demand_live.ts \
  --category "客厅地毯"

# 沙发垫窗口 LIVE probe（Phase 3 残余项）
LIVE_PROBE=true node --import ./scripts/ts_loader.mjs scripts/probe_keyword_competition_live.ts \
  --category "沙发垫" --window last_full_month_3m
```

任一 probe 不通：必须回退本次 mapping 路径迁移，恢复 `registry/keyword_field_mapping.yaml`。

### §9.4 回滚顺序（任一步骤失败时倒序撤销）

```text
14 → 13 → 12 → 11   web 侧：删 _smoke 新断言 + endpoint + workspace.mjs 整文件
10 → 09             extension + tool schema 退到改前
08 → 07             decision_kind 退到扁平命名
06 → 05 → 04        router 三文件退回（types CapabilityCode 收紧 + DSL 正则收紧 + index 去 switch）
03                  6 处路径常量 sed 反向替换（旧路径回归）
02b → 02a → 02      git mv 反向：bfm/keyword.yaml → keyword_field_mapping.yaml；删 bfm 目录
01                  rm registry/koif_capability_map.yaml
```

回滚到任意一步后必须立刻跑 §9.2 双绿，确认 keyword 域行为已恢复至 commit 7dfb794 等价态。

### §9.5 风险与豁免

| 风险 | 触发场景 | 豁免策略 |
| --- | --- | --- |
| keyword_field_mapping.yaml git mv 后 6 处加载点漏改 | rebuild 时 readYaml 报 ENOENT | rg 旧路径必须 0 命中再合并；CI 加 grep 守卫（Phase 2） |
| capability_map 与 playbook 不闭环 | _smoke 报 unknown_capability/router_integrity_violation | 强制 capabilities 清单包住 playbook 的全部 `runtime_request.capability` |
| cross_node_ref 全 placeholder 文件无 output_schema | lintCrossNodeRefs 收 16 条 `output_schema_absent` info | Phase 1 仅 keyword_demand_table 落 output_schema；其余 16 个保持空壳，info 级不阻塞 |
| ts_loader 在 .mjs 里 `import` `.ts` 失败 | workspace.mjs 调 yaml_lite.ts 报 unresolved | 第 11 步先 `node --import ./scripts/ts_loader.mjs -e 'import("./web/lib/workspace.mjs")'` 烟测，失败则回退到 .mjs 内手写最小 yaml parser（仅本模块用） |
| Phase 1 keyword 域真机回归失败 | LIVE probe context_mismatch / HTTP 非 200 | 立即回滚 §9.4，根因优先排查 cookie / mapping 路径 / Router 默认参数 |

### §9.6 审核门 2 通过条件

用户在审核门 2 必须确认以下 5 点全部 OK：

1. §1-§5 改前/改后伪代码与 docs/23 §6/§7/§10 决议一一对齐。
2. §6 workspace.mjs 函数清单 9 项 + 零外部依赖。
3. §7 server.mjs 新增 9 endpoint + 路由优先级与现有 `/api/keyword`、`/api/competition`、`/api/koif_routes` 不冲突。
4. §8 _smoke 新增 5 个断言块覆盖 docs/22 期望全部硬性条目。
5. §9 双绿门 + 真机三件套 + 回滚顺序可执行。

通过后 Batch 2 按 §9.1 14 步逐步落地。

---

## 附录 A：本文档与 docs/23 决议的对齐表

| docs/23 子节 | docs/24 子节 | 对齐方式 |
| --- | --- | --- |
| §3 capability_map schema | §4 全节 | 7 capability yaml 直出 |
| §4 扩展分级 SOP | §1.1 + §9.1 | 14 步顺序内置 SOP |
| §6 Router 单入口分流 | §2 全节 | switch (subject_kind) + DSL 放宽 |
| §7 Decision 命名空间 | §3 全节 | DecisionKind 命名空间化 + alias |
| §8 runtime_contract v2 | §6.4 + §7（artifact endpoint） | strategy_request 统一字段 |
| §10.2 strategy_card | §4.3 + §8 strategy_card 断言 | yaml + smoke 闭环 |
| §10.3 output_schema | §6.7（cross_node_ref） + §8 | DSL 校验 + smoke |
| §10.4 business_field_mapping | §5 全节 | 6 处加载点 + 五步 SOP |
| §10.5 playbook_template + 品类参数包 | §6.5 resolvePlaybookForCategory | hash 区分 + lint |
| §10.7 家具→数码演示 | §8.2 r1/r2 hash 断言 | 沙发垫 / 手机壳 hash 不同 |
| §10.8 前后端 Agent 角色 | §7（BFF）+ §6（lib） | endpoint 与 lib 分层 |
| §10.9 Phase 1 边界 | §6.9 + §7.6 + §9.5 | 不做清单分层归口 |