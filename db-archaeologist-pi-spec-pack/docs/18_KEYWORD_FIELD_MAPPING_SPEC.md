# 18. Keyword Field Mapping 规范

## 1. 定位

`registry/keyword_field_mapping.yaml` 是 `keyword_analysis_pack` namespace 的私有配置，定义：

- 6 个 P0 关键词接口的**请求模板**（含占位符）
- **响应字段映射**（raw field → canonical metric）
- **合并优先级**（多源同字段时决胜规则）

### 1.1 与 Validation Overlay 的边界

本 mapping 与 [docs/09_VALIDATION_OVERLAY_SPEC.md](docs/09_VALIDATION_OVERLAY_SPEC.md) 的 `ApiAssetCard.verified_call` 是**互补关系**：

- `verified_call`：通用 API runtime dispatch 的真值快照（单接口调通参数）
- `keyword_field_mapping.yaml`：keyword pack pull 编排的**合并模板**（多接口聚合 + 字段归一）

当两者冲突时：
- keyword pack 内路径（`analyze_keyword_demand` / `analyze_keyword_trend`）优先走 mapping
- 通用 dispatch 路径（`probe_api` / `select_tools_for_task`）优先走 verified_call

理由：keyword pack 需要多源合并（如 `search_popularity` 优先从 `agent_sycm_keyword` 取，缺失时回落 `data_blue_keyword_7d_v2`），而 verified_call 是单接口快照，无合并语义。

---

## 2. 顶层字段

```yaml
version: 1
category_lookup_api: data_keywords_category_list
keyword_metric_record_keys:
  identity: [keyword, category]
  metrics: [search_popularity, search_index, ...]
apis:
  <api_id>: { ... }
merge_order_priority: [<api_id1>, <api_id2>, ...]
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | number | Schema 版本，当前固定 1 |
| `category_lookup_api` | string | auto-resolve 未命中 taxonomy 时调用的类目查找接口（可选，缺省禁用 auto-resolve） |
| `keyword_metric_record_keys.identity` | string[] | 记录主键（用于去重） |
| `keyword_metric_record_keys.metrics` | string[] | 关键词指标 canonical 名表（全集） |
| `apis` | object | 接口节点字典，key=api_id |
| `merge_order_priority` | string[] | 合并遍历顺序（priority 倒序；**禁用接口不出现在此列表**） |

---

## 3. 单接口节点 schema

```yaml
apis:
  <api_id>:
    priority: 100
    method: POST
    path: /agent/sycm_keyword
    response_root: data.result[]
    keyword_field: keywords
    request_template:
      tertiary_category: "{tertiary_category}"
    field_map:
      search_popularity: search_popularity
      click_rate: click_rate
    notes: "接口能力说明"
    enabled: true              # 新字段（可选）
    date_format: day           # 新字段（可选）
