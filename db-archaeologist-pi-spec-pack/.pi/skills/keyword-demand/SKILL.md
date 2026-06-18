# Keyword Demand Skill

当用户问到「关键词需求 / 蓝海词 / 词根机会 / 类目 TOP 词 / 哪些词最值得做 / 对比上次跑」等关键词侧问题时，使用本 skill。

不要把这件事当成 "查 API"。这里的目标是：**给定一个类目 → 输出关键词需求分类 + 强度排名 + 业务可读报告**。

## 工作流（默认）

1. **解析类目**：用户给的类目名先在 `registry/category_taxonomy.yaml` 里查；不命中就把 `category` 作为 missing_params 问回去，不要瞎猜 category_id。
2. **跑分析**：调 `analyze_keyword_demand({ category, strategy: "baseline_v1" })`。沙箱默认走 mock fixture；只有当用户明确要求"实拉数"且 `LIVE_PROBE=true` 才传 `live: true`。
3. **念结果（业务语言、零工程术语）**：
   - 总 TOP 5：关键词 + KDS + 标签 + 一句话归因（直接用 `top_overall[*].explanation.rank_reason`）；
   - 各需求类型 TOP 3：function / scene / spec / blue_ocean 至少各报一档；
   - transaction_block / reject 数量一句话带过；
   - 降级触发条目数（来自 `normalize_report`），告知用户哪些维度走了 fallback；
   - 给出 `run_id` 与 `summary_path / report_path`，便于回看。
4. **追问 "为什么这个词排第一"**：直接读该 record `explanation.subscores`，按公式逐项念（不要重新算），同时点出 `intent_multiplier.rule_id`。
5. **追问 "和上次比"**：先 `list_keyword_runs({ category })` 拿到最近两个 run_id，再 `compare_keyword_runs({ run_id_a, run_id_b })`；念时优先念"重叠率 / 词位移 / 决议建议"。
6. **追问 "新算法能不能上"**：跑 `npm run keyword:eval <strategy>`（CLI 侧）或让用户提供新 run，再走 compare。门槛：must_exclude 违反 = 0 且 precision@k ≥ baseline。

## 工具

| 工具 | 用途 |
| ---- | ---- |
| analyze_keyword_demand | 类目名 → 关键词需求分类 + KDS 排名 + 业务报告 + 工程 trace |
| compare_keyword_runs | 两个 run（同 category_id）的 9 节对比（重叠/相关性/词位移/分布漂移/决议） |
| list_keyword_runs | 列已落盘的 run；指定 run_id 时返回 meta + run_summary.md |

## 输出原则

- **业务语言**：直接说"规模高、转化稳、场景+功能加成"，不要说 `pctRank` / `weights_hash` / `fallback_neutral_50`；这些只在 trace 里出现。
- **降级要显式标注**：如果 normalize_report 里 `degradations[]` 非空，必须告诉用户"增长维度数据缺失，已按中性 50 处理"。
- **不要替用户做 GAP 诊断**：本 skill 只到"候选机会词"为止；GAP 诊断是后续 MVP2/3 的 skill。

## 默认策略

- `baseline_v1`：规则 KDS Baseline（spec MVP1）。永远以此为基准。
- `semantic_v2` / `llm_voc_v3`：当前 stub，调用会返回 not_implemented，不要主动选它们。

## 安全边界

- 本 skill **默认不发外网**；仅在 `LIVE_PROBE=true` 且用户明确同意时才把 `live: true` 传给 `analyze_keyword_demand`。
- 只读 `registry/derived/keyword_demand/<run_id>/` 与 `fixtures/`；不写源 yaml；不修改 `*.locked.yaml`。