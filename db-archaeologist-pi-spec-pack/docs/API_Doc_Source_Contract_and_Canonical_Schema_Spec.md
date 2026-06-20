# 智能体数仓 API 文档源格式与 Canonical Schema 规范

> 文档版本：v1.0  
> 适用项目：DB Archaeologist Agent  
> 适用范围：智能体数仓 API 文档、ApiAssetCard、Domain Mapping、Tool Registry、Knowledge Graph、Pi Runtime Tool 接入  
> 核心目标：降低源文档格式变化对后续执行链路的破坏性影响  
> 推荐状态：作为数据团队、Agent 团队、平台工程团队的共同工程规范  

---

## 1. 背景与核心问题

当前 DB Archaeologist Agent 的起点是「智能体数仓完整接口文档_整理版.md」。这类文档包含接口索引、接口详情、请求参数、返回格式、返回字段说明、问题标记等信息，是后续生成 ApiAssetCard、Domain Mapping、Tool Registry 和 Knowledge Graph 的源资产。

但当前文档本质上仍是 **Markdown 半结构化文档**。如果后续 Apifox / Widdershins 导出格式发生较大变化，或者人工编辑时修改了标题、表格结构、字段名称、接口详情块顺序，就可能导致：

```text
Markdown Parser 失效
ApiAssetCard 生成失败
Domain Mapping 断裂
Tool Registry 指向错误
Knowledge Graph 边缺失
API 问答不准确
Agent 自动选工具错误
```

因此，必须把文档规范从“人能看懂”升级为“机器可编译、可验证、可兼容演进”。

---

## 2. 总体原则

### 2.1 不把 Markdown 作为 Runtime Contract

Markdown 只作为 **Source Document**，主要用途是：

```text
1. 给数据团队、研发团队、业务团队阅读
2. 作为 Extractor 的输入
3. 作为接口资产追溯来源
4. 作为 Canonical API Asset Schema 的生成依据
```

Agent Runtime、Tool Registry、Knowledge Graph 不允许直接依赖 Markdown 原文。

正确链路应为：

```text
Apifox / Markdown / OpenAPI / 研发补充
        ↓
Extractor Adapter
        ↓
Canonical API Asset Schema
        ↓
ApiAssetCard Registry
        ↓
Domain Mapping
        ↓
Metric Dictionary
        ↓
Tool Registry
        ↓
Knowledge Graph
        ↓
Pi Runtime Tools
        ↓
API 问答 / Agent 自动选工具
```

### 2.2 真正稳定的是 Canonical API Asset Schema

Markdown 可以演进，但必须能够稳定编译到 Canonical API Asset Schema。

```text
源文档格式可以变
Extractor Adapter 可以升级
但 Canonical Schema 不能频繁破坏性变化
```

后续所有执行链路只依赖 Canonical Schema，而不是依赖 Markdown 的标题、表格顺序或行号。

---

## 3. 三层契约模型

建议建立三层契约：

```text
L1. Source Document Contract
    约束 Markdown / Apifox 导出的最低格式要求

L2. Canonical Asset Schema Contract
    约束系统内部稳定使用的数据结构

L3. Downstream Runtime Contract
    约束 Tool Registry / KG / Agent 调用格式
```

### 3.1 L1：Source Document Contract

负责约束源文档的最低可解析结构，包括：

```text
1. 文件级 Metadata
2. 全量接口索引
3. 接口详情块
4. 请求参数说明
5. 返回格式
6. 返回字段说明
7. 问题标记
8. 变更记录
```

### 3.2 L2：Canonical Asset Schema Contract

负责定义 ApiAssetCard 的稳定结构，包括：

```text
1. api_id
2. identity
3. request
4. response
5. semantic
6. governance
7. runtime
8. lineage
```

### 3.3 L3：Downstream Runtime Contract

负责定义下游使用约束，包括：

```text
1. Tool Registry 输入/输出
2. Knowledge Graph 节点与边
3. API QA 输出格式
4. Tool Selection 输出格式
5. Pi Runtime Tool 注册格式
```

