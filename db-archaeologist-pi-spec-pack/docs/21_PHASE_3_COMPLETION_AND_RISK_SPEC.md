# 21. KOIF Phase 3 完成情况与风险登记规范

本规范是 KOIF Phase 3（CPS 双源重构 + 决策层拆分 + Core Lock）的收尾规范层，一句话定位：

> 沙箱可控产物已全绿；真机三件套尚未执行；带预算/ROI/出价的决策性输出已被 sibling namespace 隔离，archaeology 边界守住。

口径优先级：本文档 ↔ [docs/14](14_KOIF_NAMESPACE_OVERVIEW.md) ↔ [docs/15](15_KOIF_ROUTER_SPEC.md) ↔ [docs/18](18_KEYWORD_FIELD_MAPPING_SPEC.md) ↔ [docs/19](19_KOIF_DECISION_LAYER_SPEC.md) ↔ [docs/20](20_KEYWORD_COMPETITION_PACK_SPEC.md) 之间冲突时以条款级最近修订为准；范围、阶段、不变量、风险登记的最终口径统一回到本文档。真机执行节奏以 [docs/PHASE_3_LIVE_PROBE_SOP.md](PHASE_3_LIVE_PROBE_SOP.md) 为准。

---

## 1. 范围声明

### 1.1 已固化的边界决策

| 决策项 | 取值 | 锚定文档 |
| --- | --- | --- |
| Phase 3 主线 capability | CPS（PVS / decision_layer 实质化留 Phase 3.5） | [docs/14 §7.1](14_KOIF_NAMESPACE_OVERVIEW.md) |
| KOIF 评分 / 决策边界 | 评分留 spec-pack；带预算/ROI/出价/进退场建议拆到 sibling `koif_decision_layer` | [AGENTS.md §1.1](../AGENTS.md) / [docs/19 §1](19_KOIF_DECISION_LAYER_SPEC.md) |
| CPC 数据源 | 仅投流域 `data_cust_ads_ad_flow_plan_goods_keyword_7d.avg_cost_per_clk` | [docs/20 §3](20_KEYWORD_COMPETITION_PACK_SPEC.md) |
| competition_index 计算 | 竞争域 `data_competition_pattern_analysis` 按 `tertiary_category` 聚合：`log10(distinct_count(shop)+1) × 25` 截到 [0,100]，类目级广播到关键词 | [docs/20 §2](20_KEYWORD_COMPETITION_PACK_SPEC.md) |
| brand_concentration | 类目级 top-3 品牌按 `display_price` 加权占比，作为 competition_index 备份 | 同上 |
| 关键词清单来源 | 首选 demand pack 关键词列表；缺失时退路用投流域 `kw_name` 并集 | [docs/20 §2](20_KEYWORD_COMPETITION_PACK_SPEC.md) |
| 默认 LIVE 模式 | `default_live=true`（路径全沙箱内仍允许 fixture 兜底） | [docs/12](12_KEYWORD_DEMAND_PACK_SPEC.md) / [docs/13](13_TREND_DEMAND_PACK_SPEC.md) |
| `paid_test` action 改名 | Phase 3 起 `paid_candidate`；`paid_test_plan` 是 decision_layer 的 decision_kind 保留语义 | [docs/15 §14](15_KOIF_ROUTER_SPEC.md) |

### 1.2 不在 Phase 3 范围

- 不实施真实决策算法（`propose_koif_decision` Phase 3 仅 stub，必返 `decision_layer_phase3_stub`）。
- 不修改 `tool_registry.yaml` / `api_asset_cards.json` / `domain_mapping.locked.yaml`。
- DSL 不支持嵌套表达式 / 用户自定义函数（仅 4 + 1 op，详见 [docs/18 §3.2.2](18_KEYWORD_FIELD_MAPPING_SPEC.md)）。
- 不引入向量化关键词匹配（`kw_name` 与 demand keyword 走精确匹配）。
- 类目级广播只支持 `tertiary_category`，不支持二级 / 一级类目。
- Inspector Competition tab 的全量前端推迟到 Phase 4 装配期；Phase 3 BFF 端 3 个 endpoint 已就位，前端通过 koif_routes 卡片间接展示。
- `keyword_strategies` fallback codes 完备性未实现为独立 invariant（仅靠 golden + 文档评审兜底，详见 §3.4）。