```

### 3.1 必填字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `priority` | number | 合并优先级（越大越优先；同字段冲突时高 priority 胜出） |
| `method` | `GET \| POST` | HTTP 方法 |
| `path` | string | API 路径（不含 base_url） |
| `response_root` | string | 响应数据根路径（如 `data.result[]`；末尾 `[]` 表示数组） |
| `keyword_field` | string | 关键词字段名（在 response_root 每条记录里的键名） |
| `request_template` | object | 请求参数模板（支持占位符） |
| `field_map` | object | 响应字段映射（`canonical: raw_field`） |

### 3.2 可选字段

| 字段 | 类型 | 缺省值 | 说明 |
| --- | --- | --- | --- |
| `notes` | string | `""` | 接口能力说明（供人工理解） |
| `enabled` | boolean | `true` | **false 时 live_pull 跳过该接口**，状态记为 `disabled_by_config` |
| `date_format` | `"month" \| "day"` | `"day"` | **日期格式约定**：`month` → 渲染期把 `{start_date}/{end_date}/{business_date}` 截短为 `YYYY-MM` |
| `score_domain_hint` | string | `null` | **多 capability 共享接口时声明本节点服务于哪个 score_domain**（如 `demand` / `trend` / `competition`），不强校验，仅供 lint 与审计用 |
| `aggregation` | object | `null` | **声明本接口的原生粒度与归一化目标粒度**，用于 normalize 层做「商品/计划级 raw → 类目级或关键词级 metric」的聚合（Phase 3 新增，详见 §3.2.2） |

### 3.2.1 score_domain_hint 语义

引入 `score_domain_hint` 的背景：CPS capability 与 demand 复用部分接口（如 `data_blue_keyword_30d_v2` 同时含搜索热度与广告词信号）。当一个 mapping 节点服务于多个 capability 时，`score_domain_hint` 用于：

- 声明本节点的「主用途」（hint，非排他）
- mapping_schema_lint（[docs/17 不变量章节](17_KOIF_PHASE2_IMPLEMENTATION.md)）按 hint 校验字段映射齐全度（如 `competition` hint 节点缺少 `competition_index` 字段则告警）
- audit 工具按 hint 反向定位 capability ↔ 接口关系

合法值：`demand` / `trend` / `competition` / `paid_value` / `multi`（明确多用途时填 `multi`，跳过 lint）。

### 3.2.2 aggregation 块语义（Phase 3 新增）

**背景**：CPS capability 的两个主源接口 raw 粒度都不是「关键词级」：
- 投流域 `data_cust_ads_ad_flow_plan_goods_keyword_7d` 是「关键词 × 计划 × 商品」三维 raw，需 group by `kw_name` 聚合到关键词
- 竞争域 `data_competition_pattern_analysis` 是「商品级」raw，无关键词维度，需 group by `tertiary_category` 聚合到类目，再广播到该类目下所有关键词

mapping 用 `aggregation` 块声明这两类聚合规则，由 normalize 层统一解释执行。

**schema**：

```yaml
apis:
  <api_id>:
    aggregation:                     # 可选；未声明则按「raw 即 keyword 级」处理
      group_by: tertiary_category    # 必填；分组维度（字段名 | "kw_name" | "none"）
      output_level: keyword          # 必填；keyword | category
      keyword_field: kw_name         # output_level=keyword 时必填，声明源字段
      broadcast_to: keyword          # output_level=category 时必填，声明广播粒度
      filters:                       # 可选；聚合前预筛（DSL 表达式）
        - "search_rank <= 100"
      derivations:                   # 必填；派生字段计算规则
        <canonical_field>:
          formula: "<DSL 表达式>"     # 见下方操作集
          weight: <field>            # 仅 weighted_avg 用
          clip: [min, max]           # 可选；结果截断到区间
```

**DSL 操作集**（normalize.ts 实现一个受限解释器，**不支持嵌套表达式 / 用户函数**）：

| 操作 | 语法 | 说明 |
| --- | --- | --- |
| `distinct_count` | `distinct_count(field)` | 当前分组里某字段的唯一值数量 |
| `log10` | `log10(expr) * k` | 对前一项取以 10 为底的对数后乘常数 k；`expr` 只能是字段名或上面 `distinct_count(...)` |
| `top_n_share` | `top_n_share(field, n=3, weighted_by=field?)` | 按 `field` 分组并按 `weighted_by` 加权（不传则按行数），取 top n 占比，返回 0..1 |
| `weighted_avg` | `weighted_avg(field, weight=field)` | 加权平均；`weight` 必填 |
| `clip` | `clip(expr, [min, max])` | 把结果截断到 [min, max] 区间 |

**output_level 语义**：

| 值 | 含义 | normalize 行为 |
| --- | --- | --- |
| `keyword` | 聚合后即为关键词级 metric | 直接合并入 `keyword_metrics[keyword]` |
| `category` | 聚合后是类目级标量 | 计入 `category_metrics[category]`，再由 Stage C 广播到该类目下所有关键词 record |

**示例 1：竞争域类目聚合**

```yaml
data_competition_pattern_analysis:
  aggregation:
    group_by: tertiary_category
    output_level: category
    broadcast_to: keyword
    filters:
      - "search_rank <= 100"
    derivations:
      competition_index:
        formula: "log10(distinct_count(shop) + 1) * 25"
        clip: [0, 100]
      brand_concentration:
        formula: "top_n_share(brand_name, n=3, weighted_by=display_price)"
        clip: [0, 1]
```

**示例 2：投流域关键词聚合**

```yaml
data_cust_ads_ad_flow_plan_goods_keyword_7d:
  aggregation:
    group_by: kw_name
    output_level: keyword
    keyword_field: kw_name
    derivations:
      avg_cpc_cny:
        formula: "weighted_avg(avg_cost_per_clk, weight=clk_cnt)"
