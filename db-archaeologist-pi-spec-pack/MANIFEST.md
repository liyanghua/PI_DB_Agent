# Manifest

## Sources

- `sources/api_docs/智能体数仓完整接口文档_整理版.md` — 主入口（固定文件名；ingest 阶段会被 `_inbox/` 中的新文件覆盖）
- `sources/api_docs/_inbox/` — 新版源文档落点
- `sources/api_docs/_archive/<YYYYMMDD-HHmm>.md` + `_archive/INDEX.md` — 旧版主入口归档（每次 ingest 自动写入）

## Seeds（人工 / 历史，禁改）

- `registry/seed/api_index_seed.json` — **derived seed**：由 `extract:index` 从主入口重生（159 条），不要手编
- `registry/seed/api_index_seed.python.json` — 历史 Python 版基线（参考用）
- `registry/seed/api_asset_cards.seed.json` — 早期资产卡 stub（已被 derived 覆盖）
- `registry/domain_taxonomy.yaml` — 领域分类原始草案
- `registry/metric_dictionary.seed.yaml` — 指标别名词典
- `registry/tool_registry.seed.yaml` — 5 个手工 wrapper（被 build_tools 视为 locked）
- `registry/knowledge_graph.seed.jsonl` — BusinessQuestion / Scenario 种子
- `registry/domain_mapping.locked.yaml` — 人工锁定的 domain override（build_cards 流水线最后合并）

## Derived（流水线产出，可重建）

- `registry/derived/api_details.raw.json` — markdown_detail_extractor 输出
- `registry/derived/api_parse_report.md` — 解析报告（160 / 160，60 partial 主因缺响应字段表）
- `registry/derived/api_asset_cards.json` — 159 张 ApiAssetCard
- `registry/derived/api_asset_cards.prev.json` — rebuild S0 写入的上一版快照（source_diff 输入）
- `registry/derived/cards_build_report.md` — 卡 lifecycle / domain 分布
- `registry/derived/source_diff.json` / `source_diff_report.md` — added / removed / path_renamed / domain_changed + tool_registry 引用 WARN
- `registry/derived/tool_registry.yaml` — 18 个工具（5 manual + 13 auto）
- `registry/derived/tool_blocked.yaml` — 103 条质量降级 API + 屏蔽原因
- `registry/derived/tool_build_report.md` — 工具构建报告
- `registry/derived/knowledge_graph.jsonl` / `kg_build_report.md` — KG 节点 + 边
- `registry/derived/promotion_plan.{json,md}` / `backfill_report.md` — 晋升 / 回填规划
- `registry/derived/rebuild_report.md` — 一键重建逐 stage 状态

## Specs

- `docs/00_PRD.md` — 验收清单
- `docs/01_TECH_SPEC.md`、`docs/02_ARCHITECTURE.md`
- `docs/03_IMPLEMENTATION_PLAN.md` — 4 周计划（已用实际偏差注释）
- `docs/04_API_ASSET_CARD_SPEC.md`、`docs/05_DOMAIN_MAPPING_SPEC.md`
- `docs/06_TOOL_REGISTRY_SPEC.md`、`docs/07_KNOWLEDGE_GRAPH_SPEC.md`
- `docs/08_API_QA_AND_TOOL_SELECTION_SPEC.md`
- `docs/biz_spect/keyword_demand_baseline_mvp1_spec.md` — 关键词需求 MVP1 基线规范（任意品类输入 + KDS TOP 排名）
- `docs/biz_spect/keyword_analysis_pack_spec.md` — 关键词分析策略包规范（通用 pack 母体）
- `docs/adr/ADR-001-use-pi-as-agent-runtime.md`
- `specs/schemas/api_asset_card.schema.json`、`specs/schemas/tool_registry.schema.json`
- `specs/contracts/api_qa.output.contract.json`、`specs/contracts/tool_selection.output.contract.json`

## Code

