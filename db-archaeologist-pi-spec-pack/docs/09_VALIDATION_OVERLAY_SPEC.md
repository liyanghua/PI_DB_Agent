# Validation Overlay Specification

## 1. 目的与边界

### 1.1 价值

Validation Overlay 是一份「真值参数 + 真实可调通 URL」的旁路数据层，从 `docs/data_api/智能体数仓完整接口文档_全量验证版.md` 提取，叠加到 `ApiAssetCard.verified_call` 字段上。

它解决的问题：
- markdown 主链解析的 `request_schema` 是文档声明，与生产实际入参偏差大（如类目入参字段名 `category_id` vs `tertiary_category`、身份注入位置 query vs body）。
- 6 个 P0 关键词接口在 real Terminal LIVE_PROBE 下 100% 返回 `code=1 / NPE / data:null`，根因是上述偏差。
- 需要一份「人工调通过」的真值清单，作为运行时拼请求的优先依据。

### 1.2 边界

- **不替换** markdown 主链：`integrated.md` → `markdown_api_extractor` + `markdown_detail_extractor` → `api_index_seed.json` + `api_details.raw.json` 的链路保持原样。
- **不动 lifecycle**：overlay 只挂 `verified_call` 字段，不读 lifecycle、不改 quality_score。
- **命中即覆盖运行时**：`api_runtime.assembleRequest` 在 overlay 命中时，URL/body/auth 全走 `verified_call`；未命中时完全走旧分支。
- **零成本回滚**：`SKIP_VALIDATION_OVERLAY=1` 让 build_cards 不读 overlay JSON，所有卡退回 legacy 行为。

### 1.3 不在本规范范围

- lifecycle 升级策略（success → verified）：另写 plan。
- markdown 主链文档格式契约：见 [API_Doc_Source_Contract_and_Canonical_Schema_Spec.md](API_Doc_Source_Contract_and_Canonical_Schema_Spec.md)。
- contract probe runner（自动维护 `last_verified_at`）：P1 阶段。

## 2. 全量验证版.md 文档契约 v1

### 2.1 文件位置与命名

主入口：`docs/data_api/智能体数仓完整接口文档_全量验证版.md`

文件名固定，不进入 `sources/api_docs/_inbox/` ingest 主链。版本演进通过 git 历史追溯，不归档到 `_archive/`。

### 2.2 表头精确匹配

文档必须包含以下精确表头（顺序、列数、文字一字不差）：

```
| 序号 | 模块 | 业务模块 | 分析域 | 接口名称 | 方法 | 原URL/Path | 修复后状态 | 修复后可用URL | 修复后入参 | 说明/验证信息 |
```

下一行为 markdown 表格分隔行：`|------:|------|...|`

`extract_validation_overlay.ts` 启动时硬校验上述表头，不匹配则 `process.exit(1)`。

### 2.3 数据起始位置

表头位于 `## 🎯 所有接口列表（修复后验证结果）` 之后第 1 行。

数据从表头分隔行的下一行开始；遇到下一个二级标题（`## ` 或 `# ` 开头）即终止。

### 2.4 列内嵌管道符规则

- `原URL/Path` 列必须用反引号包裹（如 `` `/agent/sycm_keyword` ``）。
- `修复后入参` 列必须用反引号包裹（如 `` `{"tertiary_category":"入户地垫"}` ``）。
- 这两列内容若包含 `|`，必须出现在反引号内；解析器按「反引号外的 `|`」切列。
- 其他列纯文本，禁止出现 `|`。

### 2.5 修复后状态枚举

`修复后状态` 列必须为以下 5 种之一（emoji 必须保留）：

| 文档值 | overlay 映射 | 含义 |
|---|---|---|
| `✅ 成功` | `success` | 调通且返回非空数据 |
| `✅ 成功但空数据` | `empty` | 调通但 `result=[]` |
| `❌ 业务失败` 或 `❌ 业务失败/请求失败` | `business_failed` | code=1 或 5xx，业务侧故障 |
| `🔒 无法测试` | `untestable` | 路径含占位符或非法路径 |
| `❌ 业务失败（appCodeKey 无权限）` | `unauthorized` | code=10504，appCodeKey 不授权 |

`unauthorized` 由 `extract_validation_overlay.ts` 通过 `修复后状态 + 说明/验证信息` 联合识别（说明里含 `Incorrect signature` 或 `appCodeKey does not authorize`）。

### 2.6 修复后可用URL 格式

