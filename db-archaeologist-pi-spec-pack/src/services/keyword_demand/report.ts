// report.ts: 业务报告中文化（§3b.2 / spec §8.3）
// 产出三类 markdown：
//   1. keyword_baseline_report.md  — 业务方读，纯中文、零工程术语
//   2. run_summary.md              — 简版速览（TOP10 + 决策）
// 工程 trace 由 trace.ts 写 jsonl，不混在这里。

import type {
  KeywordScoreRecord,
  RankResult,
  RunMeta,
  NormalizeReport,
} from "./types.js";

const TYPE_CN: Record<string, string> = {
  function: "功能型需求",
  scene: "场景型需求",
  spec: "规格型需求",
  style: "风格型需求",
  blue_ocean: "蓝海机会",
  target_user: "人群型需求",
  material: "材质型需求",
  population: "人群型需求",
  pain: "痛点型需求",
  season: "季节型需求",
  channel: "渠道型需求",
  brand: "品牌型需求",
  category: "品类词",
  price: "价格型需求",
  transaction_block: "交易阻塞词",
};

const LEVEL_CN: Record<string, string> = {
  strong_demand: "强需求",
  candidate_demand: "有效需求",
  proof_ready: "待验证",
  observe: "观察",
  reject: "噪音",
};

export interface BuildReportInput {
  meta: RunMeta;
  rank: RankResult;
  scored: KeywordScoreRecord[];
  normalize_report: NormalizeReport;
}

/**
 * 业务方报告：keyword_baseline_report.md
 */
