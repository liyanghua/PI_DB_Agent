// compare.ts: 对比两个 run（§3a.2）
// 9 节输出：配置 diff / TOP_k 重叠 / 排名相关性 / 词位移 / KDS 分布 / 标签分布 / 跨榜单 / 决议建议

import { join } from "node:path";
import { ensureDir, readJson, writeJson, writeText } from "../../lib/io.js";
import type { CompareResult, KeywordScoreRecord, RankResult, RunMeta } from "./types.js";
import { RUNS_ROOT_PATH } from "./trace.js";

export interface CompareInput {
  run_id_a: string;
  run_id_b: string;
  top_k?: number;
}

export interface CompareOutput {
  result: CompareResult;
  paths: { json: string; md: string };
}

export interface CompareError {
  error: string;
  details?: string;
}

const COMPARE_DIR = join(RUNS_ROOT_PATH, "_compare");

export async function compareRuns(input: CompareInput): Promise<CompareOutput | CompareError> {
  const k = input.top_k ?? 20;
  const a = loadRun(input.run_id_a);
  const b = loadRun(input.run_id_b);
  if ("error" in a) return a;
  if ("error" in b) return b;

  // 校验：同 category_id
  if (a.meta.category_id !== b.meta.category_id) {
    return {
      error: "category_mismatch",
      details: `run_a category_id=${a.meta.category_id} 与 run_b ${b.meta.category_id} 不同，禁止对比`,
    };
  }

  // 1. 配置 diff
  const config_diff: Record<string, { a: unknown; b: unknown }> = {};
  const fields: Array<keyof RunMeta> = ["strategy", "weights_hash", "taxonomy_hash", "fixture_hash", "version"];
  for (const f of fields) {
    if (a.meta[f] !== b.meta[f]) {
      config_diff[String(f)] = { a: a.meta[f], b: b.meta[f] };
    }
  }
  if (a.scored.length !== b.scored.length) {
    config_diff.sample_count = { a: a.scored.length, b: b.scored.length };
  }

  // 2. TOP_k 重叠度
  const topA = a.rank.top_overall.slice(0, k).map((r) => r.keyword);
  const topB = b.rank.top_overall.slice(0, k).map((r) => r.keyword);
  const setA = new Set(topA);
  const setB = new Set(topB);
  const overlap = topA.filter((k0) => setB.has(k0));
  const overlap_rate = k === 0 ? 0 : overlap.length / k;

  // 3. 排名相关性（仅在 overlap 内计算）
  const correlation = computeCorrelation(topA, topB, overlap);

  // 4. Top movers（A→B 上升/下降最多的）
  const rankAMap = new Map(topA.map((kw, i) => [kw, i + 1]));
  const rankBMap = new Map(topB.map((kw, i) => [kw, i + 1]));
  const allKw = new Set([...topA, ...topB]);
  const moves: Array<{ keyword: string; rank_a: number; rank_b: number; kds_delta: number }> = [];
  for (const kw of allKw) {
    const ra = rankAMap.get(kw) ?? k + 1;
    const rb = rankBMap.get(kw) ?? k + 1;
    const kdsA = a.scoredMap.get(kw)?.scores.kds ?? 0;
    const kdsB = b.scoredMap.get(kw)?.scores.kds ?? 0;
    moves.push({ keyword: kw, rank_a: ra, rank_b: rb, kds_delta: kdsB - kdsA });
  }
  const rising = [...moves].sort((m1, m2) => (m1.rank_b - m1.rank_a) - (m2.rank_b - m2.rank_a)).slice(0, 5);
  const falling = [...moves].sort((m1, m2) => (m2.rank_b - m2.rank_a) - (m1.rank_b - m1.rank_a)).slice(0, 5);

  // 5. KDS 分布漂移
  const buckets = ["[85,100]", "[70,85)", "[55,70)", "[40,55)", "[0,40)"];
  const kdsDistA = bucketize(a.scored);
  const kdsDistB = bucketize(b.scored);
  const kds_distribution_diff: Record<string, { a: number; b: number; delta: number }> = {};
  for (const bk of buckets) {
    kds_distribution_diff[bk] = { a: kdsDistA[bk] ?? 0, b: kdsDistB[bk] ?? 0, delta: (kdsDistB[bk] ?? 0) - (kdsDistA[bk] ?? 0) };
  }

  // 6. 标签分布差
  const labelDistA = labelDist(a.scored);
  const labelDistB = labelDist(b.scored);
  const allLabels = new Set([...Object.keys(labelDistA), ...Object.keys(labelDistB)]);
  const label_distribution_diff: Record<string, { a: number; b: number; delta: number }> = {};
  for (const l of allLabels) {
    const av = labelDistA[l] ?? 0;
    const bv = labelDistB[l] ?? 0;
    label_distribution_diff[l] = { a: av, b: bv, delta: bv - av };
  }

  // 7. 跨榜单一致性
  const per_metric_overlap: Record<string, number> = {};
  for (const m of ["scale", "growth", "traffic", "conversion"] as const) {
    const aTop = a.rank.top_by_metric[m]?.slice(0, k).map((r) => r.keyword) ?? [];
    const bTop = b.rank.top_by_metric[m]?.slice(0, k).map((r) => r.keyword) ?? [];
    const setBM = new Set(bTop);
    const inter = aTop.filter((kw) => setBM.has(kw)).length;
    per_metric_overlap[m] = aTop.length > 0 ? inter / Math.min(k, aTop.length) : 0;
  }
  const aBlue = a.rank.top_by_blue_ocean?.slice(0, k).map((r) => r.keyword) ?? [];
  const bBlue = b.rank.top_by_blue_ocean?.slice(0, k).map((r) => r.keyword) ?? [];
  const blueSet = new Set(bBlue);
  per_metric_overlap.blue_ocean = aBlue.length > 0 ? aBlue.filter((kw) => blueSet.has(kw)).length / Math.min(k, aBlue.length) : 0;

  // 8. 决议建议
  const recommendation = buildRecommendation(a.meta, b.meta, overlap_rate, correlation.spearman, kds_distribution_diff);

  const result: CompareResult = {
    run_a: a.meta,
    run_b: b.meta,
    config_diff,
    top_k: k,
    overlap_rate,
    overlap_keywords: overlap,
    ranking_correlation: correlation,
    top_movers: { rising, falling },
    kds_distribution_diff,
    label_distribution_diff,
    per_metric_overlap,
    recommendation,
  };

  // 落盘
  ensureDir(COMPARE_DIR);
  const fileBase = `${a.meta.run_id}__${b.meta.run_id}`;
  const jsonPath = join(COMPARE_DIR, `${fileBase}.json`);
  const mdPath = join(COMPARE_DIR, `${fileBase}.md`);
  writeJson(jsonPath, result);
  writeText(mdPath, renderCompareMd(result));

  return { result, paths: { json: jsonPath, md: mdPath } };
}