---

## 4. Source API Doc v1 规范

### 4.1 文件级 Metadata

推荐使用 YAML Front Matter。

```yaml
---
spec_version: api-doc-md-v1
asset_type: api_catalog_source
project: intelligent-data-warehouse
source_system: apifox
generated_at: 2026-06-04
owner_team: data-platform
parser_min_version: 1.0.0
canonical_schema_version: api-asset-card-v1
---
```

#### 必填字段

| 字段 | 是否必填 | 说明 |
|---|---:|---|
| `spec_version` | 是 | 源文档格式版本，例如 `api-doc-md-v1` |
| `asset_type` | 是 | 固定为 `api_catalog_source` |
| `project` | 是 | 项目名 |
| `source_system` | 是 | 来源系统，例如 Apifox / Widdershins / manual |
| `generated_at` | 是 | 文档生成时间 |
| `owner_team` | 是 | 文档负责团队 |
| `parser_min_version` | 是 | 最低 Parser 版本 |
| `canonical_schema_version` | 是 | 目标 Canonical Schema 版本 |

---

### 4.2 全量接口索引规范

全量接口索引是 Parser 的第一入口，必须稳定存在。

推荐格式：

```markdown
## 全量接口索引

| 序号 | api_id | 模块 | 接口名称 | Method | Path | 生命周期 | 问题标记 |
|---:|---|---|---|---|---|---|---|
| 3 | goods.agent_goods_core_metrics.v1 | 智能体二期 | 商品核心数据智能体 | POST | `/agent/goods_id/ads_fact_item_summary_d` | candidate |  |
```

#### 字段说明

| 字段 | 是否必填 | 说明 |
|---|---:|---|
| 序号 | 是 | 文档展示顺序，不作为系统主键 |
| api_id | 是 | 稳定唯一 ID，进入 Registry 后不可随意变化 |
| 模块 | 是 | 接口所属模块 |
| 接口名称 | 是 | 中文接口名称 |
| Method | 是 | GET / POST / PUT / DELETE |
| Path | 是 | 接口路径 |
| 生命周期 | 是 | draft / candidate / verified / agent_ready / deprecated / blocked |
| 问题标记 | 否 | 多个问题用中文分号 `；` 分隔 |

#### 最小兼容字段

如果历史导出暂时无法增加全部字段，至少必须包含：

```text
序号
模块
接口名称
Method
Path
问题标记
```

但系统应尽快补齐 `api_id` 和 `生命周期`。

---

### 4.3 接口详情块规范

每个接口详情必须采用固定结构。

````markdown
## 3. POST 商品核心数据智能体

### 基本信息

| 项目 | 内容 |
|---|---|
| api_id | goods.agent_goods_core_metrics.v1 |
| 接口名称 | 商品核心数据智能体 |
| 请求方式 | `POST` |
| 请求路径 | `/agent/goods_id/ads_fact_item_summary_d` |
| 所属模块 | 智能体二期 |
| 生命周期 | candidate |
| 负责人 | data-platform |
| 源文档行号 | 160 |
| 问题标记 |  |

### 接口说明/备注

用于查询商品在指定时间范围内的核心经营指标。

### Query 参数说明

| 名称 | 类型 | 必选 | 中文名 | 说明 | 示例 | 默认值 |
|---|---|---|---|---|---|---|
| goods_id | string | 否 | 商品ID | 平台商品ID | 724180473855 |  |
| start_time | string | 否 | 开始时间 | yyyy-MM-dd | 2026-04-01 |  |
| end_time | string | 否 | 结束时间 | yyyy-MM-dd | 2026-04-07 |  |

### Header 参数说明

| 名称 | 类型 | 必选 | 中文名 | 说明 |
|---|---|---|---|---|
| x-ca-appCodeKey | string | 否 | 认证Key |  |
| x-ca-appCode | string | 否 | 应用Code |  |

### Body 请求格式

```json
{}
```

### 返回格式

```json
{
  "code": "string",
  "msg": "string",
  "data": {
    "result": []
  }
}
```

### 返回字段说明

