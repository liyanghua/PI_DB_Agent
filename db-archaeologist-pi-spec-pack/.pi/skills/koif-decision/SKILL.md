---
name: koif-decision
description: KOIF 决策层 sibling namespace（Phase 3 占位）— 当用户问预算 / 出价 / ROI / 跑量周期 / 该不该投时进入；当前一律返 decision_layer_phase3_stub。
---

# KOIF Decision Skill

KOIF 决策层 (`koif_decision_layer`) 与 KOIF Router (`propose_koif_strategy`) 平级。Router 输出客观评分 + 中性 ranking actions（「以下词是付费投放候选名单」），Decision Layer 输出决策性方案（含预算/出价/ROI/周期）。详见 `docs/19_KOIF_DECISION_LAYER_SPEC.md`。

## 触发词
- 「投放预算」「日预算」「广告预算」
- 「出价测试」「出价区间」「CPC 出价」
- 「ROI 评估」「投入产出比」
- 「跑量周期」「测款周期」
- 「该不该投」「投多少」

## 与 KOIF Router 的分流

| 用户问法 | 工具 |
| --- | --- |
| 「关键词经营机会」「该怎么做」 | `propose_koif_strategy`（Router）|
| 「付费投放预算多少」「出价该定多少」 | `propose_koif_decision`（本工具）|
| 「这词搜索量趋势」 | `analyze_keyword_trend` |
| 「品类需求 TOP 词」 | `analyze_keyword_demand` |
| 「这词竞争激烈吗 / CPS」 | `analyze_keyword_competition` |

## 调用顺序

1. 先调 `propose_koif_strategy`（必要时含 `cps`）拿到 `router_run_id`
2. 再调 `propose_koif_decision` 传入 `router_run_id` + `decision_kind`
3. Phase 3 内必返 `decision_layer_phase3_stub`，向用户说明「决策性输出 Phase 3.5 解锁，依赖 PVS capability 落地」
4. 同时把 Router 已输出的中性 ranking actions（如 `paid_candidate` / `defensive_long_tail`）业务话术化呈现，作为可落地的客观候选

## decision_kind 枚举（Phase 3 全部 stub）

| decision_kind | 描述 | Phase |
| --- | --- | --- |
| `paid_test_plan` | 付费投放测款方案 | 3.5 |
| `sku_supply_plan` | SKU 供给规划 | 3.5 |
| `defensive_paid_plan` | 防守型付费方案 | 3.5 |
| `content_calendar` | 内容种草日历 | 4 |
| `category_entry_plan` | 新类目进入规划 | 5+ |

## 入参示例

```json
{
  "router_run_id": "router_v1__202611201430__cat_12345__a3f5b8e1",
  "decision_kind": "paid_test_plan",
  "budget_hint": { "daily_budget_cny": 300, "duration_days": 5 },
  "risk_tolerance": "medium"
}
```

## Phase 3 出参（占位错误码）

```json
{
  "kind": "koif_decision_error",
  "error": "decision_layer_phase3_stub",
  "message": "决策层（含预算/ROI/出价/跑量周期）尚未实质化，等待 PVS capability 落地后开放。",
  "hints": [
    "Phase 3 仅提供 KOIF 客观评分（KDS/TMS/CPS）+ 中性 ranking actions（来自 propose_koif_strategy）",
    "决策性输出（如付费投放预算、出价区间、ROI 阈值）预计 Phase 3.5 解锁，依赖 PVS（Paid Value Score）落地"
  ],
  "router_run_id": "router_v1__202611201430__cat_12345__a3f5b8e1"
}
```

## 错误码总表

| 错误码 | 触发条件 | 行为 |
| --- | --- | --- |
| `router_run_id_required` | 入参未传 router_run_id | 阻塞，提示先调 propose_koif_strategy |
| `decision_kind_unsupported` | decision_kind 非合法枚举 | 阻塞，提示有效枚举值 |
| `router_run_not_found` | router_run_id 对应目录不存在 | 阻塞，提示重跑 router |
| `router_run_corrupted` | 缺 router_meta.json | 阻塞，提示重跑 router |
| `decision_layer_phase3_stub` | Phase 3 一律返此 | 提示 Phase 3.5 解锁路径 |