---

## 2. Phase 3 完成范围

按 Batch 顺序登记最终产物形态、关键决策固化点、沙箱内观测值。

### 2.1 Batch 1 — CPS 主干（fixture 模式）

| 产物 | 形态 | 状态 |
| --- | --- | --- |
| [registry/cps_weights.yaml](../registry/cps_weights.yaml) + `cps_weights.baseline_v1.locked.yaml` | base_cps（0.6 / 0.4）+ 双 fallback 链 + cps_levels 三档 + solo policy | 已固化 |
| [registry/keyword_strategies.yaml](../registry/keyword_strategies.yaml) | 新增 `cps_baseline_v1`（is_baseline=true / enabled=true）+ `cps_weighted_v2_stub`（enabled=false） | 已固化 |
| [registry/keyword_analysis_packs.json](../registry/keyword_analysis_packs.json) | 增 `keyword_competition` capability 节点 | 已固化 |
| [src/services/keyword_competition/](../src/services/keyword_competition/) | types / resolve / live_pull / normalize / strategies / report / index 8-stage 主干 + 5 fallback codes | 已固化 |
| 入户地垫 fixture run | top CPS=87.7、bucket=strong | 已固化 |

### 2.2 Batch 2 — 双源数据契约 + 服务层重构

数据契约固化点：

```
aggregation_method = shop_count_based   (类目级 distinct_shop_count_log)
cpc_scope         = only_paid           (未投放词走 fallback / solo_competition_index)
aggregation_granularity = kw_name_only   (投流域聚合到 kw_name 关键词级)
```

normalize 三阶段：

```
Stage A (商品 → 类目)
  data_competition_pattern_analysis raw[]
    group by tertiary_category
      apply DSL: log10(distinct_count(shop)+1)*25 → competition_index
                 top_n_share(brand_name, n=3, weighted_by=display_price) → brand_concentration
                 distinct_count(shop) → distinct_shop_count
    → category_metrics[category]

Stage B (投流 → 关键词)
  data_cust_ads_ad_flow_plan_goods_keyword_7d raw[]
    group by kw_name
      apply DSL: weighted_avg(avg_cost_per_clk, weight=clk_cnt) → avg_cpc_cny
                 weighted_avg(cost, weight=clk_cnt) → weighted_cost_per_clk
    → keyword_metrics[keyword]

Stage C (关键词记录构造与广播)
  for keyword in keyword_universe (demand pack 列表 ∪ keyword_metrics keys):
    record.competition_index/brand_concentration ← category_metrics[当前类目]   (类目级广播)
    record.avg_cpc_cny ← keyword_metrics[keyword]?.avg_cpc_cny
    record.cpc_source ← "paid" | "missing"
```

入户地垫 fixture 实测：

| 维度 | 观测值 |
| --- | --- |
| record 数 | 13 |
| top CPS | 87.65 / strong |
| 类目级 distinct_shop_count | 8 |
| 类目级 competition_index | 23.86（同类目所有 record 一致） |
| 类目级 brand_concentration | 0.643 |
| 投流级 关键词数 | 8 |
| Stage C 广播 cpc_source | paid=8 / missing=5 |

### 2.3 Batch 2D — 工具 + Router 接通

- 新增工具 `analyze_keyword_competition`（即 18 工具中的第 17 项）+ skill `keyword-competition`。
- KOIF Router CPS 分支扩展：`types / invoke / aggregate / actions / index` 全覆盖；CPS run 元信息接入 ScoreVector。
- `_router_cps_smoke.ts` 验证 score_vector=38（CPS 13 / KDS 25 / TMS 25），bucket=medium 显示正常。
- web BFF 注入 3 个 endpoint：`/api/competition/runs` / `/api/competition/run/<id>` / `POST /api/competition/analyze`，前端 tab 留待 Phase 3.5+。

### 2.4 Batch 3 — 决策层 sibling stub

