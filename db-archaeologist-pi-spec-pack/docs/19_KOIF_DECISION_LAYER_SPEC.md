# 19. KOIF Decision Layer 规范

本规范定义 KOIF Decision Layer sibling namespace 的契约：与 KOIF Router（spec-pack）的边界、元工具 `propose_koif_decision` 的入参出参 schema、产物根目录约定、以及 Phase 3 占位实现。

KOIF 全景见 [14_KOIF_NAMESPACE_OVERVIEW.md](14_KOIF_NAMESPACE_OVERVIEW.md)；Router 契约见 [15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md)；项目边界条款见 [AGENTS.md](../AGENTS.md) §1。

---

## 1. 定位

### 1.1 namespace 拆分逻辑

KOIF 评分体系（KDS/TMS/CPS/PVS/CES/PFS/NOS/BDS）属于客观评分能力，留在 spec-pack；带预算/ROI/出价/进退场建议的决策性输出拆出来，走独立 sibling namespace `koif_decision_layer`。

| 维度 | spec-pack（KOIF Router） | sibling（Decision Layer） |
| --- | --- | --- |
| 输出类型 | 客观评分 + 中性 ranking actions | 决策性方案（含预算/ROI/出价/跑量周期） |
| 话术风格 | 「以下关键词可作为付费投放候选名单」 | 「日预算 200 元，跑 5 天观察 ROI ≥ 1.5」 |
| 数据消费 | 直接调 capability 三件套 | 只读 router_run 产物 |
| 是否反写 capability | 否（只聚合不反写） | 否（只读 router_run 不反写 score） |
| 物理位置 | `src/services/koif_router/` | `src/services/koif_decision/` |
| 注册点 | `.pi/extensions/db_archaeologist.extension.ts`（第 15 个工具） | 同上（第 18 个工具） |

### 1.2 拆分理由

- **可维护性**：Router 公式与 ranking 是稳定契约，决策算法（预算曲线/出价模型）会随业务/数据/算法迭代频繁变化。
- **职责单一**：spec-pack 是「数据考古 + 评分」，决策层是「业务规划」，混在一起会让 archaeology 边界失控。
- **测试粒度**：Router golden case 断言数值与策略命中；决策层 golden case 断言决策合理性，两者评测口径不同。
- **演进节奏**：Router 在 Phase 2 已稳定；决策层在 Phase 3 仅搭骨架，Phase 3.5 PVS 落地后才实质化。

### 1.3 与 propose_insight_plan 的关系

三者并行，互不调用：

```
propose_insight_plan       —— 通用洞察方案路由（topic → 推荐 capability）
propose_koif_strategy      —— KOIF 评分聚合 + 中性 ranking
propose_koif_decision      —— 决策性输出（含预算/出价/ROI）
```

Phase 3+ 可能融合（LLM 在「关键词经营」topic 下自动串联三者），现阶段保持独立。

---

## 2. 元工具契约

### 2.1 工具命名

- 工具名：`propose_koif_decision`
- 注册位置：`.pi/extensions/db_archaeologist.extension.ts`（第 18 个工具）
- SKILL：`.pi/skills/koif-decision/SKILL.md`

### 2.2 入参 schema

```yaml
input:
  router_run_id: string             # 必填；上游 router_run 的 id
  decision_kind: string             # 必填；枚举见 §2.4
  budget_hint?:                     # 可选；预算偏好（Phase 3.5+ 实质化）
    daily_budget_cny?: number       # 日预算上限（人民币）
    duration_days?: number          # 投放周期
  risk_tolerance?: string           # 可选；low | medium | high（默认 medium）
  notes?: string                    # 可选；用户附加上下文（如「双 11 前测款」）
```

### 2.3 出参 schema

#### 2.3.1 成功响应（Phase 3.5+）

```yaml
output_success:
  kind: "koif_decision_run"
  decision_run_id: string           # <YYYYMMDDHHmm>__decision__<router_run_id>__<sha8>
  router_run_id: string             # 上游引用
  decision_kind: string
  decision_plan:
    kind: string                    # 与入参 decision_kind 一致
    actions:                        # 决策行动列表
      - action_kind: string         # paid_test_plan / sku_supply_plan / content_calendar
        keywords: [string]
        budget_cny?: number
        duration_days?: number
        bid_range?: [number, number]
        kpi_targets:
          roi_min?: number
          ctr_min?: number
        rationale: string           # 决策依据（业务话术）
  risk_notes: [string]              # 风险提示（如「类目竞争激烈，建议先小预算测试」）
  assumption_log: [string]          # 决策假设（如「假设 ROI 阈值 1.5 适用于该品类」）
  decision_report_path: string      # decision_report.md
  decision_meta_path: string        # decision_meta.json
  warnings: [string]
```

#### 2.3.2 错误响应

