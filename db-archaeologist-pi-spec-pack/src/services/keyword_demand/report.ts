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
  if (meta.analysis_pack_name) lines.push(`> 策略包：${meta.analysis_pack_name}`);
  if (meta.requested_category && meta.requested_category !== meta.analysis_category) {
    lines.push(`> 原始输入：${meta.requested_category} → 分析类目：${meta.analysis_category}`);
  }
  lines.push(`> 生成时间：${meta.started_at}`);
  lines.push(`> 关键词样本量：${scored.length} 个`);
  lines.push("");

  if (meta.live_probe) {
    lines.push("## 零、数据来源说明");
    lines.push("");
    lines.push(...renderLiveProvenance(meta));
    lines.push("");
  }

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

  // 4. 按规模 / 增速 / 流量 / 转化 TOP 词
  const metricCn: Record<string, string> = {
    scale: "规模分",
    growth: "增速分",
    traffic: "流量分",
    conversion: "转化分",
  };
  const hasMetric = Object.values(rank.top_by_metric).some((l) => l && l.length > 0);
  if (hasMetric) {
    lines.push("## 四、按规模 / 增速 / 流量 / 转化 TOP 词");
    lines.push("");
    for (const metric of ["scale", "growth", "traffic", "conversion"]) {
      const list = rank.top_by_metric[metric];
      if (!list || list.length === 0) continue;
      lines.push(`### ${metricCn[metric]} TOP`);
      lines.push("");
      lines.push("| 排名 | 关键词 | 单项分 | 综合 KDS | 需求类型 |");
      lines.push("| --- | --- | --- | --- | --- |");
      list.slice(0, 5).forEach((r, i) => {
        const single = (r.scores as Record<string, number | undefined>)[metric];
        const singleTxt = typeof single === "number" ? single.toFixed(1) : "—";
        const types = r.labels.filter((l) => !["category", "unknown"].includes(l)).map((l) => TYPE_CN[l] ?? l).join("、") || "其他";
        lines.push(`| ${i + 1} | ${r.keyword} | ${singleTxt} | ${r.scores.kds.toFixed(1)} | ${types} |`);
      });
      lines.push("");
    }
  }

  // 5. 蓝海词榜
  if (rank.top_by_blue_ocean && rank.top_by_blue_ocean.length > 0) {
    lines.push("## 五、蓝海词榜");
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

  // 6. 高潜机会词（candidate_demand：KDS 70-85，带具体诉求标签）
  const intentLabelSet = new Set(["function", "spec", "style", "material", "season", "target_user", "population"]);
  const hasIntent = (r: KeywordScoreRecord) => r.labels.some((l) => intentLabelSet.has(l));
  const isTxBlock = (r: KeywordScoreRecord) => r.labels.includes("transaction_block");
  const oppoCandidates = scored
    .filter((r) => !isTxBlock(r))
    .filter((r) => hasIntent(r))
    .filter((r) => r.scores.kds >= 70 && r.scores.kds < 85)
    .sort((a, b) => b.scores.kds - a.scores.kds)
    .slice(0, 10);
  lines.push("## 六、高潜机会词");
  lines.push("");
  lines.push("> 进入条件：KDS ∈ [70, 85)，含至少一个具体诉求标签（功能 / 规格 / 风格 / 材质 / 人群 / 季节）。");
  lines.push("");
  if (oppoCandidates.length === 0) {
    lines.push("_暂无符合条件的关键词。_");
    lines.push("");
  } else {
    lines.push("| 排名 | 关键词 | KDS | 主导维度 | 需求类型 |");
    lines.push("| --- | --- | --- | --- | --- |");
    oppoCandidates.forEach((r, i) => {
      const types = r.labels.filter((l) => !["category", "unknown"].includes(l)).map((l) => TYPE_CN[l] ?? l).join("、") || "其他";
      lines.push(`| ${i + 1} | ${r.keyword} | ${r.scores.kds.toFixed(1)} | ${dominantDim(r)} | ${types} |`);
    });
    lines.push("");
  }

  // 7. 待补证词（proof_ready 55-70；或 growth>=80 且 scale<50；或 style 词高热但 conversion<50）
  const proofWords = scored
    .filter((r) => !isTxBlock(r))
    .filter((r) => {
      const s = r.scores;
      const isProofLevel = s.kds >= 55 && s.kds < 70;
      const growthGap = s.growth >= 80 && s.scale < 50;
      const styleGap = r.labels.includes("style") && s.conversion < 50;
      return isProofLevel || growthGap || styleGap;
    })
    .sort((a, b) => b.scores.kds - a.scores.kds)
    .slice(0, 10);
  lines.push("## 七、待补证词");
  lines.push("");
  lines.push("> 进入条件：KDS ∈ [55, 70)；或增速分 ≥ 80 且规模分 < 50（小而快）；或风格词高热但转化分 < 50（看货不下单）。");
  lines.push("");
  if (proofWords.length === 0) {
    lines.push("_暂无符合条件的关键词。_");
    lines.push("");
  } else {
    lines.push("| 排名 | 关键词 | KDS | 触发条件 | 需求类型 |");
    lines.push("| --- | --- | --- | --- | --- |");
    proofWords.forEach((r, i) => {
      const reasons: string[] = [];
      if (r.scores.kds >= 55 && r.scores.kds < 70) reasons.push("整体待验证");
      if (r.scores.growth >= 80 && r.scores.scale < 50) reasons.push("小而快（增速强、规模弱）");
      if (r.labels.includes("style") && r.scores.conversion < 50) reasons.push("风格词转化弱");
      const types = r.labels.filter((l) => !["category", "unknown"].includes(l)).map((l) => TYPE_CN[l] ?? l).join("、") || "其他";
      lines.push(`| ${i + 1} | ${r.keyword} | ${r.scores.kds.toFixed(1)} | ${reasons.join("；")} | ${types} |`);
    });
    lines.push("");
  }

  // 8. 噪音 / 排除词
  const txBlockList = scored.filter(isTxBlock);
  const rejectList = scored
    .filter((r) => !isTxBlock(r))
    .filter((r) => r.explanation.kds_level === "reject" || r.scores.kds < 40);
  const observeList = scored
    .filter((r) => !isTxBlock(r))
    .filter((r) => r.explanation.kds_level === "observe");
  lines.push("## 八、噪音 / 排除词");
  lines.push("");
  lines.push(`- 噪音词（KDS < 40）：${rejectList.length} 个`);
  lines.push(`- 观察词（KDS 40-55）：${observeList.length} 个`);
  lines.push(`- 交易阻塞词（链接 / 价格 / 哪里买类）：${txBlockList.length} 个`);
  lines.push("");
  if (txBlockList.length > 0) {
    lines.push("**交易阻塞词样例（前 5 个，建议在主图、详情页、客服话术里直接承接）**：");
    lines.push("");
    txBlockList.slice(0, 5).forEach((r, i) => {
      lines.push(`${i + 1}. ${r.keyword}`);
    });
    lines.push("");
  }
  if (rejectList.length > 0) {
    lines.push("**噪音词样例（前 5 个，不建议进入需求挖掘）**：");
    lines.push("");
    rejectList.slice(0, 5).forEach((r, i) => {
      lines.push(`${i + 1}. ${r.keyword}（KDS ${r.scores.kds.toFixed(1)}）`);
    });
    lines.push("");
  }

  // 9. 下一步 GAP 诊断建议
  const strongCount = scored.filter((r) => r.explanation.kds_level === "strong_demand").length;
  const candidateCount = scored.filter((r) => r.explanation.kds_level === "candidate_demand").length;
  const proofCount = scored.filter((r) => r.explanation.kds_level === "proof_ready").length;
  lines.push("## 九、下一步 GAP 诊断建议");
  lines.push("");
  const gaps: string[] = [];
  if (strongCount > 0) {
    gaps.push(`- 抢量动作：${strongCount} 个强需求词，建议优先做标题承接、付费拉新、人群放量。`);
  } else {
    gaps.push("- 抢量动作：暂无强需求词，先在 TOP 总榜里挑前 3 名做小流量验证。");
  }
  if (candidateCount > 0) {
    gaps.push(`- 上链路动作：${candidateCount} 个有效需求词，建议进入主图 / 详情页证明 + A/B 验证转化。`);
  }
  if (proofCount > 0 || proofWords.length > 0) {
    gaps.push(`- 数据补证动作：${Math.max(proofCount, proofWords.length)} 个待补证词，建议补 30 天回流数据再判断（小而快与风格词需要更长观察窗）。`);
  }
  if (txBlockList.length > 0) {
    gaps.push(`- 入店动线动作：${txBlockList.length} 个交易阻塞词反映用户已到购买决策末端，建议优化尺寸表、价格锚点、链接落地、客服 FAQ。`);
  }
  const totalScored = scored.length;
  const noiseRate = totalScored > 0 ? rejectList.length / totalScored : 0;
  if (noiseRate >= 0.3) {
    gaps.push(`- 数据质量动作：噪音占比 ${(noiseRate * 100).toFixed(0)}% 偏高，建议补关键词清洗规则或缩窄品类边界。`);
  }
  if (normalize_report.degradations.length > 0) {
    gaps.push(`- 字段补齐动作：${normalize_report.degradations.length} 个关键词触发字段降级，下一轮拉数前补齐 \`pay_buyers / click_rate / pay_rate\` 任一字段。`);
  }
  for (const g of gaps) lines.push(g);
  lines.push("");

  // 10. TOP 5 详细归因
  lines.push("## 十、TOP 5 详细归因");
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

  // 11. 计算过程提醒
  if (normalize_report.degradations.length > 0 || hasFallbackTriggered(scored)) {
    lines.push("## 十一、计算过程提醒");
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
  if (meta.live_probe && meta.pull_report) {
    lines.push(`> 数据来源：live · ${meta.pull_report.effective_apis}/${Object.keys(meta.pull_report.per_api).length} 接口可用 · 关键词 ${scored.length} 个 · 解析方式 ${resolutionLabel(meta.resolution?.kind)}`);
    lines.push("");
  }
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
  };
  return map[name] ?? name;
}

