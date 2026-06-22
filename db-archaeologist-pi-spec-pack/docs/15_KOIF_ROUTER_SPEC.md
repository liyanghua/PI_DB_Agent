# KOIF Router Specification

本规范定义 KOIF Router 元工具 `propose_koif_strategy` 的契约：工具入参/出参、内部 7 步流程、router_run 产物结构、Phase 2 路由规则与 action 模板。

KOIF 全景见 [14_KOIF_NAMESPACE_OVERVIEW.md](14_KOIF_NAMESPACE_OVERVIEW.md)；框架契约见 [11_ANALYSIS_PACK_FRAMEWORK_SPEC.md](11_ANALYSIS_PACK_FRAMEWORK_SPEC.md) §12.8。

---

## 1. 定位

### 1.1 元工具层身份

KOIF Router 不属于任何 capability，不走 8-stage pipeline，与 `propose_insight_plan` 同属元工具层。两者并行存在：

| 维度 | propose_insight_plan | propose_koif_strategy |
| --- | --- | --- |
| namespace 范围 | 通用，跨 namespace | 仅 `keyword_analysis_pack` |
| 输入 | topic（自然语言洞察方向） | entity + capabilities |
| 输出 | InsightPlan 草稿（方案书） | score_vector + strategy_routes + next_actions（可执行报告） |
| 是否调 capability 三件套 | 否（仅路由） | 是（自动触发 + 聚合） |
| 产物根目录 | `registry/derived/_insight_plans/` | `registry/koif_routes/` |

### 1.2 业务交付价值

KOIF Router 把「关键词分析」从「3 个分散工具」升级为「1 个一站式经营策略入口」：

- **输入**：自然语言实体（如「桌布」/「客厅地毯」）
- **输出**：可直接执行的策略 + 行动建议（如「老品优化：在标题中强化 X / Y / Z 三个词」）

用户不再需要：手动调 `analyze_keyword_demand`、再手动调 `analyze_keyword_trend`、再自己对比两份报告。

### 1.3 Phase 演进状态

| Phase | 评分维度 | Router 规则 | Action 类型 | 状态 |
| --- | --- | --- | --- | --- |
| Phase 2 | KDS + TMS（2/8） | 3 条（old_product_optimization / trend_test / content_candidate） | 3 类（title_rewrite / content_topic / paid_test） | ✅ 完成 |
| Phase 3 | + CPS（3/8） | + 2 条（low_competition_high_demand / competition_warning） | paid_test → paid_candidate（中性化），+ sku_supply_check / defensive_long_tail / brand_guard | 进行中 |
| Phase 3.5 | + PVS（4/8） | + 付费类规则 | + 决策类输出移到 [docs/19_KOIF_DECISION_LAYER_SPEC.md](19_KOIF_DECISION_LAYER_SPEC.md) | 规划 |
| Phase 4+ | + CES / PFS / NOS / BDS | 全量 6-8 条 | 全量 6-10 类 | 规划 |

不变契约：Router 仍只输出**中性 ranking actions**，不出现具体预算金额、ROI 阈值、跑量周期等决策语；这些走 sibling namespace `koif_decision_layer`。

---

## 2. 工具契约

### 2.1 工具命名

- 工具名：`propose_koif_strategy`
- 注册位置：`.pi/extensions/db_archaeologist.extension.ts`（第 15 个工具）
- SKILL：`.pi/skills/koif-router/SKILL.md`

### 2.2 入参 schema

```yaml
input:
  entity: string                    # 必填；类目/品牌等实体自然语言（如「桌布」/「客厅地毯」）
  entity_kind?: string              # 默认 "category"
  category_id?: string              # 可选；显式传 id 跳过 S1 resolve
  capabilities?: [string]           # 默认 ["keyword_demand", "keyword_trend"]（Phase 2 范围）
  live?: boolean                    # 透传给各 capability 三件套；默认 true（按 framework default_live 约定）
  strategy?: string                 # 可选；强制覆盖 route 结果（调试用，命中后 strategy_routes 仅含此值）
  date_range?:
    start_date: string              # YYYY-MM-DD
    end_date: string
  force_refresh?: boolean           # 默认 false；true 时跳过缓存复用，强制调 capability 三件套
  top_n?: number                    # action keywords TOP N，默认 5
```

### 2.3 出参 schema

#### 2.3.1 成功响应

```yaml
output_success:
  kind: "koif_router_run"
  router_run_id: string             # <YYYYMMDDHHmm>__koif__<entity_id>__<sha8>
  entity:
    kind: string
    name: string                    # 用户原文
    id?: string
    canonical?: string              # taxonomy 命中时
  score_vector: ScoreVector         # 详见 §4
  strategy_routes:                  # 命中的策略集合（按 priority 降序）
    - strategy_id: string
      priority: number              # 1-5，1 最高
      matched_conditions: [string]  # 命中的条件描述
      reason: string                # 业务话术
  next_actions: [Action]            # 详见 §6.1
  capability_runs:                  # 各 capability 的 run_id
    keyword_demand: string
    keyword_trend: string
  router_report_path: string        # router_report.md 路径
  router_meta_path: string          # router_meta.json 路径
  available_capabilities: [string]  # 本次实际成功聚合的 capability
  warnings: [string]                # 非阻塞警告（如某 capability 降级）
```