```

**与 `field_map` 的关系**：

- `field_map` 仍声明 raw 字段 → canonical 字段的**直接重命名**（如 `avg_cost_per_clk: avg_cost_per_clk`）
- `aggregation.derivations` 声明**计算派生字段**（不是简单重命名），优先级高于 `field_map`
- 二者声明的 canonical 字段不能重叠（lint 守护）

### 3.3 request_template 嵌套规则

支持两种形式：

1. **扁平**：
   ```yaml
   request_template:
     tertiary_category: "{tertiary_category}"
     start_date: "{start_date}"
   ```

2. **嵌套**（区分 query / body）：
   ```yaml
   request_template:
     query:
       userId: "{user_id}"
       tenantId: "{tenant_id}"
     body:
       tertiary_category: "{tertiary_category}"
       start_date: "{start_date}"
   ```

渲染时会**扁平化**成单层 params，由 `api_runtime.ts` 的 `assembleRequest()` 按 ApiAssetCard 声明分流到 query/body。

### 3.4 date_format 语义

| 值 | 行为 | 适用场景 |
| --- | --- | --- |
| `day`（缺省） | 不截短，保持 `YYYY-MM-DD` | 日级接口（`data_blue_keyword_7d_v2` / `agent_sycm_keyword`） |
| `month` | 把 `{start_date}` / `{end_date}` / `{business_date}` 截短为 `YYYY-MM` | **月度时序接口**（`data_keyword_trend`） |

**重要**：`date_format=month` 仅用于月度时序接口，不要用于日级接口（会导致接口拿不到完整日期而空数据）。

---

## 4. 占位符表

| 占位符 | 来源 | 说明 |
| --- | --- | --- |
| `{tertiary_category}` | `CategoryContext.tertiary_category` | 三级类目中文名（如"入户地垫"） |
| `{category_id}` | `CategoryContext.category_id` | 类目 ID（如 201829521） |
| `{start_date}` | `DateRange.start_date` | 开始日期（`YYYY-MM-DD` 或 `YYYY-MM`） |
| `{end_date}` | `DateRange.end_date` | 结束日期（`YYYY-MM-DD` 或 `YYYY-MM`） |
| `{business_date}` | `DateRange.start_date` | 业务日期（通常取 start_date） |
| `{tenant_id}` | `process.env.ZICHEN_TENANT_ID` | 租户 ID |
| `{user_id}` | `process.env.ZICHEN_USER_ID` | 用户 ID |

### 4.1 日期占位符与 date_format 协同

- 当 `date_format=day`（缺省）时：`{start_date}` 直接替换为 `2026-02-01`
- 当 `date_format=month` 时：`{start_date}` 先替换为 `2026-02-01`，再截短为 `2026-02`

### 4.2 缺失占位符处理

- `{category_id}` 缺失且 request_template 引用时 → 接口状态 `skipped_missing_category_id`（不报错，不阻塞其他接口）
- `{tertiary_category}` 缺失 → 同上
- `{tenant_id}` / `{user_id}` 缺失 → `env_missing` 状态

---

## 5. 与全量验证版对齐参数的修订 SOP

当发现 mapping 参数与「真机可调通参数」不一致时（例如 5/6 接口空数据），按以下 5 步修订：

### 5.1 提取真机参数

在 [sources/api_docs/智能体数仓完整接口文档_全量验证版.md](sources/api_docs/智能体数仓完整接口文档_全量验证版.md) 找到该接口行（通过 path 匹配），提取：

- **真实可调通 URL**（含 query 参数）
- **真实 body**（JSON 格式）

例如：`/data/keyword/trend` 行 130：
```
http://...?userId=...&tenantId=...&end_date=2025-10&tertiary_category=沙发垫&start_date=2025-01&category_requirements=品类需求
body: {"keywords_list": ""}
```

### 5.2 备份当前 mapping

```bash
cd /Users/yichen/Desktop/OntologyBrain/PI_AGENT/db-archaeologist-pi-spec-pack
cp registry/keyword_field_mapping.yaml registry/_archive/keyword_field_mapping.$(date +%Y%m%d-%H%M).yaml
```

### 5.3 改 mapping，1:1 对齐真机参数

**关键原则**：
- 阈值类参数（`search_popularity` / `requirement_prop` / `search_value` / `has_demand_supply_ratio`）**以真机为准**，不要凭直觉填 0（0 会过滤掉所有数据）
- 分页参数（`pageNum` / `pageSize`）以真机为准
- 日期参数（`start_date` / `end_date` / `business_date`）保留占位符，但若真机是月级格式，加 `date_format: month`

错误示例：
```yaml
request_template:
  search_popularity: "0"  # ❌ 会过滤掉所有数据
```

正确示例：
```yaml
request_template:
  search_popularity: "100"  # ✅ 与真机一致