// ============ 内部辅助 ============

interface LoadedRun {
  meta: RunMeta;
  scored: KeywordScoreRecord[];
  scoredMap: Map<string, KeywordScoreRecord>;
  rank: RankResult;
}

function loadRun(runId: string): LoadedRun | CompareError {
  const dir = join(RUNS_ROOT_PATH, runId);
  try {
    const meta = readJson<RunMeta>(join(dir, "run.meta.json"));
    const scored = readJson<KeywordScoreRecord[]>(join(dir, "keyword_scores.json"));
    const rank = readJson<RankResult>(join(dir, "category_top_keywords.json"));
    const scoredMap = new Map(scored.map((r) => [r.keyword, r]));
    return { meta, scored, scoredMap, rank };
  } catch (err) {
    return { error: "run_not_found", details: `run ${runId}: ${String(err)}` };
  }
}

function bucketize(scored: KeywordScoreRecord[]): Record<string, number> {
  const out: Record<string, number> = { "[85,100]": 0, "[70,85)": 0, "[55,70)": 0, "[40,55)": 0, "[0,40)": 0 };
  for (const r of scored) {
    const k = r.scores.kds;
    if (k >= 85) out["[85,100]"] += 1;
    else if (k >= 70) out["[70,85)"] += 1;
    else if (k >= 55) out["[55,70)"] += 1;
    else if (k >= 40) out["[40,55)"] += 1;
    else out["[0,40)"] += 1;
  }
  return out;
}