#### 2.3.2 错误响应

```yaml
output_error:
  kind: "koif_router_error"
  error: koif_no_capabilities_available 
       | koif_score_aggregation_failed 
       | koif_route_no_match              # 仅警告，不算 error
       | koif_entity_resolve_failed
       | koif_invalid_capability
       | koif_live_disabled
  message: string                   # 业务话术
  available_capabilities: [string]
  partial_score_vector?: ScoreVector  # 即使聚合失败，已有的分数也返回
  hints: [string]                   # actionable hints
```

`koif_route_no_match` 是特殊情况：score_vector 已生成但所有路由规则都不命中。此时仍走成功路径，`strategy_routes = []`，`next_actions = []`，但 router_run 正常落盘。

---

## 3. Router 内部 7 步流程

### 3.1 流程总览

```
输入: { entity, capabilities, live, ... }
  │
  ▼
S1: resolve entity         → EntityContext
  │
  ▼
S2: invoke capabilities    → 并行调三件套，得 capability_runs[]
  │
  ▼
S3: load runs              → 读各 run 的 meta + 主产物
  │
  ▼
S4: aggregate scores       → ScoreVector
  │
  ▼
S5: route                  → strategy_routes[]
  │
  ▼
S6: generate actions       → next_actions[]
  │
  ▼
S7: write router_run       → 落盘 5 个产物文件
  │
  ▼
输出: { router_run_id, score_vector, strategy_routes, next_actions, ... }
```

### 3.2 S1: resolve entity

复用 `keyword_demand` 的 S1 resolver（基于 `registry/category_taxonomy.yaml` + 可选 `lookup_api`）。

输入：
- `entity` (用户原文)
- `entity_kind` (默认 "category")
- `category_id` (可选，跳过 resolve)

输出：
```yaml
EntityContext:
  kind: category
  id: string                        # 类目 id（taxonomy 命中或 lookup_api 解析）
  canonical: string                 # 规范名
  resolution_kind: taxonomy | lookup_api | partial_no_id
```

降级规则：
- 若 taxonomy + lookup_api 都失败 → `resolution_kind = partial_no_id`，`canonical = entity` 原文
- partial_no_id 不阻塞流程，但 router_run 在 router_report.md 顶部加 warning

### 3.3 S2: invoke capabilities

并行调用 `capabilities[]` 中的每个 capability 的 `analyze_<capability>` 三件套：

```typescript
// 伪代码
const capabilityRuns = await Promise.all(
  capabilities.map(async (cap) => {
    const reused = await tryReuseCachedRun({
      namespace: "keyword_analysis_pack",
      capability: cap,
      entity: ctx.canonical,
      strategy: undefined,            // 让 capability 用自己的 default_strategy
      date_range,
      max_age_hours: 24
    });
    
    if (reused && !force_refresh) {
      return { capability: cap, run_id: reused.run_id, reused: true };
    }
    
    const run = await invokeCapability({
      tool: `analyze_${cap}`,
      args: { entity: ctx.canonical, live, date_range }
    });
    return { capability: cap, run_id: run.run_id, reused: false };
  })
);
```

#### 3.3.1 缓存复用规则

`tryReuseCachedRun` 查询条件：
- 同 `namespace + capability`
- 同 `entity.canonical`
- 同 `strategy`（若入参未传，按 capability 的 `default_strategy` 比对）
- 同 `date_range`（按 start_date + end_date 字符串完全匹配）
- `started_at` 在 `now - max_age_hours` 之后
- `run.meta.json` 不在 `_diag/` 目录下（即非失败 run）

命中多个时取最新一条（按 `started_at` 降序）。

#### 3.3.2 失败处理

- 任一 capability 三件套抛错 → 该 capability 标记为 `failed`，进入 S3 时跳过
- 所有 capability 都失败 → `koif_no_capabilities_available` 错误
- 至少 1 个 capability 成功 → 继续走 S3-S7，warnings 记录失败项

### 3.4 S3: load runs

从每个成功 capability 的 RunEnvelope 读取产物：

```typescript
for (const { capability, run_id } of capabilityRuns) {
  const runDir = `registry/derived/keyword_analysis_pack/${capability}/${run_id}`;
  const meta = readJson(`${runDir}/run.meta.json`);
  
  if (capability === "keyword_demand") {
    runData[capability] = {
      meta,
      scores: readJson(`${runDir}/keyword_scores.json`),
      top: readJson(`${runDir}/keyword_top.json`)
    };
  }
  
  if (capability === "keyword_trend") {
    runData[capability] = {
      meta,
      trend: readJson(`${runDir}/trend_result.json`)
    };
  }
}
```