| 字段路径 | 类型 | 必选 | 中文名 | 语义类型 | 指标ID | 说明 |
|---|---|---|---|---|---|---|
| data.result[].visitors | string | true | 访客数 | metric | metric.visitors | 商品访客数 |
| data.result[].actual_conversion | string | true | 实际转化率 | metric | metric.actual_conversion | 支付转化率 |
| data.result[].statist_date | string | true | 统计日期 | time |  | 日期 |

### 质量标记

| 标记 | 严重级别 | 说明 |
|---|---|---|
| missing_runtime_probe | P1 | 尚未完成真实接口探测 |

### 变更记录

| 日期 | 版本 | 变更人 | 说明 |
|---|---|---|---|
| 2026-06-04 | v1 | system | 初始导出 |
````

---

## 5. api_id 规范

### 5.1 为什么必须引入 api_id

不能使用以下字段作为唯一主键：

| 字段 | 问题 |
|---|---|
| 接口名称 | 可能重复、可能改名 |
| Path | 可能重复、可能带 path placeholder |
| 序号 | 重新导出后可能变化 |
| 模块 | 可能被调整 |
| 源文档行号 | 文档新增内容后会变化 |

因此必须使用稳定的 `api_id`。

---

### 5.2 api_id 命名规则

推荐规则：

```text
{domain}.{capability}.{method_or_variant}.v{version}
```

示例：

```text
goods.agent_goods_core_metrics.v1
keywords.sycm_keyword_trend.v1
competition.pattern_analysis_v3.v1
public_api.category_data_source_relation.get.v1
public_api.category_time_range.post.v1
```

### 5.3 api_id 生成建议

自动生成时可使用：

```text
normalized_module + normalized_method + normalized_path + semantic_suffix
```

但一旦进入 Registry，就必须固定，不允许每次导出重新生成。

### 5.4 重复 Path 处理

对于同一个 Path，不同 Method 或不同语义的接口，必须生成不同 api_id。

```yaml
api_id: public_api.category_data_source_relation.get.v1
method: GET
path: /data/ads_data_source_cate_d

api_id: public_api.category_time_range.post.v1
method: POST
path: /data/ads_data_source_cate_d
```

---

## 6. Canonical API Asset Schema v1

所有 Markdown、OpenAPI、Apifox、人工补充最终都必须编译成以下 Canonical Schema。

```yaml
schema_version: api-asset-card-v1

api_id: goods.agent_goods_core_metrics.v1

doc_source:
  source_file: 智能体数仓完整接口文档_整理版.md
  source_version: api-doc-md-v1
  source_line: 160
  source_anchor:
    heading: "## 3. POST 商品核心数据智能体"
    method_path: "POST /agent/goods_id/ads_fact_item_summary_d"

identity:
  name: 商品核心数据智能体
  module: 智能体二期
  method: POST
  path: /agent/goods_id/ads_fact_item_summary_d
  normalized_path: /agent/goods_id/ads_fact_item_summary_d

request:
  path_params: []
  query_params:
    - name: goods_id
      type: string
      required: false
      cn_name: 商品ID
      description: 平台商品ID
    - name: start_time
      type: string
      required: false
      cn_name: 开始时间
    - name: end_time
      type: string
      required: false
      cn_name: 结束时间
  header_params:
    - name: x-ca-appCodeKey
      type: string
      required: false
    - name: x-ca-appCode
      type: string
      required: false
  body_schema: {}

response:
  status_code: 200
  root_path: data.result[]
  example:
    code: string
    msg: string
    data:
      result: []
  fields:
    - path: data.result[].visitors
      name: visitors
      cn_name: 访客数
      type: string
      semantic_type: metric
      metric_id: metric.visitors
      required: true
    - path: data.result[].actual_conversion
      name: actual_conversion
      cn_name: 实际转化率
      type: string
      semantic_type: metric
      metric_id: metric.actual_conversion
      required: true
    - path: data.result[].statist_date
      name: statist_date
      cn_name: 统计日期
      type: string
      semantic_type: time
      required: true

semantic:
  domain: 商品域
  subdomains:
    - 商品诊断
    - 商品经营分析
    - 老品增长规划
  capability: 商品核心经营指标查询
  entities:
    - Goods
  metrics:
    - metric.visitors
    - metric.actual_conversion
  scenarios:
    - 商品诊断
    - 老品增长
    - 投流复盘

governance:
  lifecycle_status: candidate
  issue_markers: []
  owner_team: data-platform
  quality_score:
    contract_score: 0.85
    response_score: 0.9
    semantic_score: 0.75
    runtime_score: 0.0
    security_score: 0.0
    total_score: 0.72

runtime:
  allow_agent_call: false
  tool_candidates:
    - get_goods_core_metrics
  auth_policy:
    require_app_code: true
  tenant_policy:
    require_tenant_scope: true

lineage:
  source_tables: []
  source_columns: []
  confidence: 0.0
  verified_by: null
```

