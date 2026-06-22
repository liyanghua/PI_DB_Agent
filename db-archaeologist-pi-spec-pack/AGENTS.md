# AGENTS.md — DB Archaeologist Agent AI-coding 规则

## 1. 项目定位

本项目只做 DB/API Archaeologist Agent，不做完整 BI 平台，不直接改生产接口。

MVP 目标：把 `智能体数仓完整接口文档_整理版.md` 编译为可被 Agent 使用的 API/Tool/KG 资产库。

### 1.1 KOIF 与 archaeology 边界（Phase 3 起）

KOIF 评分能力（KDS / TMS / CPS / PVS / CES / PFS / NOS / BDS）属于 archaeology 的纵向延伸：从「这词怎么样」延伸到「这词强不强、热不热、卷不卷」。这一层留在 spec-pack 内，按 [docs/14_KOIF_NAMESPACE_OVERVIEW.md](docs/14_KOIF_NAMESPACE_OVERVIEW.md) §2 落 capability。

CPS 子分数采用复合双源：投流域 (`data_cust_ads_ad_flow_plan_goods_keyword_7d`) 提供 CPC 的关键词级原生数据；竞争域 (`data_competition_pattern_analysis`) 是商品级 raw，需在 normalize 层按 `tertiary_category` 聚合到类目级 `competition_index` / `brand_concentration` 后广播到该类目下所有关键词 record。详见 [docs/20 §2/§3](docs/20_KEYWORD_COMPETITION_PACK_SPEC.md) 与 [docs/18 §3.2.2](docs/18_KEYWORD_FIELD_MAPPING_SPEC.md) `aggregation` 块。

带预算 / ROI / 出价 / 进退场 / 时序计划等**决策性输出**不属于 archaeology 边界，走 sibling namespace `koif_decision_layer`，物理形态见 [docs/19_KOIF_DECISION_LAYER_SPEC.md](docs/19_KOIF_DECISION_LAYER_SPEC.md)。spec-pack 内的 KOIF Router (`propose_koif_strategy`) 只输出**中性 ranking actions**（如「以下词是付费投放候选名单」），不出现具体预算金额、ROI 阈值、跑量周期等决策语。

判定原则：客观可观测、可复算、不依赖商家成本结构 → 留 spec-pack；含主观假设、预算分摊、机会成本 → 走 decision_layer。

Phase 3 完成情况、Core Lock 不变量、风险登记的单一真相归 [docs/21_PHASE_3_COMPLETION_AND_RISK_SPEC.md](docs/21_PHASE_3_COMPLETION_AND_RISK_SPEC.md)；真机三件套执行节奏归 [docs/PHASE_3_LIVE_PROBE_SOP.md](docs/PHASE_3_LIVE_PROBE_SOP.md)。

## 2. 硬性边界

- 不允许把未验证 API 直接标记为 `agent_ready`。
- 不允许 Agent 直接在 175 个原始接口里自由选择，必须通过 Tool Registry。
- 不允许把 `返回示例为空对象`、`返回字段说明为空`、`返回示例乱码` 的接口直接发布为 Agent Tool。
- 不允许真实 token、appCodeKey、secret、生产账号写入 repo。
- 不允许在未通过 golden case 前修改领域映射规则。
- 不允许把 API 文档当成唯一真相；运行时 probe、研发确认、调用日志优先级更高。

## 3. 资产状态定义

- `raw`: 只从源文档解析出来。
- `draft`: 有接口基础信息，但缺 schema/样例/字段说明/质量较低。
- `candidate`: 基础契约完整，可进入人工复核。
- `verified`: 已有样例、字段解释、质量分合格。
- `agent_ready`: 已有 Tool 封装、权限策略、contract test、golden case。
- `deprecated`: 不推荐新使用。
- `blocked`: 有安全、权限、数据质量、路径冲突等硬阻塞。

## 4. 每次 AI-coding 修改必须输出

- 修改了哪些文件。
- 增加/更新了哪些 schema 或 registry。
- 是否影响 Tool Registry。
- 是否影响领域映射规则。
- 是否补充测试。
- 当前未解决风险。

## 5. 优先实现顺序

P0:

- Markdown API extractor
- ApiAssetCard schema validator
- Domain Mapper
- API QA retrieval
- Tool selector rule baseline

P1:

- Tool Registry publisher
- Knowledge Graph triple builder
- Pi custom tools / extension
- Contract probe runner

P2:

- 向量检索/混合检索
- 图数据库落地
- API runtime health monitor
- 自动生成 OpenAPI/MCP tools

## 6. 测试要求