#### 3.4.1 文件命名兼容

考虑到 keyword_demand 处于 hybrid 期（详见 12 号 §1.3），Router 按以下顺序尝试：

| capability | 优先文件名 | 兼容文件名 |
| --- | --- | --- |
| keyword_demand | `keyword_scores.json` | `keyword_scores.json`（已稳定，无别名） |
| keyword_demand | `keyword_top.json` | `category_top_keywords.json`（旧名兼容） |
| keyword_trend | `trend_result.json` | `trend_result.json`（无别名） |

#### 3.4.2 缺失处理

- 某 capability 主产物缺失 → 该 capability 退出聚合，warnings 记录
- 所有 capability 主产物都缺失 → `koif_score_aggregation_failed`

### 3.5 S4: aggregate scores

按 `score_domain` 装配 score_vector：

```typescript
const scoreVector: ScoreVector = {
  keyword: ctx.canonical,
  category: ctx.canonical,
  category_id: ctx.id,
  scores: {},
  score_explanation: {},
  available_scores: [],
  aggregated_at: new Date().toISOString(),
  router_run_id
};

// keyword_demand → KDS
if (runData.keyword_demand) {
  const top20 = runData.keyword_demand.top.top_overall.slice(0, 20);
  const kdsValues = top20.map(k => 
    runData.keyword_demand.scores.records.find(r => r.keyword === k)?.kds
  ).filter(v => v != null);
  
  if (kdsValues.length > 0) {
    scoreVector.scores.kds = mean(kdsValues);
    scoreVector.score_explanation.demand = 
      `基于 TOP ${kdsValues.length} 词，KDS 均值 ${scoreVector.scores.kds.toFixed(1)}`;
    scoreVector.available_scores.push("kds");
  }
}

// keyword_trend → TMS
if (runData.keyword_trend) {
  const risingTms = runData.keyword_trend.trend.rising
    .map(r => r.tms)
    .filter(v => v != null);
  
  if (risingTms.length > 0) {
    scoreVector.scores.tms = mean(risingTms);
    const momAvg = mean(runData.keyword_trend.trend.rising.map(r => r.metrics.mom).filter(Boolean));
    scoreVector.score_explanation.trend = 
      `基于 ${risingTms.length} 个上升词，月环比均值 ${(momAvg * 100).toFixed(1)}%`;
    scoreVector.available_scores.push("tms");
  }
}

// keyword_competition → CPS（Phase 3 新增）
if (runData.keyword_competition) {
  const top20 = runData.keyword_competition.top.top_overall.slice(0, 20);
  const cpsValues = top20.map(k =>
    runData.keyword_competition.scores.records.find(r => r.keyword === k)?.cps
  ).filter(v => v != null);

  if (cpsValues.length > 0) {
    scoreVector.scores.cps = mean(cpsValues);
    scoreVector.score_explanation.competition =
      `基于 TOP ${cpsValues.length} 词，CPS 均值 ${scoreVector.scores.cps.toFixed(1)}（数值越高竞争越激烈）`;
    scoreVector.available_scores.push("cps");
  } else {
    // CPS 部分聚合：record 全在但 cps 字段缺失
    warnings.push("koif_cps_aggregation_partial");
  }
}
```

Phase 3.5+ 按相同模式扩展 PVS / CES / PFS / NOS / BDS。

### 3.6 S5: route

按 `registry/koif_route_rules.yaml` 推导 strategy_routes。

```typescript
const rules = loadYaml("registry/koif_route_rules.yaml");
const strategyRoutes: StrategyRoute[] = [];

for (const [strategyId, rule] of Object.entries(rules)) {
  const matchedConditions: string[] = [];
  let allMatch = true;
  
  for (const condition of rule.conditions) {
    const matches = evalCondition(condition, scoreVector);
    if (matches) {
      matchedConditions.push(formatCondition(condition));
    } else {
      allMatch = false;
      break;
    }
  }
  
  if (allMatch) {
    strategyRoutes.push({
      strategy_id: strategyId,
      priority: rule.priority || 3,
      matched_conditions: matchedConditions,
      reason: renderReason(rule.reason_template, scoreVector)
    });
  }
}

// 按 priority 升序（1 最高）
strategyRoutes.sort((a, b) => a.priority - b.priority);
```

#### 3.6.1 条件求值

支持的条件操作符：
- `kds >= 70`
- `tms >= 75`
- `kds >= 60 && tms >= 70`
- `available_scores includes "kds"`

不支持嵌套表达式 / 函数调用，仅支持 `<score> <op> <number>` 与 `&&` 连接。

#### 3.6.2 强制覆盖