---

## 7. 语义字段分类规范

返回字段和请求字段必须尽量映射到语义类型。

| 语义类型 | 说明 | 示例 |
|---|---|---|
| entity_id | 实体 ID | goods_id、shop_id、user_id |
| dimension | 分析维度 | shop_name、tertiary_category、keyword |
| metric | 指标 | visitors、pay_sales、click_rate |
| attribute | 属性 | material、main_color、image_words |
| time | 时间字段 | business_date、statist_date、start_date |
| control | 控制参数 | page、size、sort |
| auth | 认证字段 | x-ca-appCode、token |
| tenant | 租户/权限字段 | tenant_id、user_id、shop_id |

### 7.1 字段语义判断规则

```text
1. 字段名包含 id，且指向业务对象，优先判断为 entity_id
2. 字段名包含 date/time，优先判断为 time
3. 字段名表示数值、比例、金额、数量、转化、点击、访客，优先判断为 metric
4. 字段用于筛选、分页、排序，优先判断为 control
5. 字段用于认证或鉴权，判断为 auth
6. 字段用于组织、租户、用户隔离，判断为 tenant
```

---

## 8. 文档变更兼容策略

### 8.1 A 类：安全变化

不会影响 Parser 和 Canonical Schema 的变化。

```text
1. 增加说明文字
2. 增加接口备注
3. 增加调用示例
4. 调整普通段落
5. 增加非关键章节
```

处理方式：

```text
不需要升级 Source Doc Spec
不需要修改 Extractor
不需要变更 Canonical Schema
```

---

### 8.2 B 类：兼容变化

需要升级 Extractor Adapter，但不破坏 Canonical Schema。

```text
1. 表格增加新列
2. 参数字段说明增加“默认值”
3. 返回字段说明增加“示例值”
4. 接口详情增加“错误码说明”
5. 模块名称轻微调整
6. 标题文案轻微调整，例如“返回字段说明”改为“响应字段说明”
```

处理方式：

```text
Extractor Adapter 升级小版本
增加 Golden Sample
保持 Canonical Schema 不变
```

---

### 8.3 C 类：破坏变化

必须走变更评审。

```text
1. 全量接口索引表被删除
2. Method / Path 字段改名或缺失
3. 接口详情标题规则彻底变化
4. 参数字段说明表结构彻底变化
5. 返回字段说明不再使用表格或 JSON code block
6. api_id 规则变化
7. 同一个 method + path 指向不同业务语义
8. agent_ready 接口的 input/output 发生破坏性变化
```

处理方式：

```text
发起 Source Contract Change Review
更新 Source Doc Spec
更新 Extractor Adapter
更新 Golden Test
生成 Canonical Diff
评估 Tool Registry / KG / Agent 能力影响
通过后发布
```

---

## 9. Extractor 设计规范

Extractor 不应写死 Markdown 的某一处格式，而应采用多信号解析。

### 9.1 接口索引解析规则

优先级：

```text
1. 读取 YAML Front Matter，确认 spec_version
2. 定位“全量接口索引”标题
3. 找包含 Method / Path / 接口名称 的表格
4. 解析所有接口行
5. 生成 raw_api_index
6. 校验 method / path / name / module 是否存在
```