function labelDist(scored: KeywordScoreRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of scored) {
    for (const l of r.labels) out[l] = (out[l] ?? 0) + 1;
  }
  return out;
}

function computeCorrelation(
  topA: string[],
  topB: string[],
  overlap: string[],
): { spearman: number; kendall_tau: number; ndcg_at_k: number } {
  if (overlap.length < 2) return { spearman: 0, kendall_tau: 0, ndcg_at_k: 0 };

  const rankA = new Map(topA.map((kw, i) => [kw, i + 1]));
  const rankB = new Map(topB.map((kw, i) => [kw, i + 1]));
  const pairs = overlap.map((kw) => ({ a: rankA.get(kw)!, b: rankB.get(kw)! }));

  // Spearman
  const n = pairs.length;
  const dSquaredSum = pairs.reduce((s, p) => s + (p.a - p.b) ** 2, 0);
  const spearman = 1 - (6 * dSquaredSum) / (n * (n * n - 1));

  // Kendall tau
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const da = pairs[i].a - pairs[j].a;
      const db = pairs[i].b - pairs[j].b;
      if (da * db > 0) concordant += 1;
      else if (da * db < 0) discordant += 1;
    }
  }
  const kendall = (concordant - discordant) / (0.5 * n * (n - 1));

  // NDCG@k：以 A 为相关性基准（topA 第 i 位相关度 = k - i），B 的实际位置算 DCG
  const k = topA.length;
  const idealDcg = topA.reduce((s, _, i) => s + (k - i) / Math.log2(i + 2), 0);
  let dcg = 0;
  for (let i = 0; i < topB.length; i += 1) {
    const aRank = rankA.get(topB[i]);
    if (aRank == null) continue;
    const rel = k - (aRank - 1);
    dcg += rel / Math.log2(i + 2);
  }
  const ndcg = idealDcg === 0 ? 0 : dcg / idealDcg;

  return { spearman, kendall_tau: kendall, ndcg_at_k: ndcg };
}

function buildRecommendation(
  a: RunMeta,
  b: RunMeta,
  overlap_rate: number,
  spearman: number,
  kds_dist: Record<string, { a: number; b: number; delta: number }>,
): string {
  const lines: string[] = [];
  if (a.strategy === b.strategy) {
    lines.push(`两次运行使用同一策略 ${a.strategy}，重点关注配置差异（weights_hash / taxonomy_hash / fixture_hash）。`);
  } else {
    lines.push(`策略变化：${a.strategy} → ${b.strategy}。`);
  }

  if (overlap_rate < 0.6) {
    lines.push(`TOP 重叠率 ${(overlap_rate * 100).toFixed(0)}% 偏低，B 与 A 出现实质排序分歧。`);
  } else if (overlap_rate < 0.85) {
    lines.push(`TOP 重叠率 ${(overlap_rate * 100).toFixed(0)}%，B 在保持主体排序的同时有局部调整。`);
  } else {
    lines.push(`TOP 重叠率 ${(overlap_rate * 100).toFixed(0)}%，B 与 A 排序基本一致。`);
  }

  if (spearman < 0.7) {
    lines.push(`Spearman 相关性 ${spearman.toFixed(2)} 偏低，重叠词在两榜的相对位置差异较大。`);
  }

  const strongDelta = kds_dist["[85,100]"]?.delta ?? 0;
  if (strongDelta > 0) lines.push(`B 相比 A 在强需求段（85+）多识别 ${strongDelta} 个关键词。`);
  else if (strongDelta < 0) lines.push(`B 相比 A 在强需求段少识别 ${Math.abs(strongDelta)} 个关键词。`);

  if (b.strategy !== a.strategy && a.strategy === "baseline_v1") {
    lines.push("");
    lines.push("**若 B 想替代 A 作为新基线，需说明：**");
    lines.push("1. 业务金标 must_include 命中率不低于 baseline；");
    lines.push("2. must_exclude 违反数为 0；");
    lines.push("3. precision@20 ≥ baseline 的 precision@20。");
    lines.push("可执行 `npm run keyword:eval " + b.strategy + "` 验证。");
  }

  return lines.join("\n");
}