若入参 `strategy` 非空：
- `strategy_routes = [{ strategy_id: <input.strategy>, priority: 1, matched_conditions: ["forced_by_input"], reason: "用户显式指定" }]`
- 跳过 koif_route_rules.yaml 求值

#### 3.6.3 无命中

若所有规则都不命中且未传 `strategy`：
- `strategy_routes = []`
- warning：`koif_route_no_match`
- next_actions = []
- router_report.md 输出「暂无明确策略方向，建议等待更多评分能力（PVS/CES/...）落地后重跑」
- router_run 仍正常落盘（不算 error）

### 3.7 S6: generate actions

按 `registry/koif_action_templates.yaml` 渲染 next_actions。

```typescript
const templates = loadYaml("registry/koif_action_templates.yaml");
const nextActions: Action[] = [];

for (const route of strategyRoutes) {
  const actionTypesForRoute = rules[route.strategy_id].actions || [];
  
  for (const actionType of actionTypesForRoute) {
    const template = templates[actionType];
    if (!template) continue;
    
    const keywords = pickKeywords(actionType, scoreVector, runData, top_n);
    if (keywords.length === 0) continue;
    
    nextActions.push({
      action: actionType,
      keywords,
      reason: renderTemplate(template.reason_template, { keywords, scoreVector }),
      template_id: template.template_id,
      priority: route.priority,
      estimated_effort: template.estimated_effort || "medium"
    });
  }
}

// 去重（同 action 类型只保留 priority 最高的一条）
const dedupedActions = dedupeByActionType(nextActions);
```

#### 3.7.1 keyword 筛选逻辑（详见 §6.2）

各 action 类型有不同的 keyword 筛选规则：
- `title_rewrite`：取 KDS TOP N（仅看 keyword_demand）
- `content_topic`：取 TMS rising TOP N（仅看 keyword_trend）
- `paid_candidate`：取 KDS ≥ 80 & TMS ≥ 60（Phase 3 起且 CPS 可用时再叠加 CPS ≤ 60）交集 TOP N
- `sku_supply_check`：取 `kds >= 70 && cps <= 50` 交集 TOP N（Phase 3）
- `defensive_long_tail` / `brand_guard`：高 CPS 场景下从 keyword_competition 取竞争压力 TOP N（Phase 3）

### 3.8 S7: write router_run

落盘到 `registry/koif_routes/<router_run_id>/`：

```
registry/koif_routes/
  <router_run_id>/
    router_meta.json
    score_vector.json
    strategy_routes.json
    next_actions.json
    router_report.md
```

详见 §4。

---

## 4. router_run 产物结构

### 4.1 router_run_id 命名

```
<YYYYMMDDHHmm>__koif__<entity_id>__<sha8>
```

- `YYYYMMDDHHmm`：本地时区，router 启动时刻
- `koif`：固定字面量，标识元工具来源
- `entity_id`：S1 resolve 的 id；partial 时用 `partial`
- `sha8`：`config_hash` 前 8 位（SHA-256）

`config_hash` 覆盖：
- `capabilities[]`（按字典序排序后 join）
- 各 capability 的 `run_id`
- `koif_route_rules.yaml` 内容哈希
- `koif_action_templates.yaml` 内容哈希
- `entity.canonical + entity.id`
- `date_range`

示例：`202611201430__koif__cat_12345__a3f5b8e1`

### 4.2 router_meta.json

```yaml
router_run_id: string
namespace: "keyword_analysis_pack"
router_version: string              # "v1.0-kds-tms"（Phase 2）
entity:
  kind: string
  name: string                      # 用户原文
  id?: string
  canonical?: string
  resolution_kind: string
capabilities: [string]              # 本次触发的 capability 列表
capability_runs:                    # 各 capability 的 run_id
  keyword_demand: string
  keyword_trend: string
capability_reused:                  # 是否走了缓存
  keyword_demand: boolean
  keyword_trend: boolean
live_probe: boolean
date_range:
  start_date: string
  end_date: string
started_at: string                  # ISO 8601
ended_at: string
elapsed_ms: number
config_hash: string                 # SHA-256 完整
route_rules_version: string         # koif_route_rules.yaml 的 SHA-256 短哈希
action_templates_version: string
warnings: [string]
available_capabilities: [string]
```

### 4.3 score_vector.json