```

### 5.4 真机单接口 probe

```bash
cd /Users/yichen/Desktop/OntologyBrain/PI_AGENT/db-archaeologist-pi-spec-pack
LIVE_PROBE=true node --import ./scripts/ts_loader.mjs src/tools/analyze_keyword_demand.ts
```

观察 `pull_report.per_api[<api_id>]`：
- `status=ok && total>0` → 通过
- `status=empty` / `business_empty` → 参数可能仍有问题，回到 §5.3

### 5.5 跑 golden，全 GREEN 后合入

```bash
npm run test:golden
```

若 golden 失败，检查：
- 是否改动了其他接口的 priority / field_map（会影响合并结果）
- 是否改了 `merge_order_priority` 顺序（会影响决胜规则）

通过后提交。

---

## 6. 修订风险与降级

### 6.1 mapping 修订属于 AGENTS.md §2 「领域映射规则」边界吗？

**答：不属于**。

- `domain_mapping.locked.yaml`：API → domain 分类规则，属于领域映射，**禁止在未通过 golden 前修改**
- `keyword_field_mapping.yaml`：keyword pack 请求模板，属于工程配置，**可在 golden GREEN 前提下迭代**

但 schema 字段（`enabled` / `date_format` / `score_domain_hint`）是工程约定，**必须先入本文档再用**。

### 6.2 新增 schema 字段的兜底要求

若在 mapping 新增字段（如本次的 `enabled` / `date_format` / `score_domain_hint`），必须在 [src/services/keyword_demand/live_pull.ts](src/services/keyword_demand/live_pull.ts) 增加：

- **缺省值**：老 mapping 不含该字段时，自动填 `true` / `"day"` / `null`
- **类型校验告警**：若字段类型不匹配（如 `enabled: "yes"`），打 warning 并降级为缺省值
- **不允许直接 throw**（会导致整个 pull 流程挂掉）

### 6.3 enabled=false 的副作用

- 接口状态记为 `disabled_by_config`，不计入 `effective_apis`
- 若该接口在 fixture 里有数据，mock 路径需要同步过滤（当前 mock 路径直接读 `raw_by_api`，不走 enabled 过滤；若未来 fixture 含 disabled 接口数据，需要在 demand/index.ts 的 mock 分支补过滤）

### 6.4 量纲守护纪律（Phase 3 新增）

**背景**：Phase 2 遭遇 `search_growth_rate` 量纲不匹配（阈值用 0..1 但字段实际 0..100）导致时序聚合错位。

**纪律**：

1. **阈值类参数变更必须三处同步**：
   - `registry/kds_weights.yaml`（demand 子分数权重与 bucket 边界）
   - `registry/keyword_trend_weights.yaml`（trend 子分数权重）
   - `registry/cps_weights.yaml`（Phase 3 起，competition 子分数权重）
   - `src/services/keyword_trend/compute_tms.ts` 中硬编码的 bucket 边界
   - 例如：`search_growth_rate` 的 bucket [0.1, 0.3, 0.5] 若改为百分比 [10, 30, 50]，必须同时改 weights.yaml 与 compute_tms.ts 的判断逻辑

2. **不变量测试守护**（Phase 3 起）：
   - `tests/invariants/score_dimension_units.test.ts` 解析所有 weights.yaml 的 bucket 边界
   - 对每个 bucket 边界做单位类型枚举校验（`0..1` vs `0..100`）
   - 若发现同一 score_domain 内出现不一致量纲，test fail
   - 详见 [plan §7](../plan.md)

3. **修订前必读 weights.yaml 注释**：
   - 每个 weights.yaml 文件顶部必须声明当前使用的量纲约定（如 `# search_growth_rate: 百分比 0..100`）
   - 修订前先读注释，避免凭直觉填错

### 6.5 score_domain_hint lint 守护（Phase 3 新增）

`tests/invariants/mapping_schema_lint.test.ts` 按 score_domain_hint 校验：

- `hint=demand` 节点必须含 `search_popularity` / `search_index` 等 demand 核心字段之一
- `hint=trend` 节点必须含 `search_growth_rate` / `monthly_search_data` 等 trend 核心字段之一
- `hint=competition` 节点必须含 `competition_index` / `avg_cpc` / `brand_concentration` 等 competition 核心字段之一
- `hint=multi` 跳过字段齐全度校验
- `hint=null` 默认视为 multi

lint 警告（非阻塞），但 PR 前必须清理。

---

## 7. 月度聚合纪律（Phase 3 新增）

**背景**：keyword_trend capability 使用月度时序接口（`data_keyword_trend`），需在 S4 normalize 阶段预聚合月度数据，避免后续 pipeline 按日级逻辑错误处理。

**纪律**：

1. **声明 `date_format=month` 的接口必须在 normalize 白名单可见**：
   - [src/services/keyword_demand/normalize.ts](src/services/keyword_demand/normalize.ts) 的 `preAggregateMonthlyApis()` 中硬编码白名单：
     ```typescript
     const monthlyApiIds = [
       "data_keyword_trend",
       // 新增 date_format=month 节点时同步在此追加
     ];
     ```
   - 新增 `date_format=month` 节点时，必须同步更新 normalize.ts 白名单