| 产物 | 形态 |
| --- | --- |
| [src/services/koif_decision/](../src/services/koif_decision/) | types + index（仅 stub）；4 错误码 `missing_score_vector` / `insufficient_capability_coverage` / `decision_strategy_not_found` / `decision_kind_unknown / unsupported` |
| [src/tools/propose_koif_decision.ts](../src/tools/propose_koif_decision.ts) | 18 工具中的第 18 项 |
| `.pi/skills/koif-decision/SKILL.md` | Phase 3 stub 说明：必返 `decision_layer_phase3_stub` + hint 引导 Phase 3.5 |
| [tests/golden_cases/koif_decision_cases.yaml](../tests/golden_cases/koif_decision_cases.yaml) | 4 case 覆盖 stub / invalid_kind / not_found / missing_id |
| [scripts/_decision_smoke.ts](../scripts/_decision_smoke.ts) | 4 错误码全通 |

### 2.5 命名收尾

- `paid_test` → `paid_candidate`：源码 / mapping / templates / route_rules 全量替换；docs/15 末尾追加 §14 rename history 锚定。
- `paid_test_plan` 作为 decision_kind 保留语义，与 router action 改名不冲突。
- 历史文档（docs/11/12/13/15/17、`keyword_operating_intelligence_framework_koif.md`）中的 `paid_test` 字样属于 Phase 1/2 时间线，按规范不再回改。

### 2.6 阶段性复盘 — 关键词需求分析实施情况

本节记录 2026-06-22 对当前关键词需求分析链路的阶段性评估，作为 Phase 3 收口后的真实状态锚点。

一句话结论：

> KDS baseline 已进入可运行状态，前端与工具层已能展示 KDS TOP / 需求类型 TOP / 候选接口审计；KOIF Router 已接入 KDS + TMS + CPS。但“任意品类真实需求分类下 KDS TOP”和“完整关键词洞察框架”还未闭环，下一阶段必须优先补真实需求分类、词根、搜索明细、字段级来源与维度覆盖。

当前已落地：

| 能力 | 当前状态 | 代码锚点 | 说明 |
| --- | --- | --- | --- |
| KDS baseline 编排 | 可运行 | `src/services/keyword_demand/index.ts` | resolve / pull / normalize / classify / score / rank / report 主链已完整 |
| KDS 需求强度计算 | 可运行 | `src/services/keyword_demand/strategies/baseline_v1.ts` | scale / growth / traffic / conversion + intent_multiplier，未改 baseline_v1 权重 |
| KDS TOP 总榜 | 可运行 | `src/services/keyword_demand/rank.ts` | 按 KDS 降序，过滤 `transaction_block` 与无具体诉求词 |
| 需求类型 TOP | 可运行但仍偏规则分类 | `src/services/keyword_demand/rank.ts` | 当前主要来自 taxonomy labels，不是 `category_requirements(_v2)` 的真实需求分类 |
| 候选接口审计 | 可运行 | `src/services/keyword_demand/source_audit.ts` / `web/public/components.mjs` | 可展示候选接口、有数据/无数据、状态、原始行、原因 |
| 前端 KDS 验收 | 可运行 | `web/public/main.mjs` | Keyword 面板展示 KDS TOP、需求类型 TOP、蓝海辅助榜、source audit |
| KOIF 聚合 | Phase 3 可运行 | `src/services/koif_router/*` | 已聚合 KDS + TMS + CPS；PVS / CES / PFS / NOS / BDS 未实质化 |

当前未闭环：

