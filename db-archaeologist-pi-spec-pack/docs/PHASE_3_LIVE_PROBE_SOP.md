# Phase 3 真机三件套验收 SOP

> 受 Cursor 沙箱限制（无外网、无 pi runtime、无 fork TTY），真机验收必须在 macOS 原生 Terminal.app 中按本文档执行。

## 0. 前置环境

```bash
cd /Users/yichen/Desktop/OntologyBrain/PI_AGENT/db-archaeologist-pi-spec-pack
node -v   # 必须 >= 22.6
which pi  # 必须 /opt/homebrew/bin/pi
cat .env  # 必须含 ZICHEN_BASE_URL / TENANT_ID / USER_ID / APP_CODE_KEY / APP_CODE
```

## 1. 启动 pi（带 spec-pack 工作目录）

```bash
cd /Users/yichen/Desktop/OntologyBrain/PI_AGENT/db-archaeologist-pi-spec-pack
PI_CODING_AGENT_DIR="$(pwd)/.pi-home/agent" pi --model aicodemirror/gpt-5.5
```

## 2. 三件套话术（依次输入到 pi prompt）

### 件 1：Competition pack 真机（CPS）

```
帮我看下"入户地垫"这个三级类目的关键词竞争压力情况，使用真机数据
```

预期：
- 命中 `analyze_keyword_competition`
- LIVE probe 双源：投流域 `data_cust_ads_ad_flow_plan_goods_keyword_7d` + 竞争域 `data_competition_pattern_analysis`
- normalize 三阶段成功（Stage A 商品→类目、Stage B 投流→关键词、Stage C 广播）
- 类目级 `competition_index` 在所有 record 中一致（广播自洽）
- `cpc_source` 分布：paid ≥ 5、missing ≥ 3
- top_overall 至少 3 词，cps 落 [0,100] 区间，bucket ∈ {weak, medium, strong}

### 件 2：KOIF Router 真机（三路汇合）

```
帮我看下"入户地垫"这个词的关键词经营机会
```

预期：
- 命中 `propose_koif_strategy`
- 自动触发 KDS + TMS + CPS 三 capability LIVE 调用
- score_vector entries 数 ≥ 30（关键词 × 3 capability）
- bucket=medium 不为空（验证 cps_weights 与 router types 已统一为 medium）
- 至少 1 条 strategy_routes 命中
- next_actions 至少 1 条（含具体 keyword 列表 + 中性化模板，不出现金额/ROI/出价）
- router_run 落 `registry/koif_routes/<router_run_id>/`，含 `router_meta.json` + `score_vector.json` + `strategy_routes.json` + `next_actions.json` + `router_report.md`

### 件 3：Decision Layer Stub（4 错误码全覆盖）

```
基于刚才的 router_run_id，给我出"入户地垫"的付费投放测款方案
```

预期：
- 命中 `propose_koif_decision`
- 因 Phase 3 仅 stub，必返 `decision_layer_phase3_stub`
- hints 含「Phase 3.5」「PVS」「解锁」之一

可选追加测试：
- 故意把 router_run_id 改成不存在 → 返 `router_run_not_found`
- 留空 router_run_id → 返 `router_run_id_required`
- decision_kind 写错（如 `xxx_unknown`）→ 返 `decision_kind_unsupported`

## 3. 验收清单

| 项 | 通过标准 |
| --- | --- |
| 三 capability LIVE 调用全部成功 | `pull_report.per_api[*].status == "ok"` |
| 双源 normalize Stage A/B/C | `cps_category_metrics.json` + `cps_keyword_cpc.json` 都非空 |
| 类目广播自洽 | 同 run `cps_scores.json` 内所有 record 的 `competition_index` 一致 |
| router_run 完整 | 5 个 artifact 文件均生成 |
| decision stub 错误码 | 4 路全覆盖 |
| 工具数 | extension 注册 = 18，pi list-tools 也 = 18 |

## 4. 失败回流路径

- LIVE 401/403：检查 `.env` 内 ZICHEN_* 凭据；翻 `pull_report.per_api[*].http`
- bucket=medium 缺失：检查 `cps_weights.yaml` cps_levels 用 `medium`，且 `koif_router/types.ts` / `aggregate.ts` 也写 `medium`（Phase 3 已修，不应再现）
- competition_index 全空：双源 LIVE probe 缺一条；翻 `normalize_report.json` 看 Stage A/B 哪一段断
- router 缺 CPS 行：检查 `propose_koif_strategy` 入参 capabilities 是否含 "cps"，并确认 `koif_router/aggregate.ts` S4 CPS 分支已合入
- 投流域报 `keyword_field_missing`（已修复）：曾因 card.response_schema.root=`data` 与 mapping.response_root=`data.result[]` 错位，pickTop 用 card.root 抽出 sample_keys=`["pageNum","pageSize","totalNum","result"]`，里面没有 `kw_name`。修法：`probeApiSample` 增 `response_root_override`，`live_pull` 透传 `cfg.response_root`，让 mapping 优先；`tests/invariants.test.ts` 第 3 条 WARN 模式监控未来同类 root drift。
- 竞争域报 `business_empty` 但接口本身正常：类目/月份本期真无数据。验证：用 `沙发垫 + 2025-09` 跑 single probe，total>0 即可证明 mapping 正确，换窗口或类目即可。

## 5. 真机验收完成后

把以下关键产物路径回贴：
- 任一 CPS run 目录：`registry/derived/keyword_analysis_pack/keyword_competition/<run_id>/`
- 任一 KDS run、TMS run 目录
- 任一 router_run 目录：`registry/koif_routes/<router_run_id>/`
- decision 错误码截图或 hints 文本