function dominantDim(r: KeywordScoreRecord): string {
  const dims: Array<{ name: string; value: number }> = [
    { name: "规模", value: r.scores.scale },
    { name: "增速", value: r.scores.growth },
    { name: "流量", value: r.scores.traffic },
    { name: "转化", value: r.scores.conversion },
  ];
  dims.sort((a, b) => b.value - a.value);
  return `${dims[0].name}（${dims[0].value.toFixed(0)}）`;
}

function hasFallbackTriggered(scored: KeywordScoreRecord[]): boolean {
  return scored.some((r) => r.explanation.subscores.some((s) => s.fallback_chain && s.fallback_chain.length > 0));
}

function resolutionLabel(kind?: string): string {
  switch (kind) {
    case "taxonomy":      return "本地类目库命中";
    case "user_id":       return "用户直传 category_id";
    case "auto_resolved": return "自动反查淘宝类目库";
    case "mock_fixture_fallback": return "mock 兜底回落";
    case "partial_no_id": return "局部模式（缺 category_id）";
    default:              return "未知";
  }
}

const PULL_STATUS_CN: Record<string, string> = {
  ok: "成功",
  empty: "成功但 0 行",
  business_empty: "业务空（路径正确但区间无数据）",
  business_failed: "业务失败（code 非成功）",
  data_root_null: "data 字段为空 / 缺失",
  root_path_mismatch: "响应路径与卡片不一致",
  keyword_field_missing: "找不到关键词字段",
  context_mismatch: "返回类目/时间与请求不一致",
  skipped_missing_category_id: "跳过（缺 category_id）",
  missing_required_params: "跳过（缺必填参数）",
  not_registered: "跳过（接口未登记）",
  live_disabled: "跳过（LIVE_PROBE 未开启）",
  env_missing: "跳过（环境变量缺失）",
  http_error: "上游 HTTP 错误",
  network_error: "网络错误",
  timeout: "超时",
  unexpected_payload: "响应结构不识别",
};