| 缺口 | 现状 | 影响 | 下一步 |
| --- | --- | --- | --- |
| 任意品类真实解析 | mock 模式未命中 taxonomy 时回落到近似 fixture；live 模式依赖 `data_keywords_category_list` | “沙发套”这类输入在 mock 下不代表真实沙发套分析 | 真机验证 `category_list` 自动解析；为常用类目补 taxonomy/fixture 仅用于本地验收 |
| 真实需求分类 | `data_keyword_category_requirements` / `data_keyword_category_requirements_v2` 未进入 `keyword_field_mapping.yaml` | “需求分类下 KDS TOP”形式具备，但业务分类真实性不足 | P0 接入 category_requirements 两个接口，分类来源优先级高于 taxonomy fallback |
| 搜索词明细 | `data_ind_category_keywords_detail(_v2)` 未接入 KDS 主链 | KDS 的规模、流量、转化字段覆盖不足，live 场景更容易 fallback | P0 接入搜索明细，补 `search_popularity/click_rate/pay_rate/pay_buyers/demand_supply_ratio` |
| 词根洞察 | `keywords_analysis` / `agent_keyword` 未接入 | root insight 不可用，无法解释需求结构 | P1 建 root/root_requirement 聚合层，输出 root TOP + root KDS 均值 |
| 趋势细化 | `data_bluekeyword_trend` 未接入；TMS 主要复用现有 trend / demand 数据 | TMS 可用但趋势证据不完整 | P1 接入 bluekeyword trend，增强 TMS evidence |
| 元素洞察 | `data_keywords_element_d` 未接入 | CES / 内容主题 / 主图视觉方向缺失 | P2 作为 CES evidence 层接入 |
| 付费价值 | `agent_xiaowan_keywords` 未接入；`data_cust_ads_ad_flow_plan_goods_keyword_7d` 当前服务 CPS 的 CPC | PVS 未落地，不能输出真实放量/降词/否词判断 | Phase 3.5 建 PVS capability，避免把付费决策混入 KDS |
| 商品承接 | PFS 未落地 | 老品优化只能给方向，不能判断具体链接标题/主图/详情/SKU 承接 | Phase 4 接商品级输入与 PFS |
| 字段级来源 | `buildProvenance` 仍用 `record.source[0]` 简化标注 | 报告中“哪个接口贡献哪个字段”可能不准确 | normalize 阶段保留 field-level provenance 并写入 score explanation |
| 维度覆盖产物 | `dimension_coverage.json` 尚未作为标准产物落盘 | 用户无法稳定看到规模/需求分类/流量/转化/趋势/付费等维度缺失 | S8 report 阶段新增标准维度覆盖产物与前端展示 |

当前验收状态：

| 验证项 | 命令 | 2026-06-22 观测 |
| --- | --- | --- |
| Golden + invariants | `npm test` | GREEN，16/16 |
| Pi smoke | `npm run smoke:pi` | GREEN，注册 17 个工具；KDS demo 可跑 |
| KDS 任意品类 mock | `keyword_demand arbitrary category` golden | GREEN，但语义为 fixture fallback，不等于真实任意品类 live |
| Source audit | `keyword_demand: source_audit...` golden | GREEN，可区分候选接口可用/无数据/不可用 |

下一阶段执行顺序：

1. P0：接入 `data_keyword_category_requirements` / `data_keyword_category_requirements_v2`，让真实需求分类优先于 taxonomy labels。
2. P0：接入 `data_ind_category_keywords_detail` / `data_ind_category_keywords_detail_v2`，补 KDS 主链字段覆盖。
3. P0：修正字段级 provenance，输出字段到接口的准确映射。
4. P0：标准化 `dimension_coverage.json`，前端展示每次分析的规模、需求分类、流量、转化、趋势、付费等维度缺失。
5. P1：接入 `keywords_analysis` / `agent_keyword`，形成 root insight。
6. P1：接入 `data_bluekeyword_trend`，增强 TMS evidence。
7. P2：接入 `data_keywords_element_d` 和 PVS/CES/PFS/NOS 的独立 capability，不反向污染 KDS。

---

## 3. 不变量守护

Phase 3 引入 Core Lock 守护，独立测试入口 `npm run test:invariants`（实现：[tests/invariants.test.ts](../tests/invariants.test.ts)），并被 `npm run rebuild:all` 在 stage `S10 test:invariants` 中接入（紧随 `S9 test:golden` 之后）。当前共 3 条：前两条（`mapping_schema_lint` / `pull_status_exhaustiveness`）为硬性失败，违例直接 throw，rebuild 与 PR pipeline 同步 fail；第三条（`mapping_card_root_consistency`）为 WARN 模式，仅 `console.warn` 不阻塞。

### 3.1 mapping_schema_lint

