// DB Archaeologist pi extension. Registers 8 custom tools that delegate to
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
import { proposeInsightPlan, listInsightTemplates } from "../../src/tools/propose_insight_plan.js";
import { analyzeKeywordDemandTool } from "../../src/tools/analyze_keyword_demand.js";
import { compareKeywordRunsTool } from "../../src/tools/compare_keyword_runs.js";
import { listKeywordRunsTool } from "../../src/tools/list_keyword_runs.js";

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
    execute: async (_id, params) =>
      pack(await probeApiSampleTool(params as Parameters<typeof probeApiSampleTool>[0])),
  });

  pi.registerTool({
    name: "propose_insight_plan",
    label: "Propose Insight Plan",
    description: "围绕一个洞察方向（如「竞争格局分析」）自动选 API、给字段打 role、对齐模板，生成 InsightPlan 草稿（含 output_schema 与覆盖度报告，附 LLM 精排 prompt）。",
    parameters: Type.Object({
      topic: Type.String({ description: "洞察方向自然语言，例如：竞争格局分析 / 商品下滑诊断 / 蓝海关键词机会" }),
      template_key: Type.Optional(Type.String({ description: "模板 key；不传则按 topic 自动匹配" })),
      candidate_limit: Type.Optional(Type.Number({ description: "候选 API 数量，默认 12，3..30", default: 12 })),
      scope: Type.Optional(Type.Object({
        time_range: Type.Optional(Type.String()),
        target_entities: Type.Optional(Type.Array(Type.String())),
      })),
    }),
    execute: async (_id, params) => {
      const args = params as Parameters<typeof proposeInsightPlan>[0];
      if (!args || !args.topic) {
        return pack({ kind: "insight_plan_error", error: "topic is required", available_templates: listInsightTemplates() });
      }
      try {
        return pack(proposeInsightPlan(args));
      } catch (e) {
        return pack({
          kind: "insight_plan_error",
          error: String((e as Error)?.message ?? e),
          available_templates: listInsightTemplates(),
        });
      }
    },
  });

  pi.registerTool({
    name: "analyze_keyword_demand",
    label: "Analyze Keyword Demand",
    description: "关键词需求分析（KDS Baseline）：输入「类目名」→ 输出关键词需求分类 + 强度排名 + 业务报告 + 工程 trace。默认走 mock fixture，LIVE_PROBE=true 才会真实出站。",
    parameters: Type.Object({
      category: Type.String({ description: "类目名（自然语言），例如：入户地垫 / 厨房地垫 / 浴室地垫" }),
      strategy: Type.Optional(Type.String({ description: "策略名，默认 baseline_v1；可在 registry/keyword_strategies.yaml 注册更多" })),
      live: Type.Optional(Type.Boolean({ description: "是否走 LIVE_PROBE 真实拉数；默认 false 走 mock fixture", default: false })),
      top_n: Type.Optional(Type.Number({ description: "总榜 TOP N，默认 20", default: 20 })),
      per_demand_type_top: Type.Optional(Type.Number({ description: "每个需求类型 TOP，默认 10", default: 10 })),
      date_range: Type.Optional(Type.Object({
        start_date: Type.String(),
        end_date: Type.String(),
      })),
      run_id_hint: Type.Optional(Type.String({ description: "提示用，目前仅留作上下文记忆，不影响 run_id 计算" })),
    }),
    execute: async (_id, params) => pack(await analyzeKeywordDemandTool(params as Parameters<typeof analyzeKeywordDemandTool>[0])),
  });

  pi.registerTool({
    name: "compare_keyword_runs",
    label: "Compare Keyword Runs",
    description: "对比两个关键词需求 run（必须同 category_id）：输出 TOP 重叠度、Spearman/Kendall/NDCG、词位移、KDS 分布漂移、跨榜单一致性、决议建议。",
    parameters: Type.Object({
      run_id_a: Type.String({ description: "参照 run_id（通常是 baseline）" }),
      run_id_b: Type.String({ description: "对照 run_id（候选策略 / 新配置）" }),
      top_k: Type.Optional(Type.Number({ description: "对比的 TOP K，默认 20", default: 20 })),
    }),
    execute: async (_id, params) => pack(await compareKeywordRunsTool(params as Parameters<typeof compareKeywordRunsTool>[0])),
  });

  pi.registerTool({
    name: "list_keyword_runs",
    label: "List Keyword Runs",
    description: "列出 registry/derived/keyword_demand 下已落盘的 run；指定 run_id 时返回该 run 的 meta 与 run_summary.md。",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "返回条数，默认 20", default: 20 })),
      category: Type.Optional(Type.String({ description: "按类目过滤，例如 入户地垫" })),
      strategy: Type.Optional(Type.String({ description: "按策略过滤，例如 baseline_v1" })),
      run_id: Type.Optional(Type.String({ description: "若指定，返回该 run 的 meta + run_summary.md" })),
    }),
    execute: async (_id, params) => pack(listKeywordRunsTool(params as Parameters<typeof listKeywordRunsTool>[0])),
  });
}