- `src/lib/{io,yaml_lite,schema,types}.ts` — Node-only IO / YAML / 校验 / 类型
- `src/extractors/{markdown_api_extractor,markdown_detail_extractor}.ts`
- `src/normalizers/{path_canon,domain_mapper,field_semantic_classifier,quality_scorer,lifecycle}.ts`
- `src/pipelines/{build_cards,build_tools,build_kg}.ts`
- `src/services/{registry,qa,selector,lineage}.ts` — 单一真相
- `src/services/keyword_demand/{index,resolve,live_pull,shape,normalize,classify,score,rank,report,compare,eval,trace}.ts` — 关键词分析策略包当前实现
- `src/tools/{ask_api_catalog,select_tools_for_task,get_api_asset_card,explain_tool_lineage,list_domain_apis,list_api_quality_issues,run_golden_cases}.ts` — 薄壳
- `src/scripts/smoke_services.ts`

## Pi runtime

- `.pi/extensions/db_archaeologist.extension.ts` — 6 个 custom tool 注册（spec-pack = pi 工作目录）
- `.pi/skills/db-archaeologist/SKILL.md` — 调用约定
- `.env.example` — `LIVE_PROBE` / `ALLOW_FS_WRITE` / `REGISTRY_ROOT`
- `runtime/pi/...` — 旧版骨架，保留作历史归档

## Toolchain（无 npm install）

- `scripts/ts_loader.mjs` — `node --import` 入口
- `scripts/ts_resolve_hook.mjs` — `./foo.js → ./foo.ts` 重写 + `DBA_PI_SMOKE=1` 时 typebox stub 注入
- `scripts/typebox_stub.mjs` — 本地 typebox 替身（仅 smoke 用）
- `scripts/pi_smoke.ts` — 6 个 pi tool 本地端到端冒烟
- `scripts/build_demo_session.ts` — 重建 `demo/session.md`
- `scripts/ingest_source.ts` — 从 `_inbox/` 取新版主入口、归档旧版
- `scripts/source_diff.ts` — cards.prev vs 当前 → `source_diff_report.md`
- `scripts/rebuild_all.ts` — 9 stage 一键重建（snapshot/extract/cards/diff/tools/kg/promote/golden）
- `scripts/ingest_and_rebuild.ts` — `ingest + rebuild` 套壳（`npm run ingest:rebuild`）
- `scripts/build_promotion_plan.ts` / `backfill_from_probe.ts` / `promotion_smoke.ts` — 晋升 / 回填 / 冒烟

## Tests

- `tests/golden.test.ts` — node:test 套件，3 项断言（QA hit-rate / selection pass-rate / blocked APIs）
- `tests/golden.test.ts` — node:test 套件，包含关键词需求不变量（任意品类输入、KDS TOP、过滤规则）
- `tests/golden_cases/api_qa_cases.yaml` — 4 例
- `tests/golden_cases/tool_selection_cases.yaml` — 3 例
- `tests/golden_cases/keyword_demand_cases.yaml` — 关键词需求金标
- `demo/session.md` — 4 个真实 pi 工具 transcript

## Acceptance（对齐 docs/00_PRD.md §5）

| 指标 | 阈值 | 实测 |
| --- | --- | --- |
| 文档 detail section 解析率 | ≥ 95% | 100% (160/160) |
| 完成 domain+capability+metric mapping 接口数 | ≥ 30 | 143 |
| Tool Registry 工具数 | ≥ 10 | 18 |
| API 问答 top-3 命中 | ≥ 0.8 | 1.0 (4/4) |
| 自动选工具通过率 | ≥ 0.75 | 1.0 (3/3) |
| 占位符 / 空返回 / 字段缺失接口被降级 | required | tool_blocked 收容；list_api_quality_issues 检索 |
| pi 中 6 个 custom tool 可调 | required | `npm run smoke:pi` 全部 200 ✓ |
