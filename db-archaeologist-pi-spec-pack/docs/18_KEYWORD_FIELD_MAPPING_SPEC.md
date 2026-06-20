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

但 schema 字段（`enabled` / `date_format`）是工程约定，**必须先入本文档再用**。

### 6.2 新增 schema 字段的兜底要求

若在 mapping 新增字段（如本次的 `enabled` / `date_format`），必须在 [src/services/keyword_demand/live_pull.ts](src/services/keyword_demand/live_pull.ts) 增加：

- **缺省值**：老 mapping 不含该字段时，自动填 `true` / `"day"`
- **类型校验告警**：若字段类型不匹配（如 `enabled: "yes"`），打 warning 并降级为缺省值
- **不允许直接 throw**（会导致整个 pull 流程挂掉）

### 6.3 enabled=false 的副作用

- 接口状态记为 `disabled_by_config`，不计入 `effective_apis`
- 若该接口在 fixture 里有数据，mock 路径需要同步过滤（当前 mock 路径直接读 `raw_by_api`，不走 enabled 过滤；若未来 fixture 含 disabled 接口数据，需要在 demand/index.ts 的 mock 分支补过滤）

---

## 7. 与 docs/09 的边界细化

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