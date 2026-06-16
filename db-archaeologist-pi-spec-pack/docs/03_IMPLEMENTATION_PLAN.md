# Implementation Plan — 4 周 MVP（实际偏差注释）

> 本文件保留原始 4 周节奏作为目标参考；每个 Week 末附「实际产出与偏差」。代码版本以 `MANIFEST.md` 与 `registry/derived/*` 为准。

## Week 1：文档解析与资产卡

目标：从 Markdown 创建 ApiAssetCard。

任务：

- 实现 Markdown index parser。
- 实现 API detail section parser。
- 实现 ApiAssetCard schema validator。
- 生成 `api_asset_cards.raw.json`。
- 生成质量问题报告。

验收：

- 175 条接口索引可解析。
- 能识别 issue_marker。
- 能生成每个接口的基础资产卡。

**实际产出**

- 真实 detail section 数 = 160（不是 175），index seed 159 行；详见 `registry/derived/api_parse_report.md`。
- `src/extractors/markdown_detail_extractor.ts` 输出 `registry/derived/api_details.raw.json`，0 hard fail / 60 partial（绝大多数缺响应字段表）。
- 因 sandbox 无法 `npm install`，自带 `src/lib/{yaml_lite,schema}.ts` 替代 ajv/yaml；schema 校验仍按 `specs/schemas/api_asset_card.schema.json`。
- 入口经 `node --import ./scripts/ts_loader.mjs` 启动，原生 TS 剥离，无 tsx。

## Week 2：Domain Mapping + Tool Registry Seed

目标：把 API 从“路径列表”变成“业务能力列表”。

任务：

- 实现 rule-based domain mapper。
- 实现 field semantic classifier。
- 生成 `domain_mapping.yaml`。
- 生成 `tool_registry.seed.yaml`。
- 建立 10 个 MVP Tool 定义。

验收：

- 商品/关键词/竞争/投流/类目/任务等主域可正确识别。
- 空返回、字段缺失接口不会进入 agent_ready。

**实际产出**

- `src/normalizers/domain_mapper.ts` 升级为 v2：输出 `{domain, evidence[], confidence, locked}`，与 `registry/domain_mapping.locked.yaml` 合并。
- `src/normalizers/field_semantic_classifier.ts` 把字段映射到 `registry/metric_dictionary.seed.yaml` 别名集；159 张卡里 143 张完成 entity+metric mapping。
- `src/normalizers/quality_scorer.ts` 实现 7 因子加权（contract/response/example/semantic/lineage/runtime/security），runtime 缺 probe 时记 0.5 中性。
- `src/pipelines/build_tools.ts` 输出 `registry/derived/tool_registry.yaml`：5 manual + 13 auto = 18 工具；103 条 API 因质量阈值（`<0.75` 或非 verified/agent_ready 状态）进 `tool_blocked.yaml`。

## Week 3：API QA + 自动选工具

目标：支持核心问答和工具选择。

任务：

- 实现 `ask_api_catalog`。
- 实现 `select_tools_for_task`。
- 实现 query rewrite。
- 实现 quality-aware rerank。
- 补 golden cases。

验收：

- 10 条 API 问答 golden case 通过。
- 5 条自动选工具 golden case 通过。

**实际产出**

- `src/services/{registry,qa,selector,lineage}.ts` 是单一真相；`src/tools/*` 退化为 zod-free 薄壳（参数透传 + 服务调用 + 契约包装）。
- QA 引入 query_rewrite（中文同义词 / 词典扩展）+ char_ngram + KG proximity + quality-aware rerank；selector 走 intent_parse → capability_decompose → tool_match → param_gap → risk_filter → call_order；selector 主动跳过公共基础域 / catalog 包装类工具。
- Golden 真断言收紧至「QA top-3 命中 ≥ 0.8 / selection ≥ 0.75 / 占位符接口必须 blocked」三条；用例改为 4 + 3，实测 4/4 与 3/3。
- vitest 因 sandbox 无依赖被替换为 `node:test`：`tests/golden.test.ts` + `npm run test:golden`。

## Week 4：Pi Runtime 接入

目标：Pi Agent 能调用 DB Archaeologist 工具。

任务：

- 实现 Pi extension。
- 注册 custom tools。
- 配置 skill。
- 跑通本地 CLI demo。
- 输出 demo session 文档。

验收：

- Pi 中可以问“商品诊断有哪些接口”。
- Pi 中可以请求“分析商品下滑需要哪些工具”。
- 返回结果包含 API、Tool、参数缺口和质量风险。

**实际产出**

- spec-pack 自身即 pi 工作目录：`.pi/extensions/db_archaeologist.extension.ts` 注册 6 个 tool；`.pi/skills/db-archaeologist/SKILL.md` 给出调用约定；`runtime/pi/...` 旧骨架保留为归档。
- `.env.example` 暴露 `LIVE_PROBE` / `ALLOW_FS_WRITE` / `REGISTRY_ROOT`，默认禁外网与 fs 写。
- 无 pi 依赖的本地冒烟：`DBA_PI_SMOKE=1 npm run smoke:pi` 通过 `scripts/typebox_stub.mjs` 桩接管 `@sinclair/typebox`，6 个工具均返回真实数据。
- `scripts/build_demo_session.ts` 自动生成 `demo/session.md`，覆盖 PRD §3 全部 4 个核心场景。

## 下一步（Out of MVP）

- contract probe runner（`LIVE_PROBE=true` 时打开）。
- embedding / 向量混合检索替代 char_ngram。
- 把 services 后端从 in-memory JSONL 切到 SQLite/LanceDB（接口形态不变）。
- 自动同步 `tool_registry.yaml` 到 `registry/seed/tool_registry.seed.yaml` 的人审通道。