校验对象：[registry/keyword_field_mapping.yaml](../registry/keyword_field_mapping.yaml) 中所有声明 `aggregation` 的 api。

校验项：

| 校验项 | 规则 |
| --- | --- |
| 必填字段 | `aggregation.group_by` / `aggregation.output_level` 必须存在 |
| `output_level` 取值 | 必须 ∈ {`keyword`, `category`} |
| `output_level=keyword` | 必须显式声明 `keyword_field` |
| `output_level=category` | 必须声明 `broadcast_to`，且 api_id 必须在 `CATEGORY_AGGREGATION_API_WHITELIST` 内（当前白名单：`data_competition_pattern_analysis` / `data_competition_pattern_analysis_v3` / `data_agent_competition_pattern_analysis_v3`） |
| `derivations.<canonical>.formula` | 必填字符串，且必须匹配 6 个受限 DSL 模式之一 |
| `clip` | 若声明，必须是 `[min, max]` 二元组且 `min < max` |

受限 DSL 模式（与 [src/services/keyword_competition/normalize.ts](../src/services/keyword_competition/normalize.ts) `evaluateFormula` 一一对齐）：

```
weighted_avg(<field>, weight=<field>)
top_n_share(<field>, n=<int>[, weighted_by=<field>])
log10(distinct_count(<field>) + <num>) * <num>
log10(<field> + <num>) * <num>
distinct_count(<field>)
top3_brand_share        (兼容老 fixture 的 alias)
```

新增 mapping schema 字段或 DSL 操作时，必须同步：[docs/18 §3](18_KEYWORD_FIELD_MAPPING_SPEC.md) schema / [src/services/keyword_demand/types.ts](../src/services/keyword_demand/types.ts) `KeywordFieldMappingApi` / [tests/invariants.test.ts](../tests/invariants.test.ts) `DSL_PATTERNS`。

### 3.2 pull_status_exhaustiveness

校验对象：

- `PullStatus` 枚举：[src/services/keyword_demand/live_pull.ts](../src/services/keyword_demand/live_pull.ts) `export type PullStatus = ...`
- 中文映射表：[src/services/keyword_demand/source_audit.ts](../src/services/keyword_demand/source_audit.ts) `const STATUS_CN`

校验规则：1:1 对齐，任一侧缺失 / 多余 key 即 fail，避免审计报表漂移。本轮已补齐 `disabled_by_config` 中文映射。

### 3.3 mapping_card_root_consistency（WARN 模式）

校验对象：

- [registry/keyword_field_mapping.yaml](../registry/keyword_field_mapping.yaml) 各 enabled api 的 `response_root`
- [registry/derived/api_asset_cards.json](../registry/derived/api_asset_cards.json) 同 api_id 的 `response_schema.root`

校验规则：1:1 比对，差异即记 drift；本条**不阻塞**，仅 `console.warn` 输出 drift 列表，给后续 cards re-derive 或 mapping 修订留观察窗。

当前观测 drift（可接受，靠 live_pull 的 `response_root_override` 透传修复）：

| api_id | mapping.response_root | card.response_schema.root | 备注 |
| --- | --- | --- | --- |
| `data_cust_ads_ad_flow_plan_goods_keyword_7d` | `data.result[]` | `data` | 真机 LIVE probe 阶段定位的根因；mapping 已对齐真机层级，card 暂保留旧值，等下一轮 cards re-derive 同步 |

### 3.4 未实现为 invariants 的隐含约束

下列业务约束 Phase 3 未独立断言，靠 router smoke / golden / 文档评审兜底：

- **cps_weights bucket 命名一致性**：[registry/cps_weights.yaml](../registry/cps_weights.yaml) `cps_levels` 的 bucket key 必须是 `weak / medium / strong`。Phase 3 修复了 cps_weights 用 `medium` / router types 用 `moderate` 不一致导致 bucket 丢失的 bug；新写代码与 yaml 必须统一为 `medium`。靠 `_router_cps_smoke.ts` 的 bucket 出现可见性兜底。
- **keyword_strategies fallback codes 完备性**：[registry/keyword_strategies.yaml](../registry/keyword_strategies.yaml) `cps_baseline_v1` 的 fallback codes 应覆盖 `unsupported_category` / `insufficient_data` / `no_paid_window` / `null_avg_cpc` / `category_lookup_failed` 五个；当前靠 golden + 策略文档评审兜底，未做独立 invariant。Phase 3.5 视需要再加。