function truncate(s: string | undefined, n: number): string {
  if (!s) return "";
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= n) return flat;
  return flat.slice(0, n - 1) + "…";
}

function renderLiveProvenance(meta: import("./types.js").RunMeta): string[] {
  const lines: string[] = [];
  const resolution = meta.resolution;
  const pull = meta.pull_report;

  lines.push(`- 类目解析：${resolutionLabel(resolution?.kind)}${
    resolution?.matched_category_id ? `（命中 category_id=${resolution.matched_category_id}）` : ""
  }`);
  if (resolution?.kind === "auto_resolved" && resolution.auto_resolve) {
    const ar = resolution.auto_resolve;
    const top = ar.candidates?.slice(0, 3).map((c) => `${c.cate_name}(${c.cate_id})`).join("、") ?? "";
    lines.push(`  - 反查接口：${ar.api_id ?? "n/a"}，候选 ${ar.total_returned ?? 0} 条；TOP 命中：${top || "—"}`);
  }
  if (resolution?.kind === "partial_no_id" && resolution.auto_resolve) {
    lines.push(`  - 自动反查未命中：${resolution.auto_resolve.reason ?? resolution.auto_resolve.status}（仅用 tertiary_category 拉数）`);
  }
  if (resolution?.kind === "mock_fixture_fallback" && resolution.mock_fixture_fallback) {
    const fb = resolution.mock_fixture_fallback;
    lines.push(`  - mock 回落：${fb.requested_category_name} → ${fb.selected_category_name}（${fb.selected_category_id}）`);
  }

  if (meta.date_range) {
    lines.push(`- 时间窗：${meta.date_range.start_date} ~ ${meta.date_range.end_date}`);
  }

  if (pull) {
    const totalApis = Object.keys(pull.per_api).length;
    lines.push(`- 数据源：${pull.effective_apis}/${totalApis} 个接口出数，合计 ${pull.total_keywords} 条原始关键词`);
    lines.push("");
    lines.push("| 接口 | 状态 | 行数 | 提示 | 备注 |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const [api, st] of Object.entries(pull.per_api)) {
      const statusCn = PULL_STATUS_CN[st.status] ?? st.status;
      const total = st.total != null ? String(st.total) : "—";
      const hint = truncate(st.hint, 80);
      const note = truncate(st.note ?? st.error ?? "", 60);
      lines.push(`| ${api} | ${statusCn} | ${total} | ${hint || "—"} | ${note || "—"} |`);
    }

    // 可能原因清单
    const statusCounts: Record<string, number> = {};
    for (const st of Object.values(pull.per_api)) {
      statusCounts[st.status] = (statusCounts[st.status] ?? 0) + 1;
    }
    const advices: string[] = [];
    if ((statusCounts.business_failed ?? 0) > 0) {
      const failedSamples: string[] = [];
      for (const [api, st] of Object.entries(pull.per_api)) {
        if (st.status === "business_failed") {
          failedSamples.push(`${api}: code=${String(st.code ?? "?")}, msg=${truncate(st.msg, 40) || "—"}`);
        }
      }
      advices.push(`存在 ${statusCounts.business_failed} 个接口业务失败：${failedSamples.slice(0, 3).join("；")}。建议联系研发或核对凭据/权限。`);
    }
    if ((statusCounts.root_path_mismatch ?? 0) > 0) {
      advices.push(`有 ${statusCounts.root_path_mismatch} 个接口的 cards.response_schema.root 与生产侧实际路径不一致，需要修订 cards 后重跑。`);
    }
    if ((statusCounts.data_root_null ?? 0) > 0) {
      advices.push(`有 ${statusCounts.data_root_null} 个接口返回 data=null/缺失，可能是上游未实现该数据切片或权限缺失。`);
    }
    if ((statusCounts.keyword_field_missing ?? 0) > 0) {
      advices.push(`有 ${statusCounts.keyword_field_missing} 个接口能取到行但找不到关键词字段，需要修订 keyword_field_mapping.yaml.apis[*].keyword_field。`);
    }
    if (
      pull.effective_apis === 0
      && (statusCounts.business_empty ?? 0) === Object.keys(pull.per_api).length
    ) {
      advices.push(`所有接口均为业务空：路径与字段都正确，但所选类目 / 时间区间内无关键词数据。建议换一个时间区间或核对 category_id 是否对应有数据的类目。`);
    }
    if (advices.length) {
      lines.push("");
      lines.push("**可能原因：**");
      for (const a of advices) lines.push(`- ${a}`);
    }
  }

  if (resolution?.kind === "partial_no_id") {
    lines.push("");
    lines.push("> ⚠️ 当前为局部模式：未取到 category_id，月度行业关键词等接口被跳过，规模 / 增速维度可能偏弱。建议补充 category_id 后重跑。");
  }

  return lines;
}
