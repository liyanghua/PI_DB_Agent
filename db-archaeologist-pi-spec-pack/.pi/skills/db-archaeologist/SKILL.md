# DB Archaeologist Skill

当用户问到智能体数仓 API 资产、字段语义、领域映射、Tool Registry、自动选工具、质量问题排查时使用本 skill。

## 工作原则

1. 任何业务问题都先调用 `ask_api_catalog`，得到候选 API 与推荐 Tool。
2. 业务任务先用 `select_tools_for_task`，按返回的 call_order 串调用，并先把 missing_params 问回给用户。
3. 优先使用 `verified` / `agent_ready` 工具；`draft` / `blocked` 工具默认不调用，除非用户明确希望排查。
4. 解释能力归属与字段血缘时调用 `explain_tool_lineage`；按 metric 反查接口也走它。
5. 排查质量问题（空返回、字段缺失、占位符路径、重复路径、测试接口）走 `list_api_quality_issues`。
6. 列举某领域全部接口时使用 `list_domain_apis`。

## 工具

| 工具 | 用途 |
| ---- | ---- |
| ask_api_catalog | 自然语言问 API 目录，返回候选接口和质量状态 |
| select_tools_for_task | 业务任务 → 工具链 + 调用顺序 + 参数缺口 + 风险列表 |
| get_api_asset_card | 按 api_id 拉一张完整 ApiAssetCard + lineage |
| explain_tool_lineage | tool_id 或 metric → 链路文本和结构化 steps |
| list_domain_apis | 按领域 + 状态列出接口（按质量分降序） |
| list_api_quality_issues | 按 issue_type / severity 过滤质量问题清单 |

## 安全边界

- 本 skill 不直连真实 API、不写文件、不发外网请求；所有数据来自 `registry/derived/`。
- 真要发起外部探活只允许 `LIVE_PROBE=true` 显式开关，本仓库默认 false。