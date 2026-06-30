# DB Archaeologist Agent × Pi Runtime 规范包

本规范包把 `智能体数仓完整接口文档_整理版.md`（160 个 detail section / 159 条 API 索引）编译为 Agent 可读、可查、可选、可调用的资产层，再通过 6 个 pi custom tool 暴露给 [`earendil-works/pi`](../pi)。

## 目标

MVP 不做通用数据库治理平台。范围限定为：

1. 解析 Markdown → ApiAssetCard。
2. 自动 domain mapping（商品 / 关键词 / 竞争 / 投流 / 类目 / 任务 / 价格带 / 流量 / 指标 / 店铺 / 公共基础）。
3. 维护 Tool Registry，把 API 包装成 Agent 可调用工具。
4. 构建 Knowledge Graph：BusinessQuestion → Capability → Tool → API → Field → Metric/Entity/Domain。
5. API 问答与 Agent 自动选工具（含参数缺口、风险、调用顺序）。
6. 通过 pi extension + skill 接入 pi runtime。
7. 落地关键词分析策略包第一版：支持任意品类名称输入、KDS TOP 榜、蓝海辅助榜、mock 回落与 live 反查。

## 数据流

```
sources/api_docs/_inbox/<date>.md   (新版源文档落点)
   │
   ▼  scripts/ingest_source.ts (S-1, 可选)
sources/api_docs/智能体数仓完整接口文档_整理版.md   (主入口·固定文件名)
sources/api_docs/_archive/<YYYYMMDD-HHmm>.md       (旧版自动归档)
   │
   ▼  src/extractors/markdown_detail_extractor.ts (S1)
registry/derived/api_details.raw.json + api_parse_report.md
   │
   ▼  src/extractors/markdown_api_extractor.ts (S2 · 重生 seed)
registry/seed/api_index_seed.json   (derived seed: api_id/domain/lifecycle/quality_score_seed)
   │
   ▼  src/pipelines/build_cards.ts (S3)
        ├─ src/normalizers/path_canon.ts
        ├─ src/normalizers/domain_mapper.ts (+ registry/domain_mapping.locked.yaml)
        ├─ src/normalizers/field_semantic_classifier.ts (+ registry/metric_dictionary.seed.yaml)
        ├─ src/normalizers/quality_scorer.ts  (7 因子 v2)
        └─ src/normalizers/lifecycle.ts
registry/derived/api_asset_cards.json + cards_build_report.md
   │
   ├──▶ scripts/source_diff.ts (S4, report-only) ─▶ source_diff_report.md
   ├──▶ src/pipelines/build_tools.ts (S5) ─▶ registry/derived/tool_registry.yaml + tool_blocked.yaml
   ├──▶ src/pipelines/build_kg.ts    (S6) ─▶ registry/derived/knowledge_graph.jsonl
   └──▶ scripts/build_promotion_plan.ts (S7) ─▶ promotion_plan.{json,md}

services（单一真相）：src/services/{registry,qa,selector,lineage,api_runtime,promotion,backfill}.ts
tools（薄壳）：src/tools/{ask_api_catalog,select_tools_for_task,get_api_asset_card,
                          explain_tool_lineage,list_domain_apis,list_api_quality_issues,
                          run_golden_cases,probe_api_sample}.ts
runtime：.pi/extensions/db_archaeologist.extension.ts + .pi/skills/db-archaeologist/SKILL.md
```

## 源文档更新流程

把新版 markdown 放进 `sources/api_docs/_inbox/`（任意带日期的文件名），然后：

```bash
npm run ingest:rebuild   # ingest_source.ts → rebuild_all.ts
```

行为：

1. `ingest_source.ts` 选 `_inbox/` 里 mtime 最新的 `.md`，校验大小 / 头部 → 把当前主入口归档到 `sources/api_docs/_archive/<YYYYMMDD-HHmm>.md`，新文件覆盖主入口路径，并在 `_archive/INDEX.md` 追加一条 `size/sha256/replaced_at` 记录。
2. `rebuild_all.ts` 跑 9 个 stage：`snapshot:prev` → `extract:detail` → `extract:index` → `build:cards` → `source:diff` → `build:tools` → `build:kg` → `promote:plan` → `test:golden`。
3. `source_diff_report.md` 列出 added / removed / path_renamed / domain_changed；如果 removed 项被 `tool_registry.yaml` 引用会给 WARN（不阻塞）。

回滚：从 `sources/api_docs/_archive/<ts>.md` 拿回旧文件覆盖主入口，重跑 `npm run rebuild:all`。

> `registry/seed/api_index_seed.json` 现在是 derived，由 `extract:index` 从主入口重生；不要手编。`registry/seed/api_index_seed.python.json` 是历史 Python 版基线，仅作参考。