### 9.2 接口详情解析规则

优先级：

```text
1. 通过 "## {序号}. {METHOD} {接口名称}" 定位接口块
2. 使用 method + path 与索引表对齐
3. 解析“基本信息”表
4. 解析 Query / Header / Body / Path 参数
5. 解析 JSON code block 作为 response example
6. 解析“返回字段说明”表
7. 合并生成 ApiAssetCard
```

### 9.3 容错规则

Extractor 必须支持：

```text
1. 标题轻微变化
2. 参数字段仍混在一张表里
3. 返回为空 {}
4. 字段说明缺失
5. 重复 path
6. 表格列增加
7. 非关键章节插入
```

对于无法解析的内容，不应直接丢弃，而应进入：

```yaml
raw_extra:
  unparsed_blocks: []
  unknown_columns: []
  warnings: []
```

---

## 10. 质量 Gate

每次文档更新后，必须跑以下 Gate。

### 10.1 Gate 1：Source Contract Gate

检查源文档是否符合 Source API Doc v1。

必须存在：

```text
spec_version
全量接口索引
Method
Path
接口名称
至少一个接口详情
```

失败处理：

```text
阻断进入后续链路
要求数据团队修复源文档
```

---

### 10.2 Gate 2：Parse Coverage Gate

检查解析覆盖率。

建议标准：

```text
接口索引解析数量 >= 95%
接口详情匹配数量 >= 90%
method/path 缺失数量 = 0
```

如果历史文档预计有 175 个接口，则第一版可设置：

```text
api_index_count >= 170
api_detail_matched_count >= 150
```

---

### 10.3 Gate 3：Canonical Schema Gate

检查每个接口是否能生成 Canonical ApiAssetCard。

必须字段：

```text
api_id
name
method
path
module
request
response
quality
lifecycle_status
```

失败处理：

```text
缺少核心字段的接口降级为 draft
draft 接口不能进入 Tool Registry
```

---

### 10.4 Gate 4：Diff Gate

比较新旧版本差异。

必须输出：

```text
新增接口
删除接口
Method 变化
Path 变化
请求参数变化
返回字段变化
问题标记变化
生命周期变化
```

高风险变更：

```text
1. agent_ready 工具底层 API path 变化
2. 返回字段删除
3. 指标字段中文名变化
4. 必填参数增加
5. 租户/权限字段缺失
```

---

### 10.5 Gate 5：Downstream Impact Gate

检查影响范围。

必须输出：

```text
影响哪些 ApiAssetCard
影响哪些 Tool
影响哪些 KG edge
影响哪些 Golden Case
影响哪些 Agent 能力
```

示例：

```text
/agent/goods_id/ads_fact_item_summary_d 返回字段 main_click 删除
    -> 影响 metric.main_click
    -> 影响 get_goods_core_metrics
    -> 影响商品诊断 Agent 的主图点击率分析
    -> 需要更新 golden case
```

---

## 11. 源文档与 Canonical JSON 双轨维护

建议每次接口文档发布都包含两份文件：

```text
1. api_doc.md
   给人读，保留说明、表格、示例

2. api_catalog.canonical.json
   给机器读，稳定结构，进入执行链路
```

`api_doc.md` 可以变化，但 `api_catalog.canonical.json` 必须通过 Schema Validation。

Canonical JSON 示例：

```json
{
  "schema_version": "api-asset-card-v1",
  "source": {
    "file": "智能体数仓完整接口文档_整理版.md",
    "generated_at": "2026-06-04"
  },
  "apis": [
    {
      "api_id": "goods.agent_goods_core_metrics.v1",
      "name": "商品核心数据智能体",
      "module": "智能体二期",
      "method": "POST",
      "path": "/agent/goods_id/ads_fact_item_summary_d",
      "request": {
        "query_params": [
          {
            "name": "goods_id",
            "type": "string",
            "required": false
          }
        ]
      },
      "response": {
        "root_path": "data.result[]",
        "fields": [
          {
            "path": "data.result[].visitors",
            "name": "visitors",
            "cn_name": "访客数",
            "semantic_type": "metric"
          }
        ]
      },
      "quality": {
        "issue_markers": [],
        "total_score": 0.72
      },
      "lifecycle_status": "candidate"
    }
  ]
}
```