function renderCompareMd(r: CompareResult): string {
  const lines: string[] = [];
  lines.push(`# Run 对比报告：${r.run_a.run_id} vs ${r.run_b.run_id}`);
  lines.push("");
  lines.push(`> 类目：${r.run_a.category}（${r.run_a.category_id}）`);
  lines.push(`> Top K：${r.top_k}`);
  lines.push("");

  lines.push("## 一、配置 diff");
  lines.push("");
  if (Object.keys(r.config_diff).length === 0) {
    lines.push("- 无差异（同策略 + 同配置 + 同样本量）");
  } else {
    for (const [k, v] of Object.entries(r.config_diff)) {
      lines.push(`- **${k}**：A=\`${JSON.stringify(v.a)}\` → B=\`${JSON.stringify(v.b)}\``);
    }
  }
  lines.push("");

  lines.push("## 二、TOP_k 重叠度");
  lines.push("");
  lines.push(`- 重叠率：**${(r.overlap_rate * 100).toFixed(1)}%**（${r.overlap_keywords.length}/${r.top_k}）`);
  lines.push(`- 共同 TOP 词：${r.overlap_keywords.slice(0, 20).join("、") || "无"}`);
  lines.push("");

  lines.push("## 三、排名相关性");
  lines.push("");
  lines.push(`- Spearman：${r.ranking_correlation.spearman.toFixed(3)}`);
  lines.push(`- Kendall tau：${r.ranking_correlation.kendall_tau.toFixed(3)}`);
  lines.push(`- NDCG@${r.top_k}：${r.ranking_correlation.ndcg_at_k.toFixed(3)}`);
  lines.push("");

  lines.push("## 四、词位移 Top movers");
  lines.push("");
  lines.push("**A→B 上升最多**：");
  for (const m of r.top_movers.rising) {
    lines.push(`- ${m.keyword}：A 第 ${m.rank_a} 位 → B 第 ${m.rank_b} 位（KDS Δ ${m.kds_delta.toFixed(1)}）`);
  }
  lines.push("");
  lines.push("**A→B 下降最多**：");
  for (const m of r.top_movers.falling) {
    lines.push(`- ${m.keyword}：A 第 ${m.rank_a} 位 → B 第 ${m.rank_b} 位（KDS Δ ${m.kds_delta.toFixed(1)}）`);
  }
  lines.push("");

  lines.push("## 五、KDS 分布漂移");
  lines.push("");
  lines.push("| 区间 | A | B | Δ |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const [bk, v] of Object.entries(r.kds_distribution_diff)) {
    lines.push(`| ${bk} | ${v.a} | ${v.b} | ${v.delta > 0 ? "+" : ""}${v.delta} |`);
  }
  lines.push("");

  lines.push("## 六、标签分布差");
  lines.push("");
  lines.push("| 标签 | A | B | Δ |");
  lines.push("| --- | ---: | ---: | ---: |");
  const sorted = Object.entries(r.label_distribution_diff).sort(([, x], [, y]) => Math.abs(y.delta) - Math.abs(x.delta));
  for (const [l, v] of sorted) {
    lines.push(`| ${l} | ${v.a} | ${v.b} | ${v.delta > 0 ? "+" : ""}${v.delta} |`);
  }
  lines.push("");

  lines.push("## 七、跨榜单一致性");
  lines.push("");
  for (const [m, v] of Object.entries(r.per_metric_overlap)) {
    lines.push(`- ${m} TOP@${r.top_k}：${(v * 100).toFixed(0)}%`);
  }
  lines.push("");

  lines.push("## 八、决议建议");
  lines.push("");
  lines.push(r.recommendation);
  lines.push("");

  return lines.join("\n") + "\n";
}