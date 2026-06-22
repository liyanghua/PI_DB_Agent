// src/services/keyword_competition/report.ts
// cps_report.md：纯业务话术，零工程术语，零决策类话术（预算/出价/ROI 由 koif_decision_layer 处理）。
// 详见 docs/20 §9。

import type {
  CompetitionScoreRecord,
  CpsRankResult,
  CpsRunMeta,
  CpsNormalizeReport,
} from "./types.js";

const BUCKET_CN: Record<string, string> = {
  weak: "弱竞争（蓝海）",
  medium: "中等竞争",
  strong: "强竞争（红海）",
};

const FIELD_CN: Record<string, string> = {
  competition_index: "竞争指数",
  brand_concentration: "品牌集中度",
  competitor_count: "竞品数量",
  avg_cpc_cny: "平均出价",
  market_avg_bid: "市场平均出价",
  ad_keyword_ratio: "广告词占比",
};

export interface BuildCpsReportInput {
  meta: CpsRunMeta;
  rank: CpsRankResult;
  scored: CompetitionScoreRecord[];
  normalize_report: CpsNormalizeReport;
}

export function buildCpsBusinessReport(input: BuildCpsReportInput): string {
  const { meta, rank, scored, normalize_report } = input;
  const lines: string[] = [];

  lines.push(`# ${meta.category} 关键词竞争压力分析`);
  lines.push("");
  if (meta.date_range) {
    lines.push(`> 数据时间：${meta.date_range.start_date} ~ ${meta.date_range.end_date}`);
  }
  lines.push(`> 类目：${meta.category}（id=${meta.category_id}）`);
  lines.push(`> 分析样本：${scored.length} 个关键词`);
  lines.push("");

  // 一、整体竞争格局
  lines.push("## 一、整体竞争格局");
  lines.push("");
  if (scored.length === 0) {
    lines.push("_暂无可分析的样本。_");
    lines.push("");
  } else {
    const avg = scored.reduce((acc, r) => acc + r.cps, 0) / scored.length;
    const weakCount = scored.filter((r) => r.cps < 30).length;
    const mediumCount = scored.filter((r) => r.cps >= 30 && r.cps < 60).length;
    const strongCount = scored.filter((r) => r.cps >= 60).length;
    lines.push(`整体竞争压力评分：**${avg.toFixed(1)}**。`);
    lines.push(`- 弱竞争词数量：${weakCount}（CPS < 30）`);
    lines.push(`- 中等竞争词数量：${mediumCount}（30 ≤ CPS < 60）`);
    lines.push(`- 强竞争词数量：${strongCount}（CPS ≥ 60）`);
    lines.push("");
    const overall = avg < 30 ? "整体偏弱竞争" : avg < 60 ? "整体中等竞争" : "整体红海博弈";
    lines.push(`**整体判断**：${overall}。`);
    lines.push("");
  }

  // 二、竞争压力 TOP（最激烈）
  if (rank.top_overall.length > 0) {
    lines.push("## 二、竞争压力 TOP 10（最激烈）");
    lines.push("");
    lines.push("| 排名 | 关键词 | 竞争压力 | 竞争指数 | 平均出价 |");
    lines.push("| --- | --- | --- | --- | --- |");
    rank.top_overall.slice(0, 10).forEach((r, i) => {
      const ci = r.subscores.competition_index.toFixed(0);
      const mb = r.subscores.market_avg_bid.toFixed(0);
      lines.push(`| ${i + 1} | ${r.keyword} | ${r.cps.toFixed(1)} | ${ci} | ${mb} |`);
    });
    lines.push("");
  }

  // 三、蓝海机会词
  const weakBucket = rank.top_by_bucket.weak;
  if (weakBucket && weakBucket.length > 0) {
    lines.push("## 三、蓝海机会词 TOP 10（弱竞争）");
    lines.push("");
    lines.push("| 排名 | 关键词 | 竞争压力 | 竞争指数 | 平均出价 |");
    lines.push("| --- | --- | --- | --- | --- |");
    weakBucket.slice(0, 10).forEach((r, i) => {
      const ci = r.subscores.competition_index.toFixed(0);
      const mb = r.subscores.market_avg_bid.toFixed(0);
      lines.push(`| ${i + 1} | ${r.keyword} | ${r.cps.toFixed(1)} | ${ci} | ${mb} |`);
    });
    lines.push("");
  }

  // 四、按竞争分档分布
  lines.push("## 四、按竞争分档拆解");
  lines.push("");
  for (const [code, list] of Object.entries(rank.top_by_bucket)) {
    if (!list || list.length === 0) continue;
    lines.push(`### ${BUCKET_CN[code] ?? code}`);
    lines.push("");
    list.slice(0, 5).forEach((r, i) => {
      lines.push(`${i + 1}. **${r.keyword}** — CPS ${r.cps.toFixed(1)}，${r.explanation.rank_reason}`);
    });
    lines.push("");
  }

  // 五、数据来源
  lines.push("## 五、数据来源");
  lines.push("");
  const srcLines = Object.entries(normalize_report.source_coverage)
    .map(([k, v]) => `- ${k}：${v}`)
    .join("\n");
  lines.push(srcLines || "_暂无源覆盖记录。_");
  lines.push("");
  const cov = Object.entries(normalize_report.field_coverage)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- ${FIELD_CN[k] ?? k}：覆盖 ${(v * 100).toFixed(0)}%`)
    .join("\n");
  if (cov) {
    lines.push("**核心字段覆盖**：");
    lines.push("");
    lines.push(cov);
    lines.push("");
  }

  // 六、注意事项
  lines.push("## 六、注意事项");
  lines.push("");
  lines.push("- 本报告仅描述客观竞争格局，不构成投放建议。");
  lines.push("- 预算 / 出价 / ROI 类决策请走专门的决策建议工具。");
  if (scored.some((r) => r.explanation.fallback_chain.length > 0)) {
    lines.push("- 部分关键词触发了字段降级路径（数据缺失，按规则用替代来源），可信度略低。");
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(`> 工程级 trace 见 registry/derived/keyword_analysis_pack/keyword_competition/${meta.run_id}/ 下 score_trace.jsonl / normalize_report.json。`);

  return lines.join("\n") + "\n";
}

export function buildCpsRunSummary(input: BuildCpsReportInput): string {
  const { meta, rank, scored } = input;
  const lines: string[] = [];
  lines.push(`# CPS Run ${meta.run_id}`);
  lines.push("");
  lines.push(`- 类目：${meta.category}（${meta.category_id}）`);
  lines.push(`- 策略：${meta.strategy} v${meta.version}`);
  lines.push(`- 配置 hash：weights=${meta.weights_hash.slice(0, 8)}`);
  lines.push(`- 数据规模：${scored.length} 个关键词`);
  if (meta.elapsed_ms != null) lines.push(`- 耗时：${meta.elapsed_ms} ms`);
  lines.push("");
  lines.push("## CPS TOP 10（最激烈）");
  rank.top_overall.slice(0, 10).forEach((r, i) => {
    lines.push(`${i + 1}. ${r.keyword} — CPS ${r.cps.toFixed(1)}（${r.explanation.cps_level}）`);
  });
  lines.push("");
  return lines.join("\n") + "\n";
}