完整绝对 URL，必须满足：

- 协议为 `http://` 或 `https://`
- host 部分（如 `122.227.49.54:30404`）与 `.env` 的 `ZICHEN_HOST` 派生值一致或可派生
- path 包含 `/openApi/api/<appId>/5/...` 前缀（少量历史接口可能 `/data/...`，列入 parse_warning 但不阻断）
- query 至少包含 `userId=` 与 `tenantId=`（这两个参数推导出 `auth_inject_policy.style = "query_camel"`）

### 2.7 修复后入参 格式

合法 JSON 对象字面量，使用反引号包裹：

```
`{"tertiary_category":"入户地垫"}`
```

允许：
- 顶层为对象 `{}`，可为空对象 `{}`
- 字符串值含中文（必须是 UTF-8 直写，不允许 `\uXXXX` 转义）
- 数字、布尔、字符串混合
- 字符串里允许包含被反引号转义过的内容（实际不允许嵌套反引号）

不允许：
- 数组顶层 `[]`
- 注释 `//` 或 `/* */`
- 单引号字符串
- 尾随逗号

### 2.8 序号一致性

`序号` 列对应 markdown 主链的 `source_seq`，跳号允许（如全量验证版只覆盖 2..175 子集）。

同一序号在文档中只能出现一次。

## 3. Overlay JSON Schema

### 3.1 输出位置

`registry/derived/api_validation_overlay.json`

由 `scripts/extract_validation_overlay.ts` 生成，不允许手编。

### 3.2 顶层结构

```yaml
generated_at: string                  # ISO 8601
source_path: string                   # "docs/data_api/智能体数仓完整接口文档_全量验证版.md"
source_sha256: string                 # 文档 SHA-256
source_line_count: number
table_header_line_no: number          # 表头所在行号（1-based）
entries_total: number
entries_parsed: number                # 成功解析数
entries_failed: number                # parse_failure 数
status_distribution:
  success: number
  empty: number
  business_failed: number
  unauthorized: number
  untestable: number
entries: ValidationEntry[]
parse_failures: ParseFailure[]        # 详见 §4
```

### 3.3 ValidationEntry

每条对应一行（一个接口）。字段顺序固定：

```yaml
api_id: string                        # 由 pathToApiId(canonicalizePath(原URL/Path)) 派生
source_seq: number                    # 文档"序号"列
source_line_no: number                # 该行在文档中的行号
module: string                        # 文档"模块"列
business_module: string               # 文档"业务模块"列
analysis_domain: string               # 文档"分析域"列
name: string                          # 文档"接口名称"列
method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
path_raw: string                      # 文档"原URL/Path"原值（含反引号去除后）
path_canon: string                    # canonicalizePath 结果
base_url_segment: string              # "修复后可用URL" 中 host 之后到 path 末尾的前缀，如 "/openApi/api/1958050182385065986/5"
url_template: string                  # base_url_segment 之后的剩余 path + query 模板
verified_url_full: string             # 文档原值，便于人工溯源
body_template: object                 # 文档"修复后入参" JSON.parse 结果
auth_inject_policy:
  style: "query_camel" | "body_snake"
  identity_keys: [string]             # 从 verified_url_full 的 query 提取，默认 ["userId","tenantId"]
  headers_required: [string]          # 默认 ["x-ca-appCodeKey","x-ca-appCode"]，值由 runtime 从 env 注入
verified_status: "success" | "empty" | "business_failed" | "unauthorized" | "untestable"
verified_code: string?                # 从"说明/验证信息"提取（如 "200"、"1"、"10504"）
verified_msg: string?                 # 从"说明/验证信息"提取（如 "成功"、"NPE"）
fix_note: string?                     # 从"说明/验证信息"提取的修复备注
last_verified_at: null                # 本期固定 null，留给 contract probe
```

### 3.4 ParseFailure

```yaml
source_line_no: number
raw_line: string                      # 原始行（截断到 500 字符）
failure_type: "column_count_mismatch" | "url_unparseable" | "body_json_unparseable" | "status_emoji_unknown" | "api_id_collision" | "method_unknown"
message: string                       # 详细错误
```

### 3.5 与 ApiAssetCard.verified_call 的字段映射

`build_cards.ts` leftJoin 时，把 ValidationEntry 的以下字段拷贝到 `card.verified_call`：