`ScoreVector` 完整对象，详见 [14 号 §3.1](14_KOIF_NAMESPACE_OVERVIEW.md#31-数据结构)。

### 4.4 strategy_routes.json

```yaml
strategy_routes:
  - strategy_id: string
    priority: number
    matched_conditions: [string]
    reason: string
    actions: [string]               # 该策略关联的 action 类型列表
```

按 `priority` 升序。

### 4.5 next_actions.json

```yaml
next_actions:
  - action: string                  # title_rewrite / content_topic / paid_test
    template_id: string
    priority: number
    keywords: [string]              # 关联的关键词 TOP N
    reason: string                  # 业务话术
    estimated_effort: low | medium | high
    related_strategies: [string]    # 关联的 strategy_id 列表
```

按 `priority` 升序。

### 4.6 router_report.md

业务报告（纯中文，零工程术语），结构：

```markdown
# <实体名> 关键词经营策略报告

> 数据时间：<date_range>  
> 报告生成：<aggregated_at>

## 一、综合评估

<entity> 当前在 KOIF 评分体系中的表现：

| 评分维度 | 得分 | 说明 |
| --- | --- | --- |
| 需求强度 (KDS) | 78.5 | 基于 TOP 20 词，KDS 均值 78.5 |
| 趋势强度 (TMS) | 82.1 | 基于 12 个上升词，月环比均值 +28.3% |
| 付费价值 (PVS) | 暂无 | Phase 3 落地后补充 |
| 内容潜力 (CES) | 暂无 | Phase 4 落地后补充 |
| ...（其余 4 维度） |

## 二、推荐经营策略

根据当前评分，命中以下策略：

### 1. 老品优化（高优先级）
匹配条件：需求强度 ≥ 70  
建议：<reason 字段>

### 2. 趋势测试
匹配条件：趋势强度 ≥ 75 且需求强度 ≥ 60  
建议：<reason>

## 三、行动建议

### 1. 标题优化（title_rewrite）
**核心词**：A、B、C、D、E  
**话术**：建议在标题中强化 A、B、C 等关键词的覆盖，提升搜索承接

### 2. 内容选题（content_topic）
**核心词**：X、Y、Z  
**话术**：可围绕 X、Y、Z 制作内容话题，把握趋势窗口期（月环比 +28%）

### 3. 付费测试（paid_test）
（若条件不满足，本节标 「暂不建议付费投放，等待评分提升」）

## 四、数据来源

- 需求强度：来自 keyword_demand 分析包 (run_id: <id>)
- 趋势强度：来自 keyword_trend 分析包 (run_id: <id>)
- 数据日期：<date_range>
- live 模式：<是/否>

## 五、注意事项

<warnings 列表，如「某 capability 降级」>
<未实现维度的说明，如「付费价值（PVS）尚未落地，付费投流策略需 Phase 3 后评估」>
```

---

## 5. Phase 2 路由规则

### 5.1 koif_route_rules.yaml 完整定义

```yaml
# registry/koif_route_rules.yaml
# Phase 2 简化版：仅基于 KDS + TMS 的 3 条规则

old_product_optimization:
  cn_name: 老品优化
  priority: 1
  conditions:
    - kds >= 70
  actions:
    - title_rewrite
  reason_template: |
    需求强度 KDS={kds:.1f}，已超过老品优化阈值 70。
    建议优先在现有商品标题中强化高 KDS 关键词的覆盖。

trend_test:
  cn_name: 趋势测试
  priority: 2
  conditions:
    - tms >= 75
    - kds >= 60
  actions:
    - content_topic
    - paid_test
  reason_template: |
    趋势强度 TMS={tms:.1f}（≥75）且需求强度 KDS={kds:.1f}（≥60）。
    可同时启动内容种草测试与小预算付费投放。

content_candidate:
  cn_name: 内容候选
  priority: 3
  conditions:
    - kds >= 70
    - tms >= 70
  actions:
    - content_topic
  reason_template: |
    需求强度 KDS={kds:.1f} 与趋势强度 TMS={tms:.1f} 双高。
    可围绕该实体打造高质量内容种草。

# Phase 3+ 规则示例（占位，未启用）：
# paid_invest:
#   conditions: [pvs >= 70, cps <= 60]
# blue_ocean_entry:
#   conditions: [bds >= 75, nos >= 60]
```

### 5.2 规则求值优先级

- 同一 router_run 中可命中多条规则
- 输出 `strategy_routes[]` 按 `priority` 升序（1 最高）
- 不去重（即使 trend_test 与 content_candidate 都含 content_topic，actions 在 S6 阶段去重）

### 5.3 边界 case

| 情况 | 处理 |
| --- | --- |
| `kds = 70` 边界值 | 命中（条件用 `>=`） |
| `kds` 缺失 | 含 `kds` 条件的规则全部不命中 |
| 所有 score 都缺失 | 所有规则不命中，warning `koif_route_no_match` |
| 强制 `strategy=trend_test` 但 tms 缺失 | 仍输出 `trend_test`，但 reason 含降级说明 |

---

## 6. Phase 2 行动建议（3 类）

### 6.1 koif_action_templates.yaml 完整定义

```yaml
# registry/koif_action_templates.yaml
# Phase 2 三类 action：title_rewrite / content_topic / paid_test

title_rewrite:
  template_id: title_rewrite_v1
  cn_name: 标题优化
  estimated_effort: low
  keyword_picker:
    source: keyword_demand
    field: kds
    order: desc
    top_n: 5
    filter:
      min_kds: 70
  reason_template: |
    建议在商品标题中强化以下高需求关键词的覆盖：{keywords_join}。
    这些词的 KDS 均在 70 以上，搜索承接潜力较强。
    具体落地：标题前 30 字符尽量纳入 1-2 个核心词，主图卖点同步呼应。

content_topic:
  template_id: content_topic_v1
  cn_name: 内容选题
  estimated_effort: medium
  keyword_picker:
    source: keyword_trend
    field: tms
    bucket: rising
    order: desc
    top_n: 3
    filter:
      min_tms: 70
  reason_template: |
    可围绕以下趋势词制作内容种草：{keywords_join}。
    这些词处于上升通道（月环比均值 +{mom_avg:.1%}），具备阶段性流量红利。
    建议短视频/图文笔记 1-2 周内启动，把握趋势窗口期。

paid_test:
  template_id: paid_test_v1
  cn_name: 付费测试
  estimated_effort: medium
  keyword_picker:
    source: intersection                  # KDS + TMS 交集
    filters:
      min_kds: 80
      min_tms: 60
    top_n: 3
  reason_template: |
    以下关键词同时具备强需求（KDS ≥ 80）与趋势加持（TMS ≥ 60）：{keywords_join}。
    可启动小预算付费测试（建议日预算 ≤ 200 元，跑 3-5 天观察 ROI）。
    若 ROI ≥ 1.5 可逐步加大预算；< 1.0 立即停止并复盘出价/创意。

# Phase 3+ 模板示例（占位）：
# image_upgrade:
#   keyword_picker:
#     source: product_fit
#     filter: { min_pfs: 60, max_pfs: 80 }   # 中等承接，需主图升级
# category_entry:
#   keyword_picker:
#     source: new_opportunity
#     filter: { min_nos: 75 }
```

### 6.2 keyword_picker 逻辑详解

#### 6.2.1 单源筛选（title_rewrite / content_topic）

```typescript
function pickFromSingleSource(picker, runData) {
  if (picker.source === "keyword_demand") {
    const records = runData.keyword_demand.scores.records;
    return records
      .filter(r => r.kds >= picker.filter.min_kds)
      .sort((a, b) => b.kds - a.kds)
      .slice(0, picker.top_n)
      .map(r => r.keyword);
  }
  
  if (picker.source === "keyword_trend") {
    const records = runData.keyword_trend.trend[picker.bucket];  // rising
    return records
      .filter(r => r.tms != null && r.tms >= picker.filter.min_tms)
      .sort((a, b) => b.tms - a.tms)
      .slice(0, picker.top_n)
      .map(r => r.keyword);
  }
}
```

#### 6.2.2 交集筛选（paid_test）

```typescript
function pickFromIntersection(picker, runData) {
  const kdsMap = new Map(
    runData.keyword_demand.scores.records.map(r => [r.keyword, r.kds])
  );
  const tmsMap = new Map(
    runData.keyword_trend.trend.rising.map(r => [r.keyword, r.tms])
  );
  
  const intersection: { keyword: string; kds: number; tms: number }[] = [];
  for (const [keyword, kds] of kdsMap) {
    const tms = tmsMap.get(keyword);
    if (tms != null && kds >= picker.filters.min_kds && tms >= picker.filters.min_tms) {
      intersection.push({ keyword, kds, tms });
    }
  }
  
  // 按 KDS + TMS 综合得分排序
  return intersection
    .sort((a, b) => (b.kds + b.tms) - (a.kds + a.tms))
    .slice(0, picker.top_n)
    .map(x => x.keyword);
}
```

#### 6.2.3 空 keyword 处理

若 keyword_picker 返回空数组：
- 该 action 不进入 next_actions
- warnings 记录 `action_<type>_no_keywords`
- router_report.md 在对应 action 章节标「暂无符合条件的关键词」

### 6.3 模板渲染变量

`reason_template` 支持以下占位符：
- `{kds}` / `{tms}` / `{pvs}` / ...：score_vector.scores 各值
- `{kds:.1f}`：保留 1 位小数
- `{keywords_join}`：keyword 列表用「、」连接
- `{mom_avg:.1%}`：百分比格式
- `{entity_name}`：用户原文
- `{entity_canonical}`：规范名

不支持条件分支 / 循环；复杂逻辑放到 keyword_picker 阶段处理。

---

## 7. web 路由

```
POST /api/koif_routes/propose           # 调用 propose_koif_strategy
GET  /api/koif_routes/runs              # 列出 router_run（分页 + filter）
GET  /api/koif_routes/run/:id           # 读取单个 router_run 完整产物
GET  /api/koif_routes/run/:id/report    # 下载 router_report.md
GET  /api/koif_routes/run/:id/score-vector   # 仅 score_vector.json
GET  /api/koif_routes/run/:id/actions   # 仅 next_actions.json
```

`/api/koif_routes/runs` 查询参数：

```yaml
?entity=string          # 按 entity.canonical 过滤
?strategy=string        # 按 strategy_routes[].strategy_id 过滤
?from=YYYY-MM-DD        # started_at 起始
?to=YYYY-MM-DD          # started_at 结束
?limit=number           # 默认 20
?offset=number          # 默认 0
```

不复用 `/api/packs/:namespace/:capability/` 前缀；router_run 在前端 Inspector 单独 tab 展示。

---

## 8. SKILL 触发

`.pi/skills/koif-router/SKILL.md` 关键内容：

### 8.1 触发词

- 「关键词经营机会」
- 「关键词综合分析」
- 「怎么做关键词」
- 「关键词策略建议」
- 「<品类> 该怎么投/做」

### 8.2 默认行为话术

```markdown
# KOIF Router Skill

当用户询问「某品类该怎么做关键词」或「<entity> 的经营机会」时：

1. 默认调用 `propose_koif_strategy`，传入用户提到的实体
2. 使用 Phase 2 默认 capabilities = ["keyword_demand", "keyword_trend"]
3. 不需要让用户分别选择 capability，自动并行触发
4. 输出策略 + 行动建议时，按业务报告格式展示（避免使用 KDS/TMS 等技术词，改用「需求强度」「趋势强度」等业务术语）

## 与单 capability 工具的区分

- 用户问「某词的搜索量趋势」→ 调 `analyze_keyword_trend`
- 用户问「某品类的需求 TOP 关键词」→ 调 `analyze_keyword_demand`  
- 用户问「某品类该怎么做」/「经营机会」→ 调 `propose_koif_strategy`

## live 默认值

- 默认 `live=true`（按 framework 约定）
- 沙箱无 LIVE_PROBE 时返 `koif_live_disabled`，提示用户在真机重试
```

### 8.3 错误模式回流

| 错误码 | SKILL 回话 |
| --- | --- |
| `koif_no_capabilities_available` | 「当前 KOIF 评分能力暂时不可用，请稍后再试或检查 LIVE_PROBE 配置」 |
| `koif_score_aggregation_failed` | 「评分聚合失败，可能数据源出现问题。已生成部分诊断信息」 |
| `koif_route_no_match` | 「当前评分未触发明确策略，建议补充更多评分能力（PVS/CES 等）后重跑」 |
| `koif_entity_resolve_failed` | 「未能识别『<entity>』的标准类目，已按原文继续分析。如需精准匹配请提供类目 id」 |
| `koif_live_disabled` | 「真实数据查询当前未开启，请在真机环境（LIVE_PROBE=true）下重试」 |

---

## 9. golden case

### 9.1 fixture 模式 baseline

`registry/golden/koif_router_kds_tms_baseline.yaml`：

```yaml
test_id: koif_router_kds_tms_baseline
description: KOIF Router 在 fixture 模式下产出 KDS+TMS 聚合策略
input:
  tool: propose_koif_strategy
  args:
    entity: 入户地垫
    capabilities: [keyword_demand, keyword_trend]
    live: false
    date_range:
      start_date: "2026-09-15"
      end_date: "2026-09-21"
expected:
  kind: koif_router_run
  router_run_id_pattern: ^\d{12}__koif__(cat_\d+|partial)__[a-f0-9]{8}$
  score_vector:
    available_scores_includes: [kds, tms]
    scores:
      kds: { range: [60, 90] }
      tms: { range: [50, 95] }
  strategy_routes:
    min_count: 1
    must_include_one_of: [old_product_optimization, trend_test, content_candidate]
  next_actions:
    min_count: 1
    must_include_one_of: [title_rewrite, content_topic]
```

### 9.2 真机 LIVE 验证

```bash
LIVE_PROBE=true PI_CODING_AGENT_DIR="$(pwd)/.pi-home/agent" \
  pi --model aicodemirror/gpt-5.5

> 帮我看下"桌布"这个词的关键词经营机会
```

预期：
- 命中 `propose_koif_strategy`
- 自动调 `analyze_keyword_demand` + `analyze_keyword_trend`
- 输出 KDS + TMS 聚合分数
- 输出至少 1 条 strategy_routes
- 输出至少 1 条 next_actions（含具体 keyword 列表）

---

## 10. 错误模式

### 10.1 错误码总表

| 错误码 | 触发条件 | 是否阻塞 | 行为 |
| --- | --- | --- | --- |
| `koif_no_capabilities_available` | 所有请求 capability 都失败/不可用 | 是 | 返回 error + available_capabilities |
| `koif_score_aggregation_failed` | 至少 1 个 capability 主产物缺失或格式不兼容 | 视情况 | 部分聚合时退化为 partial_score_vector |
| `koif_cps_aggregation_partial` | CPS records 存在但 cps 字段缺失（Phase 3+） | 否 | warnings 记录，不阻塞其他分数聚合 |
| `koif_route_no_match` | 所有规则都不命中 | 否 | 仍输出 router_run，strategy_routes/next_actions 为空 |
| `koif_entity_resolve_failed` | S1 resolve 完全失败 | 否 | 降级 partial_no_id 继续 |
| `koif_invalid_capability` | capabilities[] 含非 KOIF capability（如「keyword_blue_ocean」） | 是 | 返回 error + available_capabilities |
| `koif_live_disabled` | live=true 但环境无 LIVE_PROBE | 是 | 返回 error + hints |

### 10.2 部分聚合行为

若仅 1 个 capability 成功（另 1 个失败）：
- score_vector 仅含成功的那个分数
- 路由规则中需要缺失分数的规则全部不命中
- 仍可命中部分规则（如仅 KDS 时可命中 `old_product_optimization`）
- warnings 含 `capability_<name>_failed_<reason>`

---

## 11. 与现有元工具的关系

### 11.1 与 propose_insight_plan

并行存在，互不调用：

```
用户 → propose_insight_plan(topic="关键词机会")
     → 输出 InsightPlan，推荐调 keyword_demand + keyword_trend
     → （用户/LLM 进一步决策）→ 调 propose_koif_strategy
                              或 → 分别调单 capability 三件套
```

未来可能的融合（Phase N+2）：
- `propose_insight_plan` 在识别到「关键词经营」topic 时直接路由到 `propose_koif_strategy`
- 现阶段保持两条路径独立，避免提前耦合

### 11.2 不是 capability

KOIF Router 不申请 capability 身份的原因：
- 不消费上游 API（不走 S1-S8 stage pipeline）
- 输入不是单一 entity + 字段映射，而是「跨 capability 聚合配置」
- 输出不是 RunEnvelope，而是跨 capability 的策略包

强行作为 capability 会破坏 framework 的「capability = 单源数据 → 单业务公式」假设。

---

## 12. Phase 3+ 演进路径

### 12.1 增量 capability

每增加一个 KOIF 评分 capability：
1. 该 capability manifest 加 `score_domain` + `koif_aggregatable: true`
2. Router S3 增 1 个 `loadRunData` 分支
3. Router S4 增 1 段聚合逻辑
4. `koif_route_rules.yaml` 增使用该分数的规则
5. `koif_action_templates.yaml` 增使用该分数的 action 模板
6. 不需要改 Router 工具契约（入参 capabilities 自动支持）

### 12.2 高级路由

Phase 6+ 引入：
- 跨 entity 对比：`propose_koif_strategy({ entities: ["地垫", "桌布"] })`
- 时序变化：`propose_koif_strategy({ entity, time_range: "last_4_weeks", weekly: true })`
- A/B 验证：`propose_koif_strategy({ entity, ab_strategies: ["s1", "s2"] })`

### 12.3 LLM 精排

Phase 4+ 在 S6 之后增 S6.5：
- 把 next_actions 草稿 + 相关 capability run 摘要传给 LLM
- LLM 输出更丰富的话术与 case study
- 仅 LLM 可控输出格式时启用，否则保持 template-based

---

## 13. 不在本规范范围

- KOIF 公式细节（KDS/TMS/PVS/... 的子分数计算）：在各 capability spec 中维护
- KOIF Router 的 web Inspector UI 设计：留 Phase 3
- Router 与 `propose_insight_plan` 的融合：留 Phase N+2
- 跨 entity 对比 / 时序追踪 / A/B 验证：Phase 6+
- 真实凭据 vault：仍走 `.env` + `ZICHEN_*`
- KOIF report 的 LLM 精排：Phase 4+ 探索

---

## 14. Action 改名历史（rename history）

KOIF Router 的 action 命名在 Phase 演进中存在以下历史变更，为保持回溯可读性记录于此：

| 旧名（Phase 2） | 新名（Phase 3+） | 改名原因 |
| --- | --- | --- |
| `paid_test` | `paid_candidate` | Phase 3 起，KOIF Router 边界限定为「中性 ranking actions」，不出现具体预算/出价/ROI 决策语；带预算的「付费投放测款方案」整体下沉到 sibling namespace `koif_decision_layer`，对应 decision_kind=`paid_test_plan`。详见 [AGENTS.md](../AGENTS.md) §1.1 与 [docs/19_KOIF_DECISION_LAYER_SPEC.md](19_KOIF_DECISION_LAYER_SPEC.md) §1。 |

> 注意：`paid_test_plan` 是 decision_layer 的 decision_kind 枚举值，不是 router action；不要把它和上表的 router action 改名混淆。

历史文档（docs/11/12/13/15/17 中 Phase 2 段落、docs/keyword_operating_intelligence_framework_koif.md 等）中保留的 `paid_test` 字样属于历史演进时间线，按规范不再改动；新写的代码/产物/规则/模板必须使用 `paid_candidate`。
