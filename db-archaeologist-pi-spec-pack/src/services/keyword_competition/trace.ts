// src/services/keyword_competition/trace.ts
// CPS run 目录读写 + meta + jsonl 流式落盘。
// run_id = <YYYYMMDDHHmm>__cps__<categoryId>__<sha8>

import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, readJson, readText, writeJson, writeJsonl, writeText } from "../../lib/io.js";
import type { CpsRunMeta } from "./types.js";

const RUNS_ROOT = "registry/derived/keyword_analysis_pack/keyword_competition";
const DIAG_ROOT = "registry/derived/keyword_analysis_pack/keyword_competition/_diag";

export function buildCpsRunId(strategy: string, categoryId: string, configHash: string): string {
  const ts = formatTimestamp(new Date());
  return `${ts}__${strategy}__${categoryId}__${configHash.slice(0, 8)}`;
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function hashCpsConfig(parts: unknown[]): string {
  const h = createHash("sha256");
  for (const p of parts) {
    if (p === undefined || p === null) {
      h.update("__null__");
      continue;
    }
    h.update(typeof p === "string" ? p : JSON.stringify(p));
  }
  return h.digest("hex");
}

export function cpsRunDir(runId: string): string {
  return join(RUNS_ROOT, runId);
}

export function initCpsRun(meta: CpsRunMeta): string {
  const dir = cpsRunDir(meta.run_id);
  ensureDir(dir);
  writeJson(join(dir, "run.meta.json"), meta);
  return dir;
}

export function writeCpsRunInput(dir: string, input: unknown): void {
  writeJson(join(dir, "input.json"), input);
}

export function writeCpsNormalizeReport(dir: string, report: unknown): void {
  writeJson(join(dir, "normalize_report.json"), report);
}

export function writeCpsScoreTrace(dir: string, lines: object[]): void {
  writeJsonl(join(dir, "score_trace.jsonl"), lines);
}

export function writeCpsScores(dir: string, scored: unknown): void {
  writeJson(join(dir, "cps_scores.json"), scored);
}

export function writeCpsTop(dir: string, top: unknown): void {
  writeJson(join(dir, "cps_top.json"), top);
}

export function writeCpsCategoryMetrics(dir: string, metrics: unknown): void {
  writeJson(join(dir, "cps_category_metrics.json"), metrics);
}

export function writeCpsKeywordCpc(dir: string, metrics: unknown): void {
  writeJson(join(dir, "cps_keyword_cpc.json"), metrics);
}

export function writeCpsPullReport(dir: string, report: unknown): void {
  writeJson(join(dir, "pull_report.json"), report);
}

export function writeCpsLiveProbeResults(dir: string, bundle: unknown): void {
  writeJson(join(dir, "live_probe_results.json"), bundle);
}

export function writeCpsReportMd(dir: string, md: string): void {
  writeText(join(dir, "cps_report.md"), md);
}

export function writeCpsRunSummary(dir: string, md: string): void {
  writeText(join(dir, "run_summary.md"), md);
}

export function finalizeCpsRun(dir: string, meta: CpsRunMeta): void {
  writeJson(join(dir, "run.meta.json"), meta);
}

export function listCpsRuns(opts?: { limit?: number; category?: string; strategy?: string }): CpsRunMeta[] {
  const o = { limit: 50, ...opts };
  let entries: string[];
  try {
    entries = readdirSync(RUNS_ROOT);
  } catch {
    return [];
  }
  const result: CpsRunMeta[] = [];
  for (const id of entries) {
    if (id.startsWith("_")) continue;
    const metaPath = join(RUNS_ROOT, id, "run.meta.json");
    try {
      const stat = statSync(metaPath);
      if (!stat.isFile()) continue;
      const meta = readJson<CpsRunMeta>(metaPath);
      if (o.category && meta.category !== o.category) continue;
      if (o.strategy && meta.strategy !== o.strategy) continue;
      result.push(meta);
    } catch {
      continue;
    }
  }
  return result.sort((a, b) => (a.started_at < b.started_at ? 1 : -1)).slice(0, o.limit);
}

export function getCpsRunMeta(runId: string): CpsRunMeta | null {
  try {
    return readJson<CpsRunMeta>(join(RUNS_ROOT, runId, "run.meta.json"));
  } catch {
    return null;
  }
}

export function getCpsRunSummary(runId: string): string | null {
  try {
    return readText(join(RUNS_ROOT, runId, "run_summary.md"));
  } catch {
    return null;
  }
}

export function getCpsRunFile<T = unknown>(runId: string, filename: string): T | null {
  try {
    return readJson<T>(join(RUNS_ROOT, runId, filename));
  } catch {
    return null;
  }
}

export const CPS_RUNS_ROOT_PATH = RUNS_ROOT;
export const CPS_DIAG_ROOT_PATH = DIAG_ROOT;