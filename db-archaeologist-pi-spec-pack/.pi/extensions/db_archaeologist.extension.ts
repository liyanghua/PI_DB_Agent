// DB Archaeologist pi extension. Registers 7 custom tools that delegate to
// src/services/* via src/tools/* thin wrappers. All execute() handlers return
// pi-shaped { content: [{type:"text", text}], details } so they show up natively.

import { Type } from "@sinclair/typebox";

import { askApiCatalog } from "../../src/tools/ask_api_catalog.js";
import { selectToolsForTask } from "../../src/tools/select_tools_for_task.js";
import { getApiAssetCard } from "../../src/tools/get_api_asset_card.js";
import { explainToolLineage } from "../../src/tools/explain_tool_lineage.js";
import { listDomainApis } from "../../src/tools/list_domain_apis.js";
import { listApiQualityIssues } from "../../src/tools/list_api_quality_issues.js";
import { probeApiSampleTool } from "../../src/tools/probe_api_sample.js";

type Pi = {
  registerTool: (t: {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{
      content: Array<{ type: "text"; text: string }>;
      details: unknown;
    }>;
  }) => void;
};

function pack(details: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
    details: details as Record<string, unknown>,
  };
}

export default function dbArchaeologistExtension(pi: Pi): void {
  pi.registerTool({
    name: "ask_api_catalog",
    label: "Ask API Catalog",
    description: "查询 API 资产目录：返回候选接口、领域、质量状态、字段摘要、相关工具推荐。",
    parameters: Type.Object({
      question: Type.String({ description: "中文或英文问题，例如：有没有查商品核心指标的接口？" }),
      domain: Type.Optional(Type.String({ description: "可选领域过滤，例如 商品域 / 关键词域" })),
      limit: Type.Optional(Type.Number({ description: "返回候选条数", default: 8 })),
    }),
    execute: async (_id, params) => pack(askApiCatalog(params as Parameters<typeof askApiCatalog>[0])),
  });

  pi.registerTool({
    name: "select_tools_for_task",
    label: "Select Tools For Task",
    description: "对业务分析任务做工具选择：给出推荐工具链、调用顺序、参数缺口、被屏蔽的高风险接口。",
    parameters: Type.Object({
      task: Type.String({ description: "业务任务文本" }),
      known_params: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    execute: async (_id, params) => pack(selectToolsForTask(params as Parameters<typeof selectToolsForTask>[0])),
  });

  pi.registerTool({
    name: "get_api_asset_card",
    label: "Get API Asset Card",
    description: "按 api_id 拉取 ApiAssetCard 与 lineage 文本。",
    parameters: Type.Object({
      api_id: Type.String({ description: "ApiAssetCard 主键，例如 agent_goods_id_ads_fact_item_summary_d" }),
    }),
    execute: async (_id, params) => pack(getApiAssetCard(params as Parameters<typeof getApiAssetCard>[0])),
  });

  pi.registerTool({
    name: "explain_tool_lineage",
    label: "Explain Tool Lineage",
    description: "解释 Tool/Metric → API → Field → Metric/Entity 的链路。",
    parameters: Type.Object({
      tool_id: Type.Optional(Type.String()),
      metric: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) => pack(explainToolLineage(params as Parameters<typeof explainToolLineage>[0])),
  });

  pi.registerTool({
    name: "list_domain_apis",
    label: "List Domain APIs",
    description: "按领域和状态列出 API（默认按 quality_score 降序）。",
    parameters: Type.Object({
      domain: Type.String({ description: "领域名，例如 商品域" }),
      status: Type.Optional(Type.String({ description: "lifecycle_status，例如 agent_ready / verified / candidate" })),
      limit: Type.Optional(Type.Number({ default: 50 })),
    }),
    execute: async (_id, params) => pack(listDomainApis(params as Parameters<typeof listDomainApis>[0])),
  });

  pi.registerTool({
    name: "list_api_quality_issues",
    label: "List API Quality Issues",
    description: "列出有质量问题的 API：返回示例为空、字段说明缺失、路径占位符、重复路径、测试模块等。",
    parameters: Type.Object({
      issue_type: Type.Optional(Type.String()),
      severity: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number({ default: 100 })),
    }),
    execute: async (_id, params) => pack(listApiQualityIssues(params as Parameters<typeof listApiQualityIssues>[0])),
  });

  pi.registerTool({
    name: "probe_api_sample",
    label: "Probe API Sample (live, top N)",
    description: "按 api_id 自动拼 URL、注入 ZICHEN_* 凭据并真实出站调用，返回 TOP N 行样例数据。需 LIVE_PROBE=true，否则会被安全门拦截返回 blocked。",
    parameters: Type.Object({
      api_id: Type.String({ description: "ApiAssetCard.api_id；可先通过 ask_api_catalog 或 list_domain_apis 拿到" }),
      params: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "用户提供的 query/body 参数；必填字段缺失会返回 missing_params 而不发起请求" })),
      top: Type.Optional(Type.Number({ description: "TOP N，默认 10，1..50", default: 10 })),
      timeout_ms: Type.Optional(Type.Number({ description: "请求超时，默认 8000ms，1000..30000", default: 8000 })),
    }),
    execute: async (_id, params) => pack(await probeApiSampleTool(params as Parameters<typeof probeApiSampleTool>[0])),
  });
}