```yaml
output_error:
  kind: "koif_decision_error"
  error: decision_layer_phase3_stub      # Phase 3 唯一错误码（占位）
       | router_run_not_found            # router_run_id 不存在
       | router_run_corrupted            # router_run 产物缺失/不完整
       | decision_kind_unsupported       # decision_kind 枚举值非法
       | decision_kind_unavailable       # 该 decision_kind 依赖的 capability 未落地（如需 PVS）
       | decision_score_insufficient     # router_run.score_vector 评分维度不足以支撑该 decision_kind
  message: string
  hints: [string]                   # actionable hints（如「等待 PVS 落地」）
  router_run_id?: string
```

### 2.4 decision_kind 枚举

| decision_kind | 描述 | 依赖的 score 维度 | Phase |
| --- | --- | --- | --- |
| `paid_test_plan` | 付费投放测款方案（预算/出价/周期/KPI） | KDS + TMS + CPS + PVS | Phase 3.5 |
| `sku_supply_plan` | SKU 供给规划（弱竞争 + 强需求场景下的 SKU 扩充建议） | KDS + CPS | Phase 3.5 |
| `content_calendar` | 内容种草日历（趋势词上线时间表 + 内容形式建议） | TMS + CES | Phase 4 |
| `defensive_paid_plan` | 高竞争场景下的防守型付费方案（品牌词保护 + 长尾词承接） | CPS + PVS | Phase 3.5 |
| `category_entry_plan` | 新类目进入规划（蓝海词清单 + 启动节奏） | NOS + BDS | Phase 5+ |

**Phase 3 范围**：所有 `decision_kind` 均返回 `decision_layer_phase3_stub`，hints 标注预计解锁 Phase。

---

## 3. 产物根目录约定

### 3.1 物理位置

```
registry/derived/koif_decision_layer/
  <decision_run_id>/
    decision_meta.json
    decision_plan.json
    risk_notes.json
    assumption_log.json
    decision_report.md
```

**Phase 3 状态**：目录不创建（占位实现不落盘），Phase 3.5 起实质化时再创建。

### 3.2 decision_run_id 命名

```
<YYYYMMDDHHmm>__decision__<router_run_id_short>__<sha8>
```

- `YYYYMMDDHHmm`：本地时区，decision 启动时刻
- `decision`：固定字面量
- `router_run_id_short`：上游 router_run_id 的前 12 字符
- `sha8`：`config_hash` 前 8 位（SHA-256）

`config_hash` 覆盖：
- `router_run_id`
- `decision_kind`
- `budget_hint` 序列化
- `risk_tolerance`

### 3.3 decision_meta.json schema（Phase 3.5+）

```yaml
decision_run_id: string
namespace: "koif_decision_layer"
decision_version: string            # "v1.0-phase35"
router_run_id: string
router_meta_snapshot:               # router_meta.json 的关键字段快照（避免 router_run 被覆盖时失参考）
  entity: object
  score_vector_summary:
    available_scores: [string]
    scores: object                  # { kds, tms, cps, ... }
  capability_runs: object
decision_kind: string
budget_hint: object
risk_tolerance: string
started_at: string
ended_at: string
elapsed_ms: number
config_hash: string
warnings: [string]
```

---

## 4. 与 KOIF Router 的合约

### 4.1 单向依赖

```
KOIF Router (spec-pack)
       ↓ 写产物
registry/koif_routes/<router_run_id>/
       ↑ 只读
KOIF Decision Layer (sibling namespace)
       ↓ 写产物
registry/derived/koif_decision_layer/<decision_run_id>/
```

**不允许**：
- 决策层反写 `score_vector.json` / `strategy_routes.json` / `next_actions.json`
- 决策层调 capability 三件套（必须经过 router_run 中转）
- Router 调决策层（Router 只输出中性 ranking actions，不感知决策层存在）

### 4.2 router_run 读取规则

决策层启动时：
1. 解析 `router_run_id` → 定位 `registry/koif_routes/<router_run_id>/`
2. 读 `router_meta.json` + `score_vector.json` + `strategy_routes.json` + `next_actions.json`
3. 如果任一文件缺失 → 返 `router_run_corrupted`
4. 校验 `score_vector.available_scores` 是否覆盖 `decision_kind` 所需维度
5. 不足则返 `decision_score_insufficient` + hints 标明缺失维度

### 4.3 router_run 不可变性

router_run 写入后，决策层视其为只读快照。即便 router_run 之后被覆盖（不会发生，但作为契约约束）：
- 决策层应在 `decision_meta.json` 中保存 `router_meta_snapshot`，避免 router_run 漂移
- 决策层不应实时读 router_run，而是启动时一次性加载

---

## 5. Phase 3 占位实现

### 5.1 服务层骨架

```
src/services/koif_decision/
  types.ts                          # DecisionInput / DecisionOutput / DecisionPlan
  index.ts                          # 主入口，Phase 3 仅返 stub
```