2. **不变量测试守护**（Phase 3 起）：
   - `tests/invariants/mapping_schema_lint.test.ts` 解析 keyword_field_mapping.yaml
   - 找出所有 `date_format=month` 节点
   - 断言每个节点的 `api_id` 出现在 normalize.ts 的 `monthlyApiIds` 白名单中
   - 若缺失，test fail + hint「请在 normalize.ts 的 preAggregateMonthlyApis() 中加入 <api_id>」

3. **月度聚合方案 A 自洽守护**：
   - `tests/invariants/timeseries_aggregation_self_consistency.test.ts` 喂构造的 3 月时序数据
   - 断言聚合结果的 mom / yoy / slope 与手算公式一致
   - 避免聚合算法漂移

4. **反向 lint**：
   - 若 normalize.ts 白名单含某 api_id，但 mapping 未声明或 `date_format=day`，告警「normalize 白名单冗余」

### 7.1 类目聚合纪律（Phase 3 新增）

**背景**：CPS capability 引入 `aggregation` 块（详见 §3.2.2）后，competition 域的接口在 normalize 层做「商品级 raw → 类目级 metric → 关键词广播」。这一聚合链路必须有守护。

**纪律**：

1. **`output_level=category` 的接口必须在 normalize 白名单可见**：
   - [src/services/keyword_competition/normalize.ts](src/services/keyword_competition/normalize.ts) 的 `categoryAggregationApis` 白名单：
     ```typescript
     const categoryAggregationApis = [
       "data_competition_pattern_analysis",
       // 新增 output_level=category 节点时同步追加
     ];
     ```
   - 新增 `output_level=category` 节点时必须同步更新

2. **`output_level=keyword` + `keyword_field` 必填**：
   - mapping_schema_lint 校验：声明 `output_level=keyword` 时 `keyword_field` 不能空
   - 否则告警「missing keyword_field for keyword-level aggregation」

3. **DSL 语法合法性**：
   - mapping_schema_lint 解析每个 `derivations.<field>.formula`，校验：
     - 操作名在 §3.2.2 操作集白名单内（`distinct_count` / `log10` / `top_n_share` / `weighted_avg` / `clip`）
     - 不允许嵌套表达式（除 `log10(distinct_count(...))` 这一个白名单组合）
     - `weighted_avg` 必带 `weight` 参数
     - `clip` 区间 [min, max] 合法

4. **`field_map` ↔ `derivations` 不重叠**：
   - 同一 canonical 字段不能既在 `field_map` 又在 `aggregation.derivations` 中出现
   - 否则告警「duplicate canonical field <name>」

5. **类目广播自洽守护**：
   - `tests/golden_cases/keyword_competition_cases.yaml` 含一条 `category_broadcast_consistency` 断言：同 `tertiary_category` 下所有 record 的 `competition_index` 完全相同
   - 防止 normalize Stage C 广播逻辑漂移

---

## 8. 与 docs/09 的边界细化

| 场景 | mapping 生效？ | verified_call 生效？ | 决策依据 |
| --- | --- | --- | --- |
| keyword pack 内 pull | ✅ | ❌ | pack 需要多源合并 + 字段映射 |
| 通用 dispatch（probe_api / select_tools） | ❌ | ✅ | 通用路径无法预知 pack 合并规则 |
| keyword pack 内 auto-resolve | ✅ | ❌ | category_lookup_api 来自 mapping 顶层 |
| 真机回归测试（LIVE_PROBE=true） | ✅ | ❌ | 按 pack 实际流程验证 |

**原则**：mapping 不替代 verified_call，各司其职。

---

## 8. 修订历史

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-06-XX | v1 | 初版：定义 enabled / date_format 字段 + 全量验证版对齐 SOP |

---

## 9. 相关文档

- [docs/09_VALIDATION_OVERLAY_SPEC.md](docs/09_VALIDATION_OVERLAY_SPEC.md)：verified_call 规范
- [docs/12_KEYWORD_DEMAND_PACK_SPEC.md](docs/12_KEYWORD_DEMAND_PACK_SPEC.md)：demand pack 流程（含默认日期窗口策略）
- [docs/13_TREND_DEMAND_PACK_SPEC.md](docs/13_TREND_DEMAND_PACK_SPEC.md)：trend pack 流程（含月度日期窗口策略）
- [AGENTS.md](AGENTS.md) §8：工具链约束与 mapping 修订纪律