---

## 4. 沙箱内验证矩阵

下表是「沙箱内必须保持全绿」的验证集合；任一项 fail 视为 Phase 3 沙箱回归被打破。

| 验证项 | 命令 | 通过标准 | 当前观测 |
| --- | --- | --- | --- |
| Web GUI 端到端 | `node web/_smoke.mjs` | `cards.total=159` / `tools=18` / 全部 endpoint 200 | GREEN |
| Pi smoke（无 pi runtime） | `DBA_PI_SMOKE=1 npm run smoke:pi` | 18 工具全列 + skill 加载完成 | GREEN |
| Golden 套件 | `npm run test:golden` | 13/13（含 `koif_decision_phase3_stub` case） | GREEN |
| Invariants 套件 | `npm run test:invariants` | 3/3（mapping_schema_lint + pull_status_exhaustiveness + mapping_card_root_consistency[WARN]） | GREEN（含 1 条已知 WARN：投流域 card root drift，已通过 response_root_override 修复运行时） |
| 端到端 rebuild | `npm run rebuild:all` | 10 stage 全 ok（snapshot/extract×3/cards/diff/tools/kg/promote/golden/invariants） | GREEN，~1.34s |
| Router CPS smoke | `node --import ./scripts/ts_loader.mjs scripts/_router_cps_smoke.ts` | score_vector=38（CPS 13 / KDS 25 / TMS 25）；bucket=medium 出现 | GREEN |
| Decision stub smoke | `node --import ./scripts/ts_loader.mjs scripts/_decision_smoke.ts` | 4 错误码全通（stub / invalid_kind / not_found / missing_id） | GREEN |

环境前提：`DBA_PI_SMOKE=1` 触发 [scripts/typebox_stub.mjs](../scripts/typebox_stub.mjs)；TS 入口统一 `node --import ./scripts/ts_loader.mjs <file.ts>`；本地 import 使用 `.js` 后缀；type-only 用 `import type`。

---

## 5. 真机三件套（沙箱外 TODO）

沙箱受限项无法在 Cursor 内执行：`ps` / `pkill` / TCP listen / `npm install` / `git commit`（`.git/hooks` EPERM）/ pi runtime / 外网调用。下列任务必须在 macOS 原生 Terminal.app 中按 [docs/PHASE_3_LIVE_PROBE_SOP.md](PHASE_3_LIVE_PROBE_SOP.md) 顺序执行：

| 件 | 触发话术 | 关键预期 |
| --- | --- | --- |
| 件 1 — Competition pack LIVE | 「帮我看下"入户地垫"这个三级类目的关键词竞争压力情况，使用真机数据」 | 命中 `analyze_keyword_competition`；双源 LIVE probe 全 ok；类目级 `competition_index` 同 run 内一致；`cpc_source` paid≥5 / missing≥3 |
| 件 2 — KOIF Router 三路汇合 | 「帮我看下"入户地垫"这个词的关键词经营机会」 | 命中 `propose_koif_strategy`；KDS+TMS+CPS 三路全 LIVE；score_vector 条目 ≥ 30；至少 1 条 strategy_routes + next_actions（中性化） |
| 件 3 — Decision stub | 「基于刚才的 router_run_id，给我出"入户地垫"的付费投放测款方案」 | 命中 `propose_koif_decision`；必返 `decision_layer_phase3_stub`；hints 含「Phase 3.5 / PVS / 解锁」之一 |

完成后追加：`git push` 到 feature 分支（沙箱内 git hooks EPERM 阻塞，必须 Terminal.app 执行）。

---

## 6. 风险登记

按风险等级与影响面分四类登记。每条风险必须含触发条件、影响面、缓解措施、责任规范出处。

### 6.1 数据契约风险