`index.ts` 行为：

```typescript
// 伪代码
export async function proposeKoifDecision(input: DecisionInput): Promise<DecisionOutput> {
  // S1: 校验入参
  if (!input.router_run_id) {
    return { kind: "koif_decision_error", error: "router_run_id_required", ... };
  }
  
  if (!isValidDecisionKind(input.decision_kind)) {
    return { kind: "koif_decision_error", error: "decision_kind_unsupported", ... };
  }
  
  // S2: 读 router_run（仅校验存在性）
  const routerDir = `registry/koif_routes/${input.router_run_id}`;
  if (!existsSync(routerDir)) {
    return { kind: "koif_decision_error", error: "router_run_not_found", ... };
  }
  
  // S3: Phase 3 占位 → 直接返 stub
  return {
    kind: "koif_decision_error",
    error: "decision_layer_phase3_stub",
    message: "决策层（含预算/ROI/出价/跑量周期）尚未实质化，等待 PVS capability 落地后开放。",
    hints: [
      "Phase 3 仅提供 KOIF 客观评分（KDS/TMS/CPS）+ 中性 ranking actions（来自 propose_koif_strategy）",
      "决策性输出（如付费投放预算、出价区间、ROI 阈值）预计 Phase 3.5 解锁，依赖 PVS（Paid Value Score）落地",
      `当前 router_run_id=${input.router_run_id} 已正常生成，可作为 Phase 3.5 决策层的输入快照保留`
    ],
    router_run_id: input.router_run_id
  };
}
```

### 5.2 不落盘策略

Phase 3 不创建 `registry/derived/koif_decision_layer/` 目录，原因：
- 不实质化时落盘会污染 derived 目录
- Phase 3.5 实质化时再统一落盘格式
- 占位错误码本身即可作为契约说明

### 5.3 工具注册

`.pi/extensions/db_archaeologist.extension.ts` 第 18 个工具：

```yaml
- name: propose_koif_decision
  description: |
    KOIF 决策层元工具：基于上游 router_run 输出决策性方案（预算/出价/ROI/周期）。
    Phase 3 占位实现，所有调用返回 decision_layer_phase3_stub。
  schema:
    router_run_id: string
    decision_kind: string
    budget_hint?: object
    risk_tolerance?: string
    notes?: string
```

### 5.4 SKILL 定义

`.pi/skills/koif-decision/SKILL.md` 关键内容：

```markdown
# KOIF Decision Skill

## 触发词
- 「投放预算」「日预算」「广告预算」
- 「出价测试」「出价区间」「CPC 出价」
- 「ROI 评估」「投入产出比」
- 「跑量周期」「测款周期」
- 「该不该投」「投多少」

## 与 KOIF Router 的分流

| 用户问法 | 工具 |
| --- | --- |
| 「关键词经营机会」「该怎么做」 | propose_koif_strategy（Router）|
| 「付费投放预算多少」「出价该定多少」 | propose_koif_decision（本工具）|
| 「这词搜索量趋势」 | analyze_keyword_trend |
| 「品类需求 TOP 词」 | analyze_keyword_demand |

## Phase 3 行为

Phase 3 内本工具一律返回 `decision_layer_phase3_stub` 错误码。
触发后应：
1. 先调 propose_koif_strategy 拿到 router_run_id
2. 再调 propose_koif_decision 传入 router_run_id
3. 收到 stub 错误时，向用户说明「决策性输出 Phase 3.5 解锁」

## 入参示例

\`\`\`json
{
  "router_run_id": "202611201430__koif__cat_12345__a3f5b8e1",
  "decision_kind": "paid_test_plan",
  "budget_hint": { "daily_budget_cny": 300, "duration_days": 5 },
  "risk_tolerance": "medium"
}
\`\`\`
```

---

## 6. Phase 3.5+ 实施路径

### 6.1 解锁前置条件

| 前置 | 状态 | 说明 |
| --- | --- | --- |
| PVS capability 落地 | Phase 3.5 | `keyword_paid_value` capability + 8-stage pipeline |
| 数据底座：付费域接口 | Phase 3.5 | 调研付费域接口 → mapping 扩展 |
| router_run 接 PVS | Phase 3.5 | aggregate.ts S4 增 PVS 分支 |
| `paid_test_plan` 决策算法 | Phase 3.5 | 预算曲线 + 出价模型 + ROI 估算 |

### 6.2 决策算法骨架（Phase 3.5）