---

## 12. 生命周期规范

### 12.1 API 生命周期

| 状态 | 说明 | 是否可进入 Tool Registry |
|---|---|---:|
| draft | 文档存在，但信息不完整 | 否 |
| candidate | 结构完整，但未验证 | 可作为候选 |
| verified | 已跑通，有样例，有字段解释 | 可进入内部工具 |
| agent_ready | 可被 Agent 调用，有权限策略和测试 | 是 |
| deprecated | 废弃，不推荐新场景使用 | 否 |
| blocked | 存在严重安全/质量问题 | 否 |

### 12.2 agent_ready 准入条件

必须满足：

```text
1. api_id 稳定
2. request_schema 完整
3. response_schema 完整
4. 字段语义分类完成
5. 核心指标进入 Metric Dictionary
6. 权限和租户策略明确
7. 有至少一个 runtime probe 样例
8. 有至少一个 golden case
9. quality_score >= 0.85
10. 数据团队确认口径
```

---

## 13. 版本策略

### 13.1 Source Doc Spec 版本

```text
api-doc-md-v1
api-doc-md-v1.1
api-doc-md-v2
```

规则：

```text
1. 非破坏性增加字段，升级小版本
2. 标题/表格结构破坏性变化，升级大版本
```

### 13.2 Canonical Schema 版本

```text
api-asset-card-v1
api-asset-card-v1.1
api-asset-card-v2
```

规则：

```text
1. 增加可选字段，升级小版本
2. 删除字段或修改字段语义，升级大版本
```

### 13.3 Tool Registry 版本

```text
tool-registry-v1
tool-registry-v1.1
tool-registry-v2
```

规则：

```text
1. Tool input/output 发生变化，必须升级版本
2. 底层 API 替换但 Tool contract 不变，只升级 patch
```

---

## 14. 文档变更流程

任何 Source Doc Spec 或 Canonical Schema 变更，必须走以下流程：

```text
1. 提交变更说明
2. 修改 Source Doc Spec 或 Canonical Schema
3. 更新 Parser Adapter
4. 增加 Golden Markdown Sample
5. 跑 Parse Coverage Test
6. 生成 Canonical JSON Diff
7. 跑 Tool Registry Impact Test
8. 跑 API QA Golden Case
9. 跑 Tool Selection Golden Case
10. 数据团队和 Agent 团队共同评审
11. 合并发布
```

### 14.1 变更说明模板

```markdown
# Source Contract Change Request

## 变更类型

- [ ] 安全变化
- [ ] 兼容变化
- [ ] 破坏变化

## 变更原因

说明为什么需要变更。

## 影响范围

- 影响接口数：
- 影响 ApiAssetCard：
- 影响 Tool：
- 影响 KG：
- 影响 Golden Case：

## 兼容策略

说明旧版本如何兼容。

## 回滚策略

说明变更失败后如何回滚。
```

---

## 15. 团队分工

| 事项 | 数据团队 | Agent / 平台团队 |
|---|---|---|
| Markdown 源文档导出 | 负责 | 协助定义规范 |
| API 真实含义确认 | 负责 | 消费 |
| 指标口径确认 | 负责 | 映射到 Metric Dictionary |
| 接口质量问题确认 | 负责 | 自动发现问题 |
| Source Doc Spec | 共同定义 | 共同定义 |
| Parser / Extractor | 参与验证 | 负责实现 |
| Canonical Schema | 共同定义 | 负责维护 |
| Tool Registry | 审核准入 | 负责封装 |
| Knowledge Graph | 确认血缘 | 负责构建 |
| Golden Case | 提供样例 | 自动化测试 |
| 变更影响分析 | 共同评审 | 自动生成 |

---

## 16. 内部红线