| ValidationEntry | ApiAssetCard.verified_call |
|---|---|
| `base_url_segment` | `base_url_segment` |
| `url_template` | `url_template` |
| `body_template` | `body_template` |
| `auth_inject_policy` | `auth_inject_policy` |
| `verified_status` | `verified_status` |
| `verified_code` | `verified_code` |
| `verified_msg` | `verified_msg` |
| `fix_note` | `fix_note` |
| `source_seq` | `source_seq` |
| `source_line_no` | `source_line_no` |
| `last_verified_at` | `last_verified_at` |

`api_id`、`module`、`name`、`method`、`path_canon` 不进 `verified_call`，因为这些字段已由 markdown 主链生成；overlay 只补「运行时如何调通」的部分。

## 4. 解析与错误处理

### 4.1 解析器入口

`src/extractors/markdown_validation_overlay_extractor.ts`：

```ts
export type ExtractResult = {
  meta: { source_sha256, source_line_count, table_header_line_no, ... };
  entries: ValidationEntry[];
  failures: ParseFailure[];
};

export function extractValidationOverlay(markdown: string): ExtractResult;
```

入口脚本 `scripts/extract_validation_overlay.ts` 读 markdown → 调 extractor → 写 JSON + report.md。

### 4.2 五类 parse_failure

| failure_type | 触发条件 | 行为 |
|---|---|---|
| `column_count_mismatch` | 反引号外的 `\|` 切列后列数 ≠ 11 | 跳过该行，写 failures |
| `url_unparseable` | 修复后可用URL 无法 `new URL()` 解析，或 host/path 不符合 §2.6 | 跳过该行 |
| `body_json_unparseable` | 修复后入参 反引号内容 `JSON.parse` 抛错 | 跳过该行 |
| `status_emoji_unknown` | 修复后状态 不在 §2.5 五种枚举内 | 跳过该行 |
| `method_unknown` | 方法 列不在 GET/POST/PUT/DELETE/PATCH | 跳过该行 |
| `api_id_collision` | 见 §5.2 | 保留首条，其余写 failures |

### 4.3 报告产物

`registry/derived/api_validation_overlay_report.md` 必含：

- 顶部摘要：源文件 sha256 / 总行数 / 解析成功数 / 失败数 / 状态分布
- 失败明细表：每条 failure 一行，含 `source_line_no`、`failure_type`、`message`
- 命中统计（由 build_cards 在 leftJoin 后追加更新）：`overlay_hit / overlay_miss / overlay_orphan`
  - `overlay_hit`：cards 与 overlay 都有，verified_call 已挂上
  - `overlay_miss`：cards 有但 overlay 没有（159 - hit）
  - `overlay_orphan`：overlay 有但 cards 找不到对应 api_id（极少数，可能是文档外接口）

### 4.4 失败容忍度

- extractor 单行失败不阻塞整体生成。
- 仅当 `entries_parsed < 100` 时（兜底阈值），`extract_validation_overlay.ts` 整体 `process.exit(1)`，触发 rebuild_all 失败。
- `validate_validation_doc.ts`（前置硬检查）失败直接退出。

## 5. Join 策略

### 5.1 主键

```ts
api_id = pathToApiId(canonicalizePath(entry.path_raw))
```

复用 [src/normalizers/path_canon.ts](../src/normalizers/path_canon.ts) 既有逻辑，确保与 markdown 主链的 api_id 命名空间一致。

### 5.2 同 api_id 多行处理

文档允许同一接口多次出现（如序 127 与 128 同 path），按以下优先级保留首条：

1. `verified_status` 优先级：`success` > `empty` > `unauthorized` > `business_failed` > `untestable`
2. 同 status 下：`source_seq` 较小的优先

未保留的行写入 `parse_failures` with `failure_type = "api_id_collision"`，报告里 WARN 提示「同 api_id 已有 entry，本行被忽略」。

### 5.3 leftJoin 行为

`build_cards.ts` 主循环：

```
for each card in cards:
  entry = overlay.entries.find(e => e.api_id === card.api_id)
  if entry: card.verified_call = pickVerifiedCallFields(entry)
```

`overlay_orphan` 仅写 report，不阻塞构建（可能是文档列了但 markdown 主链未收录的接口，需要后续处理）。

### 5.4 不动的字段

leftJoin **不修改** card 的：
- `path` / `method` / `name` / `module` / `domain` / `capability`
- `request_schema` / `response_schema`
- `lifecycle_status` / `quality_score`
- `entity_mapping` / `metric_mapping` / `domain_mapping`
- `issue_marker` / `issues`

唯一新增字段：`verified_call`。