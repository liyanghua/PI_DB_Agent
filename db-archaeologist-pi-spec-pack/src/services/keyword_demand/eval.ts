// eval.ts: 业务金标评测（§3a.3）
// 输入：strategy + golden anchor 文件目录
// 输出：每类目的 precision@k / recall@k / ndcg@k / must_include_hit_rate / must_exclude_violation_rate
// 接受门槛：precision@20 ≥ baseline 且 must_exclude_violation_rate = 0

import { readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { ensureDir, readJson, readYaml, writeJson, writeText, ROOT } from "../../lib/io.js";
import type { GoldenAnchor, EvalMetrics, KeywordScoreRecord, RankResult, RunMeta } from "./types.js";
import { analyzeKeywordDemand } from "./index.js";
import { RUNS_ROOT_PATH } from "./trace.js";

const EVAL_DIR = join(RUNS_ROOT_PATH, "_eval");
const FIXTURES_GOLD = join(ROOT, "fixtures/keyword_demand_eval");
const FIXTURES_MOCK = join(ROOT, "fixtures/keyword_demand_mock");

export interface EvalCategoryResult {
  category: string;
  category_id: string;
  run_id: string;
  metrics: EvalMetrics;
  must_include_misses: string[];
  must_exclude_violations: string[];
  per_type_anchor_hits: Record<string, { hit: number; total: number }>;
  passed: boolean;
}

export interface EvalReport {
  strategy: string;
  generated_at: string;
  k: number;
  baseline_strategy: string;
  categories: EvalCategoryResult[];
  aggregate: {
    avg_precision_at_k: number;
    avg_recall_at_k: number;
    avg_ndcg_at_k: number;
    avg_must_include_hit_rate: number;
    total_must_exclude_violations: number;
    pass_threshold: boolean;
  };
  comparison_to_baseline?: {
    precision_delta: number;
    must_exclude_violation_delta: number;
    accept_as_baseline_replacement: boolean;
    reasons: string[];
  };
  paths: { json: string; md: string };
}

export interface EvalInput {
  strategy: string;
  k?: number;
  baseline_strategy?: string;
}

/**
 * 跑 strategy 在所有 golden anchor 上的 eval
 */
export async function runEvaluation(input: EvalInput): Promise<EvalReport> {
  const strategy = input.strategy;
  const k = input.k ?? 20;
  const baselineStrategy = input.baseline_strategy ?? "baseline_v1";

  // 列出 fixtures/keyword_demand_eval/ 下所有 golden 文件
  const goldFiles = readdirSync(FIXTURES_GOLD).filter((f) => f.endsWith(".yaml"));
  if (goldFiles.length === 0) throw new Error(`未在 ${FIXTURES_GOLD} 找到 golden 文件`);

  const categoryResults: EvalCategoryResult[] = [];

  for (const gf of goldFiles) {
    const gold = readYaml<GoldenAnchor>(join(FIXTURES_GOLD, gf));
    const cat = gold._meta.category;
    const result = await analyzeKeywordDemand({ category: cat, strategy, live: false });
    if ("error" in result) {
      console.error(`[eval] ${cat} 跑 ${strategy} 失败：${result.error}`);
      continue;
    }
    const scored = readJson<KeywordScoreRecord[]>(join(result.run_dir, "keyword_scores.json"));
    const rank = readJson<RankResult>(join(result.run_dir, "category_top_keywords.json"));
    const evalRes = evaluateOne(gold, scored, rank, k, result.run_id);
    categoryResults.push(evalRes);
  }

  // 聚合
  const aggregate = aggregateMetrics(categoryResults);

  // 与 baseline 对比（如果不是跑的 baseline 自己）
  let comparison_to_baseline: EvalReport["comparison_to_baseline"];
  if (strategy !== baselineStrategy) {
    const baselineReport = readBaselineReport(baselineStrategy);
    if (baselineReport) {
      const precisionDelta = aggregate.avg_precision_at_k - baselineReport.aggregate.avg_precision_at_k;
      const violationDelta = aggregate.total_must_exclude_violations - baselineReport.aggregate.total_must_exclude_violations;
      const reasons: string[] = [];
      if (precisionDelta < 0) reasons.push(`precision@${k} 落后 baseline ${Math.abs(precisionDelta).toFixed(3)}`);
      if (aggregate.total_must_exclude_violations > 0) reasons.push(`must_exclude_violation 数 ${aggregate.total_must_exclude_violations} > 0`);
      const accept = precisionDelta >= 0 && aggregate.total_must_exclude_violations === 0;
      comparison_to_baseline = {
        precision_delta: precisionDelta,
        must_exclude_violation_delta: violationDelta,
        accept_as_baseline_replacement: accept,
        reasons: accept ? ["全部门槛通过"] : reasons,
      };
    }
  }

  const ts = formatTs(new Date());
  ensureDir(EVAL_DIR);
  const jsonPath = join(EVAL_DIR, `${strategy}__${ts}.json`);
  const mdPath = join(EVAL_DIR, `${strategy}__${ts}.md`);

  const report: EvalReport = {
    strategy,
    generated_at: new Date().toISOString(),
    k,
    baseline_strategy: baselineStrategy,
    categories: categoryResults,
    aggregate,
    comparison_to_baseline,
    paths: { json: jsonPath, md: mdPath },
  };

  writeJson(jsonPath, report);
  writeText(mdPath, renderEvalMd(report));

  // 把最近一次 baseline eval 结果存到固定路径供后续对比
  if (strategy === baselineStrategy) {
    writeJson(join(EVAL_DIR, `${baselineStrategy}__latest.json`), report);
  }

  return report;
}

function evaluateOne(
  gold: GoldenAnchor,
  _scored: KeywordScoreRecord[],
  rank: RankResult,
  k: number,
  runId: string,
): EvalCategoryResult {
  const topK = rank.top_overall.slice(0, k).map((r) => r.keyword);
  const topKSet = new Set(topK);

  // must_include 命中率 = 在 topK 内 / 全部
  const includes = gold.top_overall_must_include;
  const excludes = gold.top_overall_must_exclude;
  const hits = includes.filter((kw) => topKSet.has(kw));
  const misses = includes.filter((kw) => !topKSet.has(kw));
  const violations = excludes.filter((kw) => topKSet.has(kw));

  const precision_at_k = topK.length === 0 ? 0 : hits.length / topK.length;
  const recall_at_k = includes.length === 0 ? 1 : hits.length / includes.length;
  const must_include_hit_rate = includes.length === 0 ? 1 : hits.length / includes.length;
  const must_exclude_violation_rate = excludes.length === 0 ? 0 : violations.length / excludes.length;

  // NDCG@k：以 must_include 内顺序作为相关性，hit 位置算 DCG
  const includeRank = new Map(includes.map((kw, i) => [kw, includes.length - i]));
  let dcg = 0;
  for (let i = 0; i < topK.length; i += 1) {
    const rel = includeRank.get(topK[i]) ?? 0;
    dcg += rel / Math.log2(i + 2);
  }
  const idealDcg = includes.reduce((s, _, i) => s + (includes.length - i) / Math.log2(i + 2), 0);
  const ndcg_at_k = idealDcg === 0 ? 0 : dcg / idealDcg;

  // 各 type anchor 命中（从 rank.top_by_type 的对应类型 TOP 中查）
  const per_type_anchor_hits: Record<string, { hit: number; total: number }> = {};
  for (const [type, anchors] of Object.entries(gold.per_type_anchors)) {
    const typeTop = rank.top_by_type[type] ?? [];
    const typeTopSet = new Set(typeTop.map((r) => r.keyword));
    const hit = anchors.filter((a) => typeTopSet.has(a)).length;
    per_type_anchor_hits[type] = { hit, total: anchors.length };
  }

  const passed = precision_at_k > 0 && violations.length === 0;

  return {
    category: gold._meta.category,
    category_id: gold._meta.category_id,
    run_id: runId,
    metrics: { precision_at_k, recall_at_k, ndcg_at_k, must_include_hit_rate, must_exclude_violation_rate },
    must_include_misses: misses,
    must_exclude_violations: violations,
    per_type_anchor_hits,
    passed,
  };
}

function aggregateMetrics(results: EvalCategoryResult[]): EvalReport["aggregate"] {
  if (results.length === 0) {
    return {
      avg_precision_at_k: 0,
      avg_recall_at_k: 0,
      avg_ndcg_at_k: 0,
      avg_must_include_hit_rate: 0,
      total_must_exclude_violations: 0,
      pass_threshold: false,
    };
  }
  const n = results.length;
  const avg_precision_at_k = results.reduce((s, r) => s + r.metrics.precision_at_k, 0) / n;
  const avg_recall_at_k = results.reduce((s, r) => s + r.metrics.recall_at_k, 0) / n;
  const avg_ndcg_at_k = results.reduce((s, r) => s + r.metrics.ndcg_at_k, 0) / n;
  const avg_must_include_hit_rate = results.reduce((s, r) => s + r.metrics.must_include_hit_rate, 0) / n;
  const total_must_exclude_violations = results.reduce((s, r) => s + r.must_exclude_violations.length, 0);
  const pass_threshold = total_must_exclude_violations === 0 && avg_must_include_hit_rate >= 0.6;
  return {
    avg_precision_at_k,
    avg_recall_at_k,
    avg_ndcg_at_k,
    avg_must_include_hit_rate,
    total_must_exclude_violations,
    pass_threshold,
  };
}

function readBaselineReport(strategy: string): EvalReport | null {
  try {
    return readJson<EvalReport>(join(EVAL_DIR, `${strategy}__latest.json`));
  } catch {
    return null;
  }
}

function formatTs(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function renderEvalMd(r: EvalReport): string {
  const lines: string[] = [];
  lines.push(`# 评测报告：${r.strategy}`);
  lines.push("");
  lines.push(`> 生成时间：${r.generated_at}`);
  lines.push(`> Top K：${r.k}`);
  lines.push(`> 基准策略：${r.baseline_strategy}`);
  lines.push("");

  lines.push("## 一、聚合指标");
  lines.push("");
  lines.push(`- 平均 precision@${r.k}：**${r.aggregate.avg_precision_at_k.toFixed(3)}**`);
  lines.push(`- 平均 recall@${r.k}：${r.aggregate.avg_recall_at_k.toFixed(3)}`);
  lines.push(`- 平均 NDCG@${r.k}：${r.aggregate.avg_ndcg_at_k.toFixed(3)}`);
  lines.push(`- 平均 must_include 命中率：${(r.aggregate.avg_must_include_hit_rate * 100).toFixed(1)}%`);
  lines.push(`- must_exclude 违反总数：**${r.aggregate.total_must_exclude_violations}**`);
  lines.push(`- 整体门槛：${r.aggregate.pass_threshold ? "✓ 通过" : "✗ 未通过"}`);
  lines.push("");

  if (r.comparison_to_baseline) {
    lines.push("## 二、对比 baseline");
    lines.push("");
    lines.push(`- precision Δ：${r.comparison_to_baseline.precision_delta >= 0 ? "+" : ""}${r.comparison_to_baseline.precision_delta.toFixed(3)}`);
    lines.push(`- 是否可替代 baseline：${r.comparison_to_baseline.accept_as_baseline_replacement ? "✓ 是" : "✗ 否"}`);
    lines.push(`- 原因：`);
    for (const reason of r.comparison_to_baseline.reasons) lines.push(`  - ${reason}`);
    lines.push("");
  }

  lines.push("## 三、各类目明细");
  lines.push("");
  lines.push("| 类目 | precision | recall | ndcg | 命中率 | 违反数 | 通过 |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | :---: |");
  for (const c of r.categories) {
    lines.push(`| ${c.category} | ${c.metrics.precision_at_k.toFixed(3)} | ${c.metrics.recall_at_k.toFixed(3)} | ${c.metrics.ndcg_at_k.toFixed(3)} | ${(c.metrics.must_include_hit_rate * 100).toFixed(0)}% | ${c.must_exclude_violations.length} | ${c.passed ? "✓" : "✗"} |`);
  }
  lines.push("");

  for (const c of r.categories) {
    lines.push(`### ${c.category}`);
    lines.push("");
    lines.push(`- run_id：\`${c.run_id}\``);
    if (c.must_include_misses.length > 0) {
      lines.push(`- 漏 must_include：${c.must_include_misses.join("、")}`);
    }
    if (c.must_exclude_violations.length > 0) {
      lines.push(`- 违反 must_exclude：${c.must_exclude_violations.join("、")}`);
    }
    lines.push(`- 各类型 anchor 命中：`);
    for (const [type, h] of Object.entries(c.per_type_anchor_hits)) {
      lines.push(`  - ${type}：${h.hit}/${h.total}`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

// 让外部 script 知道 EVAL_DIR 路径
export const EVAL_DIR_PATH = EVAL_DIR;
export const FIXTURES_GOLD_PATH = FIXTURES_GOLD;
export const FIXTURES_MOCK_PATH = FIXTURES_MOCK;