| ID | 风险 | 触发条件 | 影响面 | 缓解 |
| --- | --- | --- | --- | --- |
| R-DATA-01 | 类目级广播导致同类目 record 的 `competition_index` 全相同 | 类目内关键词数 ≥ 2 时必现（设计预期） | CPS ranking 在弱投放类目可能出现大量 `solo_competition_index` 平局 | 用户层面话术明确：「此类目竞争评分主要靠类目级聚合，关键词差异需结合 KDS / TMS 区分」；docs/20 §2 已声明 |
| R-DATA-02 | 样本租户投放覆盖率 < 30% | 投流域返回 `cpc_source=missing` 关键词 ≥ 70% | 多数关键词走 solo_competition_index 路径，CPS 区分度退化 | report.ts 在 cps_run report 中显式标注 paid/missing 比例；超阈值时 hint 用户切换 demand pack 或扩大租户样本 |
| R-DATA-03 | brand 字段稀疏 | `data_competition_pattern_analysis` raw 中 `brand_name` 覆盖 < 50% | brand_concentration 不可信，competition_index 备份链跳过 brand_concentration_top3，回落 distinct_shop_count_log | normalize Stage A 检测覆盖率 < 50% 时跳过 brand_concentration 派生 + 报告中标注 |
| R-DATA-04 | 类目映射 fail | `data_competition_pattern_analysis` raw 的 `tertiary_category` 与 demand pack 的 keyword 类目不一致 | Stage C 广播失败，部分 record competition_index 为空 | 触发 fallback code `category_lookup_failed`；invariants 守护 keyword_strategies 中该 code 必须声明 |
| R-DATA-05 | 需求分类仍由规则标签主导 | `category_requirements(_v2)` 未接入或返回空 | 用户看到“需求分类下 KDS TOP”，但分类口径不是数仓真实需求分类 | 接入需求分类接口后增加 `classification_source`；taxonomy 仅作为 fallback 并在报告标注 |
| R-DATA-06 | KDS 主链字段覆盖不足 | 搜索明细 / 行业明细接口未接入或返回空 | scale / traffic / conversion 更频繁触发 fallback，KDS 可信度下降 | 接入 `category_keywords_detail(_v2)`；维度覆盖率低于阈值时在 `dimension_coverage.json` 和前端提示 |
| R-DATA-07 | 投流域 LIVE probe 修复后出现 `context_mismatch` | 投流域 `keyword_field_missing` 已在 6/22 真机 run 修复（`response_root` 对齐 `data.result[]`，kw_name 正确提取，HTTP 200 / totalNum=16028），但 pipeline 验证阶段紧接着抛 `context_mismatch` | CPS 真机三件套链路在投流域分支未闭环；KOIF Router 三路汇合无法走完整 LIVE | 待诊断 `context_mismatch` 根因：候选方向是窗口/类目/keyword_universe 三方在 normalize Stage C 关键词广播时不对齐；下一轮真机要先打开 pipeline 上下文快照，再决定是改 normalize 容错还是修 mapping 字段缺省 |

### 6.2 决策层边界风险

| ID | 风险 | 触发条件 | 影响面 | 缓解 |
| --- | --- | --- | --- | --- |
| R-BOUND-01 | KOIF Router action 出现金额 / ROI / 出价语 | 模板被误改、或 LLM 在 next_actions 渲染时被自由发挥诱导 | archaeology 边界破裂，CPS 评分能力被外溢成决策建议 | [docs/15 §6.1](15_KOIF_ROUTER_SPEC.md) 模板硬编码中性化文案 + [docs/19 §1](19_KOIF_DECISION_LAYER_SPEC.md) 边界条款 + [AGENTS.md §1.1](../AGENTS.md) 判定原则 |
| R-BOUND-02 | `propose_koif_decision` 在 Phase 3 被误用为真实决策 | 上游 LLM 忽略 stub 错误码，把 hint 当成决策结论 | 用户拿到伪决策结果 | stub 强制返 `decision_layer_phase3_stub` + skill SKILL.md 显式声明「Phase 3 仅 stub」+ golden case `koif_decision_phase3_stub` 把行为锁死 |
| R-BOUND-03 | decision_kind 枚举漂移 | 新增 decision_kind 但未同步到 stub 的允许集合 | invalid_kind 被错误放行 | golden case `koif_decision_invalid_kind` 锁住 unsupported 错误码；新增 decision_kind 必须加 case |