export function buildBusinessReport(input: BuildReportInput): string {
  const { meta, rank, scored, normalize_report } = input;

  const lines: string[] = [];
  lines.push(`# ${meta.category} 关键词需求基线报告`);
  lines.push("");
  lines.push(`> 类目：${meta.category}（id=${meta.category_id}）`);
  lines.push(`> 报告口径：${meta.strategy === "baseline_v1" ? "规则基线版" : meta.strategy}`);
  lines.push(`> 生成时间：${meta.started_at}`);
  lines.push(`> 关键词样本量：${scored.length} 个`);
  lines.push("");

  // 1. 数据可信度
  lines.push("## 一、数据可信度概览");
  lines.push("");
  const sourceLines = Object.entries(normalize_report.source_coverage)
    .map(([k, v]) => `- ${k}：${v}`)
    .join("\n");
  lines.push(sourceLines);
  lines.push("");
  const coverageLines = Object.entries(normalize_report.field_coverage)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- ${humanizeField(k)}：覆盖 ${(v * 100).toFixed(0)}%`)
    .slice(0, 10)
    .join("\n");
  lines.push("**核心指标覆盖情况**：");
  lines.push("");
  lines.push(coverageLines);
  lines.push("");

  // 2. TOP 总榜
  lines.push("## 二、TOP 关键词总榜");
  lines.push("");
  lines.push("| 排名 | 关键词 | 需求强度 | 需求类型 | 一句话归因 |");
  lines.push("| --- | --- | --- | --- | --- |");
  rank.top_overall.forEach((r, i) => {
    const types = r.labels.filter((l) => !["category", "unknown"].includes(l)).map((l) => TYPE_CN[l] ?? l).join("、") || "其他";
    lines.push(`| ${i + 1} | ${r.keyword} | ${r.scores.kds.toFixed(1)}（${LEVEL_CN[r.explanation.kds_level] ?? r.explanation.kds_level}）| ${types} | ${r.explanation.rank_reason} |`);
  });
  lines.push("");

  // 3. 按需求类型分榜
  lines.push("## 三、按需求类型拆解");
  lines.push("");
  for (const [type, list] of Object.entries(rank.top_by_type)) {
    if (!list || list.length === 0) continue;
    lines.push(`### ${TYPE_CN[type] ?? type}`);
    lines.push("");
    list.slice(0, 5).forEach((r, i) => {
      lines.push(`${i + 1}. **${r.keyword}** — 强度 ${r.scores.kds.toFixed(1)}，${r.explanation.rank_reason}`);
    });
    lines.push("");
  }

  // 4. 蓝海机会
  if (rank.top_by_blue_ocean && rank.top_by_blue_ocean.length > 0) {
    lines.push("## 四、蓝海机会词");
    lines.push("");
    lines.push("> 筛选条件：供需比 ≥ 1.5 或搜索人气月环比 ≥ 20%");
    lines.push("");
    lines.push("| 排名 | 关键词 | 供需比 | 月环比 | 强度 |");
    lines.push("| --- | --- | --- | --- | --- |");
    rank.top_by_blue_ocean.forEach((r, i) => {
      const ratio = r.demand_supply_ratio != null ? r.demand_supply_ratio.toFixed(2) : "—";
      const mom = r.search_popularity_mom != null ? `${(r.search_popularity_mom * 100).toFixed(0)}%` : "—";
      lines.push(`| ${i + 1} | ${r.keyword} | ${ratio} | ${mom} | ${r.scores.kds.toFixed(1)} |`);
    });
    lines.push("");
  }

  // 5. TOP 5 详细归因
  lines.push("## 五、TOP 5 详细归因");
  lines.push("");
  rank.top_overall.slice(0, 5).forEach((r, i) => {
    lines.push(`### ${i + 1}. ${r.keyword}（强度 ${r.scores.kds.toFixed(1)}）`);
    lines.push("");
    lines.push("**字段来源**：");
    for (const [field, prov] of Object.entries(r.explanation.field_provenance)) {
      lines.push(`- ${humanizeField(field)} ← ${prov.source_api}.${prov.raw_field} = ${prov.value}`);
    }
    lines.push("");
    lines.push("**子项分解**：");
    for (const ss of r.explanation.subscores) {
      const fbHint = ss.fallback_chain && ss.fallback_chain.length > 0 ? `（降级：${ss.fallback_chain.join("→")}）` : "";
      lines.push(`- ${humanizeSubscore(ss.name)}：${ss.result.toFixed(1)} 分${fbHint}`);
    }
    if (r.explanation.intent_multiplier) {
      lines.push(`- 意图加成：${r.explanation.intent_multiplier.rule_id} × ${r.explanation.intent_multiplier.value}`);
    }
    lines.push(`- 综合判断：${LEVEL_CN[r.explanation.kds_level] ?? r.explanation.kds_level}`);
    lines.push("");
  });

  // 6. 降级与缺数据提醒
  if (normalize_report.degradations.length > 0 || hasFallbackTriggered(scored)) {
    lines.push("## 六、计算过程提醒");
    lines.push("");
    const fallbackTotal = scored.reduce((acc, r) => acc + r.explanation.subscores.filter((s) => s.fallback_chain && s.fallback_chain.length > 0).length, 0);
    if (fallbackTotal > 0) {
      lines.push(`- 共 ${fallbackTotal} 个子项触发了降级路径（数据缺失，按规则用替代来源或中性值替代），明细见工程 trace。`);
    }
    if (normalize_report.degradations.length > 0) {
      lines.push(`- ${normalize_report.degradations.length} 个关键词存在数据缺失。`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(`> 工程级 trace 见 ${`registry/derived/keyword_demand/${meta.run_id}/`} 下 score_trace.jsonl / classify_trace.jsonl / normalize_report.json。`);

  return lines.join("\n") + "\n";
}

/**
 * 简版速览：run_summary.md
 */
export function buildRunSummary(input: BuildReportInput): string {
  const { meta, rank, scored, normalize_report } = input;
  const lines: string[] = [];
  lines.push(`# Run ${meta.run_id}`);
  lines.push("");
  lines.push(`- 类目：${meta.category}（${meta.category_id}）`);
  lines.push(`- 策略：${meta.strategy} v${meta.version}`);
  lines.push(`- 配置 hash：weights=${meta.weights_hash.slice(0, 8)} taxonomy=${meta.taxonomy_hash.slice(0, 8)}`);
  lines.push(`- 数据规模：${scored.length} 个关键词，${Object.keys(normalize_report.source_coverage).length} 个数据源`);
  if (meta.elapsed_ms != null) lines.push(`- 耗时：${meta.elapsed_ms} ms`);
  lines.push("");
  lines.push("## TOP 10");
  rank.top_overall.slice(0, 10).forEach((r, i) => {
    lines.push(`${i + 1}. ${r.keyword} — ${r.scores.kds.toFixed(1)}（${LEVEL_CN[r.explanation.kds_level] ?? r.explanation.kds_level}）`);
  });
  lines.push("");
  const fallbackCount = scored.reduce((acc, r) => acc + r.explanation.subscores.filter((s) => s.fallback_chain && s.fallback_chain.length > 0).length, 0);
  lines.push(`> 降级触发子项：${fallbackCount}`);
  return lines.join("\n") + "\n";
}

function humanizeField(field: string): string {
  const map: Record<string, string> = {
    search_popularity: "搜索人气",
    search_index: "搜索指数",
    search_value: "搜索值",
    pay_buyers: "支付买家数",
    click_rate: "点击率",
    pay_rate: "支付率",
    conversion_rate: "转化率",
    search_growth_rate: "搜索增长率",
    search_popularity_mom: "搜索人气月环比",
    search_popularity_yoy: "搜索人气年同比",
    pay_buyers_mom: "支付买家月环比",
    pay_buyers_yoy: "支付买家年同比",
    demand_supply_ratio: "供需比",
    tmall_click_share: "天猫点击份额",
    relation_strength: "关联强度",
    search_visitors: "搜索访客数",
  };
  return map[field] ?? field;
}

function humanizeSubscore(name: string): string {
  const map: Record<string, string> = {
    scale: "规模分",
    growth: "增长分",
    traffic: "流量分",
    conversion: "转化分",
    intent_multiplier: "意图加成",
    blue_ocean: "蓝海分",
  };
  return map[name] ?? name;
}

function hasFallbackTriggered(scored: KeywordScoreRecord[]): boolean {
  return scored.some((r) => r.explanation.subscores.some((s) => s.fallback_chain && s.fallback_chain.length > 0));
}