## 运行环境约定

- **不依赖 npm install**：spec-pack 自身只用 Node 内置模块，需要 Node ≥ 22.6（已在 Node 25.2.1 验证）。
- 所有脚本通过 `node --import ./scripts/ts_loader.mjs <file.ts>` 触发原生 TS 剥离 + 自定义 ESM resolve（把本地 `./foo.js` 重写为 `./foo.ts`）。
- pi runtime 自身依赖（`@sinclair/typebox`、`@earendil-works/*`）由 pi 的 workspace 解析；本地冒烟用 `DBA_PI_SMOKE=1` 触发 `scripts/typebox_stub.mjs` 临时桩。
- 类型导入一律 `import type`，YAML/Schema 用本地 `src/lib/{yaml_lite,schema}.ts`，无 ajv/yaml 包。

## 服务器部署

Web GUI 可以在 Linux 服务器上以 systemd 服务运行。部署脚本会生成 `.env` 模板、检查 Node/pi、创建 `.pi-home/agent`，并可安装 `db-arch-web.service`。

```bash
cd /path/to/PI_AGENT/db-archaeologist-pi-spec-pack
chmod +x ./install.sh
./install.sh --host 0.0.0.0 --port 4318 --pi-bin /usr/local/bin/pi
```

安装后编辑 `.env`，填入 `AICODEMIRROR_API_KEY` 以及需要 live probe 时的 `ZICHEN_*` 凭据，然后重启：

```bash
sudo systemctl restart db-arch-web
sudo journalctl -u db-arch-web -f
```

更多端口、防火墙、Nginx 反代和手动启动说明见 [`web/README.md`](web/README.md)。

## 常用命令

```bash
# 全量重建 derived（snapshot → extract:detail → extract:index → cards → diff → tools → kg → promote → golden）
npm run rebuild:all

# 把 _inbox/ 最新源文档纳入主入口并重建
npm run ingest:rebuild

# 仅做 ingest（不重建）
npm run ingest

# 单独跑某一段
npm run extract:detail
npm run extract:index
npm run build:cards
npm run build:tools
npm run build:kg
npm run source:diff
npm run promote:plan

# 服务层冒烟（registry/qa/selector/lineage）
npm run smoke:services

# 6 个 pi 工具本地冒烟（不需要 pi node_modules）
npm run smoke:pi

# Golden 真断言（node:test）
npm run test:golden
```

## 6 个 pi 工具

| Tool | 用途 |
| --- | --- |
| `ask_api_catalog` | 自然语言问 API 目录，返回候选接口、领域、质量、字段摘要、推荐工具 |
| `select_tools_for_task` | 业务任务 → 工具链 + 调用顺序 + 参数缺口 + 风险列表 |
| `get_api_asset_card` | 按 `api_id` 拉一张完整 ApiAssetCard + lineage |
| `explain_tool_lineage` | `tool_id` 或 metric → Tool→API→Field→Metric/Entity 链路 |
| `list_domain_apis` | 按领域 + 生命周期状态列接口（按 quality_score 降序） |
| `list_api_quality_issues` | 按 issue_type / severity 过滤质量问题清单 |

## 当前派生产物

- `registry/derived/api_asset_cards.json`：159 张资产卡（agent_ready 43，verified 13，candidate 88，draft 12，blocked 3）
- `registry/derived/tool_registry.yaml`：18 个工具（5 manual + 13 auto），另 103 个低质量 API 进 `tool_blocked.yaml`
- `registry/derived/kg_nodes.jsonl` / `kg_edges.jsonl`：2733 节点 / 3411 边
- `registry/derived/cards_build_report.md` / `tool_build_report.md` / `kg_build_report.md`：每段流水线自带的统计与降级原因
- `demo/session.md`：4 个真实场景的 pi 工具 transcript（商品下滑 / 蓝海关键词 / 竞争 V3 / 空返回排查）

## MVP 验收对照

详见 `docs/00_PRD.md §5` 与 `MANIFEST.md` 的 `Acceptance` 段。本仓库当前实测：

| 指标 | 阈值 | 实测 |
| --- | --- | --- |
| 文档 detail 解析率 | ≥ 95% | 160/160 = 100% |
| 完成 domain+capability+metric mapping | ≥ 30 | 143 |
| Tool Registry 工具数 | ≥ 10 | 18 |
| ask_api_catalog top-3 命中 | ≥ 0.8 | 4/4 = 1.0 |
| select_tools_for_task 通过 | ≥ 0.75 | 3/3 = 1.0 |
| 占位符 / 空返回 / 字段缺失接口降级 | required | `tool_blocked.yaml` 含全部占位符 API；list_api_quality_issues 列出 missing_response_fields 等问题 |