### 6.3 工程契约风险

| ID | 风险 | 触发条件 | 影响面 | 缓解 |
| --- | --- | --- | --- | --- |
| R-ENG-01 | bucket 命名漂移（`medium` ↔ `moderate`） | 任意一处误写 `moderate` | router 聚合时 bucket 缺失，next_actions 触发条件失效 | Phase 3 已统一为 `medium`；规约靠 router_cps_smoke.ts + cps_weights.yaml 评审审视 |
| R-ENG-02 | DSL 表达式被扩展到嵌套 | 有人为新派生字段写嵌套表达式 | yaml_lite 解析复杂度跃升 + invariants DSL 模式失效 | invariants `mapping_schema_lint` 用受限正则集匹配；新增 op 必须同步扩 `DSL_PATTERNS` |
| R-ENG-03 | `output_level=category` 白名单失效 | 有人新增类目聚合 api 但忘记加白名单 | normalize Stage A 不会处理，Stage C 广播为空 | invariants 校验 `CATEGORY_AGGREGATION_API_WHITELIST`，未在白名单 fail |
| R-ENG-04 | PullStatus 枚举漂移 | 新增 status 但 STATUS_CN 不同步 | source_audit 报表丢中文 | invariants `pull_status_exhaustiveness` 1:1 对齐 |
| R-ENG-05 | 关键词清单缺失 | CPS 单跑（不带 demand context）且投流域返空 | keyword_universe 为空，CPS pipeline 无产物 | `resolveKeywordUniverse` 双源 fallback；空集时 strategy 抛 `insufficient_data`（已在 fallback codes 中） |
| R-ENG-06 | 字段级来源归因不准 | 多源合并后 `buildProvenance` 仍用 `record.source[0]` 标记所有字段 | 报告误导用户判断“哪个接口贡献了哪个 KDS 维度” | normalize 阶段输出 field-level provenance；score explanation 使用字段级 winner 而不是 record 首个 source |

### 6.4 沙箱与外部依赖风险

| ID | 风险 | 触发条件 | 影响面 | 缓解 |
| --- | --- | --- | --- | --- |
| R-ENV-01 | 沙箱无外网，真机 LIVE 无法在 Cursor 内执行 | Phase 3 验收必走真机 | 三件套滞后 | [docs/PHASE_3_LIVE_PROBE_SOP.md](PHASE_3_LIVE_PROBE_SOP.md) Terminal.app 操作手册 |
| R-ENV-02 | git hooks EPERM | 沙箱写 `.git/hooks` 失败 | git commit / push 阻塞 | 用户在 Terminal.app 完成 commit / push；本规范不允许 `--no-verify` 绕过 hooks（除非用户显式要求） |
| R-ENV-03 | pi 依赖 ProjectTrustStore | pi 启动 EPERM | pi 进程起不来 | 启动用 `PI_CODING_AGENT_DIR="$(pwd)/.pi-home/agent" pi --model aicodemirror/gpt-5.5` |
| R-ENV-04 | 投流域 `user_id_list` 必填，租户级凭据 | LIVE probe 缺 ZICHEN_* | LIVE 401/403 | `.env` 提供 ZICHEN_BASE_URL / TENANT_ID / USER_ID / APP_CODE_KEY / APP_CODE；LIVE 失败时翻 `pull_report.per_api[*].http` |

---

## 7. 修订与延伸

- 本规范在 Phase 3.5 PVS 实质化时同步追加 §2.6（PVS 完成范围）+ §6.5（PVS 数据契约风险）。
- decision_layer 实质化决策算法时，本规范 §6.2 R-BOUND-02 由「stub 必返」变为「按 decision_kind 分流」，对应入参 schema 与产物结构以 [docs/19](19_KOIF_DECISION_LAYER_SPEC.md) 同步章节为准。
- 真机三件套完成回贴产物路径后，§5 表格补 LIVE run 实测值（`run_id` / `score_vector` 数 / `cpc_source` 分布等），并把待办状态改为已完成。