```
输入: router_run（含 KDS/TMS/CPS/PVS 4 维评分）
  + budget_hint
  + risk_tolerance
  ↓
S1: 选词 — 从 router_run.next_actions 中取 paid_candidate 的 keywords
S2: 评估 — 对每个 keyword 估算 PVS 子分数（搜索价值 / 竞争溢价 / 类目转化）
S3: 配预算 — 按 PVS 分布 + budget_hint + risk_tolerance 推预算曲线
S4: 配出价 — 基于 CPS + PVS 推 CPC 出价区间
S5: 设 KPI — 推 ROI 阈值 + CTR 阈值 + 跑量周期
S6: 风险评估 — 高竞争 / 数据稀疏 / 类目波动等风险标签
S7: 落盘 — decision_plan.json + risk_notes.json + decision_report.md
```

### 6.3 决策报告模板（Phase 3.5）

`decision_report.md` 结构：

```markdown
# <实体名> 付费投放方案

## 一、决策依据
- 评分来源：router_run <id>
- 评分维度：KDS=78 / TMS=82 / CPS=45 / PVS=68

## 二、推荐方案
| 关键词 | 日预算 | 出价区间 | ROI 目标 | 周期 |
| --- | --- | --- | --- | --- |
| ... | ... | ... | ... | ... |

## 三、风险提示
- 类目竞争中等，建议先 3 天小预算测试
- ...

## 四、决策假设
- 假设 ROI 阈值 1.5 适用于本品类
- ...
```

### 6.4 Phase 3.5 验收线

- `propose_koif_decision` 返回完整 decision_plan（不再 stub）
- decision_report.md 包含具体预算/出价数字 + 业务话术
- golden case `koif_decision_paid_test_baseline` 全 GREEN

---

## 7. 错误码总表

| 错误码 | Phase | 触发条件 | 行为 |
| --- | --- | --- | --- |
| `decision_layer_phase3_stub` | Phase 3 | 任何调用 | 返 hints 提示 Phase 3.5 解锁 |
| `router_run_not_found` | Phase 3+ | router_run_id 对应目录不存在 | 阻塞，提示用户重跑 router |
| `router_run_corrupted` | Phase 3+ | router_run 产物缺失/JSON 解析失败 | 阻塞，提示重跑 router |
| `decision_kind_unsupported` | Phase 3+ | decision_kind 不在枚举内 | 阻塞，提示有效枚举值 |
| `decision_kind_unavailable` | Phase 3.5+ | 该 decision_kind 依赖 capability 未落地 | 阻塞，提示等待 Phase |
| `decision_score_insufficient` | Phase 3.5+ | router_run.score_vector 覆盖维度不足 | 阻塞，提示补齐 capability |

---

## 8. golden case

### 8.1 Phase 3 stub case

`tests/golden_cases/koif_decision_cases.yaml`：

```yaml
test_id: koif_decision_phase3_stub
description: KOIF Decision Layer Phase 3 占位实现，必返 stub 错误码
input:
  tool: propose_koif_decision
  args:
    router_run_id: "202611201430__koif__cat_12345__a3f5b8e1"
    decision_kind: paid_test_plan
expected:
  kind: koif_decision_error
  error: decision_layer_phase3_stub
  hints_must_include_one_of:
    - "Phase 3.5"
    - "PVS"
    - "解锁"
```

### 8.2 错误码覆盖 case（Phase 3 仍可测）

```yaml
test_id: koif_decision_invalid_kind
description: 非法 decision_kind 应返 decision_kind_unsupported
input:
  args:
    router_run_id: "any_valid_format"
    decision_kind: invalid_unknown_kind
expected:
  error: decision_kind_unsupported
```

### 8.3 Phase 3.5+ baseline case（占位）

待 PVS 落地后补：
- `koif_decision_paid_test_baseline`（含 budget/出价/ROI 断言）
- `koif_decision_sku_supply_baseline`（含 SKU 扩充清单断言）

---

## 9. 不在本规范范围

- 真实决策算法（预算曲线 / 出价模型 / ROI 估算）：Phase 3.5+
- decision_report.md 的 LLM 精排：Phase 4+
- 跨 router_run 对比 / 决策版本管理：Phase 6+
- 决策层 web Inspector UI：Phase 3.5+
- 真实凭据 vault：仍走 `.env` + `ZICHEN_*`
- 决策算法的 A/B 验证：Phase 6+

---

## 10. 相关文档

- [AGENTS.md](../AGENTS.md) §1：项目定位与边界条款
- [docs/14_KOIF_NAMESPACE_OVERVIEW.md](14_KOIF_NAMESPACE_OVERVIEW.md)：KOIF 全景
- [docs/15_KOIF_ROUTER_SPEC.md](15_KOIF_ROUTER_SPEC.md)：Router 契约
- [docs/20_KEYWORD_COMPETITION_PACK_SPEC.md](20_KEYWORD_COMPETITION_PACK_SPEC.md)：CPS capability（Phase 3 落地）
- [docs/11_ANALYSIS_PACK_FRAMEWORK_SPEC.md](11_ANALYSIS_PACK_FRAMEWORK_SPEC.md)：分析包框架