所有核心能力必须有 golden case：

- `API 问答`：输入中文问题，返回候选 API/Tool。
- `Agent 自动选工具`：输入业务任务，返回工具链、参数缺口、风险。
- `资产卡生成`：输入 Markdown section，输出 ApiAssetCard。
- `质量打分`：有空返回/重复路径/字段缺失的接口必须降级。

## 7. Pi 运行时约定

- spec-pack 即 pi 工作目录。`.pi/extensions/db_archaeologist.extension.ts` 注册 6 个 custom tool，按相对路径直连 `src/tools/*` → `src/services/*`，禁止再调 npm 包。
- `.pi/skills/db-archaeologist/SKILL.md` 是默认 skill；新场景按其调用顺序补齐：先 `ask_api_catalog`/`select_tools_for_task`，必要时再 `get_api_asset_card` / `explain_tool_lineage` / `list_domain_apis` / `list_api_quality_issues`。
- 工具默认禁止 fs 写、禁止外网。要发真实 API 探活，需要显式 `LIVE_PROBE=true`，且只能在 contract probe runner 里发起。
- 本地无 pi 依赖时用 `DBA_PI_SMOKE=1 npm run smoke:pi` 走 `scripts/typebox_stub.mjs`；任何 PR 必须保证该命令与 `npm run test:golden` 双绿。

## 8. 工具链约束

- Node ≥ 22.6，统一 `node --import ./scripts/ts_loader.mjs <file.ts>` 启动；类型导入用 `import type`。
- 不引入 npm 依赖；YAML/Schema 用 `src/lib/yaml_lite.ts` 与 `src/lib/schema.ts`。
- 派生产物只写 `registry/derived/`；`registry/*.locked.yaml` 是只读权威；`registry/seed/api_index_seed.json` 现为 derived seed，由 `extract:index` 重生，不要手编。
- `registry/keyword_field_mapping.yaml` 修订纪律：必须按 [docs/18_KEYWORD_FIELD_MAPPING_SPEC.md](docs/18_KEYWORD_FIELD_MAPPING_SPEC.md) §5 的 5 步 SOP 执行（提取真机参数 → 备份到 `registry/_archive/keyword_field_mapping.<YYYYMMDD-HHmm>.yaml` → 改 mapping 1:1 对齐 → 真机单接口 probe → golden GREEN）。禁止直接 commit 而不备份。新增 mapping schema 字段时 [docs/18_KEYWORD_FIELD_MAPPING_SPEC.md](docs/18_KEYWORD_FIELD_MAPPING_SPEC.md) §3 / [src/services/keyword_demand/types.ts](src/services/keyword_demand/types.ts) `KeywordFieldMappingApi` / [src/services/keyword_demand/live_pull.ts](src/services/keyword_demand/live_pull.ts) 渲染逻辑三处必须同步。

## 9. 源文档更新流程

主入口文件名固定为 `sources/api_docs/智能体数仓完整接口文档_整理版.md`。新版按以下步骤进库：

1. 把新文件放进 `sources/api_docs/_inbox/`（命名随意，自动选 mtime 最新）。
2. 跑 `npm run ingest:rebuild`（= `scripts/ingest_source.ts` → `scripts/rebuild_all.ts`）。
3. `ingest_source.ts` 校验大小 ≥ 100KB 且头部含 `# 智能体数仓完整接口文档`，把当前主入口归档到 `sources/api_docs/_archive/<YYYYMMDD-HHmm>.md`，同时在 `_archive/INDEX.md` 追加 `size/sha256/replaced_at` 一条记录。
4. `rebuild_all.ts` 跑 9 个 stage：`snapshot:prev → extract:detail → extract:index → build:cards → source:diff → build:tools → build:kg → promote:plan → test:golden`。
5. 看 `registry/derived/source_diff_report.md` 确认 added/removed/path_renamed/domain_changed；若 removed 项被 `tool_registry.yaml` 引用会给 WARN（report-only，不阻塞）。
6. 看 `registry/derived/rebuild_report.md` 确认每个 stage `✓`，golden 仍 GREEN。

环境开关：`SKIP_EXTRACT=1` `SKIP_INDEX=1` `SKIP_DIFF=1` `SKIP_PROMOTION=1` `SKIP_GOLDEN=1`。

回滚：从 `sources/api_docs/_archive/<ts>.md` 拿回旧文件覆盖主入口，重跑 `npm run rebuild:all`。

如果 rebuild 后 domain 分类破坏 golden，去 `registry/domain_mapping.locked.yaml` 加 override，不要回退 `extract:index`。