以下规则应写入 AGENTS.md 和工程 CI：

```text
1. Agent Runtime 不直接读取 Markdown。
2. Markdown 只作为 source，不作为 runtime contract。
3. api_id 一旦进入 Tool Registry，不允许随意变化。
4. agent_ready 接口的 input/output 变化必须走变更评审。
5. 返回字段缺失、返回示例为空、路径重复的接口不能进入 agent_ready。
6. 每次文档更新必须生成 canonical diff。
7. 每次 canonical diff 必须跑 API QA 和 Tool Selection 的 golden case。
8. 废弃接口不能删除，只能标记 deprecated，并保留兼容期。
9. 指标字段必须映射到 Metric Dictionary 后，才能用于 Agent 业务推理。
10. 所有 Tool 必须能解释来源 API、返回字段、指标口径和质量状态。
```

---

## 17. MVP 落地建议

### 17.1 第一阶段：保留当前 Markdown 结构

```text
1. 保留现有接口索引表
2. 保留接口详情块
3. 增加 YAML Front Matter
4. 全量索引增加 api_id / 生命周期
5. 接口详情增加 api_id / 质量标记 / 变更记录
```

### 17.2 第二阶段：生成 Canonical JSON

```text
1. Markdown Extractor 解析源文档
2. 生成 api_catalog.raw.json
3. 标准化为 api_catalog.canonical.json
4. 生成 api_quality_report.md
5. 生成 canonical diff
```

### 17.3 第三阶段：下游链路只依赖 Canonical JSON

```text
1. ApiAssetCard Registry 从 canonical JSON 读取
2. Domain Mapping 从 canonical JSON 读取
3. Tool Registry 从 canonical JSON 读取
4. Knowledge Graph 从 canonical JSON 和 Mapping 生成
5. Pi Runtime Tool 不读取 Markdown
```

---

## 18. 推荐项目文件结构

```text
db-archaeologist/
  docs/
    source-doc-spec/
      API_DOC_MD_V1.md
      CHANGE_REQUEST_TEMPLATE.md
    canonical-schema/
      API_ASSET_CARD_V1.md

  sources/
    api_docs/
      智能体数仓完整接口文档_整理版.md

  registry/
    api_catalog.raw.json
    api_catalog.canonical.json
    api_catalog.diff.json
    api_quality_report.md
    domain_taxonomy.yaml
    metric_dictionary.yaml
    tool_registry.yaml
    knowledge_graph.jsonl

  src/
    extractors/
      markdown_api_extractor.ts
    validators/
      source_contract_validator.ts
      canonical_schema_validator.ts
      diff_gate.ts
      downstream_impact_gate.ts

  tests/
    golden_docs/
      api_doc_md_v1_sample.md
    golden_cases/
      api_qa_cases.yaml
      tool_selection_cases.yaml
```

---

## 19. 最终结论

这个规范的核心不是限制数据团队不能改文档，而是要建立稳定的资产发布协议：

```text
允许源文档演进
但必须通过 Source Contract Gate

允许导出格式调整
但必须通过 Extractor Adapter 转成 Canonical Schema

允许接口新增和废弃
但必须通过 Canonical Diff 和 Downstream Impact Gate

允许 Agent 使用 API
但只能使用 agent_ready 的 Tool，而不能直接猜接口
```

最终落地形态：

```text
Source API Doc Spec
    ↓
Extractor Adapter
    ↓
Canonical API Asset Schema
    ↓
ApiAssetCard Registry
    ↓
Domain Mapping
    ↓
Metric Dictionary
    ↓
Tool Registry
    ↓
Knowledge Graph
    ↓
Pi Runtime Tools
    ↓
API 问答 + Agent 自动选工具
```

只要这条链路稳定，哪怕未来 Apifox 导出格式变化、Markdown 章节调整、表格多几列、接口名称调整，只要能重新编译到稳定的 Canonical API Asset Schema，后续 ApiAssetCard、Domain Mapping、Tool Registry、Knowledge Graph、API 问答和 Agent 自动选工具就不会被连带击穿。
