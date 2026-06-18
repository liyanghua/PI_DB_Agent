// trace.ts: run 目录读写 + meta + jsonl 流式落盘
// run_id = <YYYYMMDDHHmm>__<strategy>__<categoryId>__<sha8>

import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, readJson, readText, writeJson, writeJsonl, writeText } from "../../lib/io.js";
import type { RunMeta } from "./types.js";

const RUNS_ROOT = "registry/derived/keyword_demand";

export function buildRunId(strategy: string, categoryId: string, configHash: string): string {
  const ts = formatTimestamp(new Date());
  return `${ts}__${strategy}__${categoryId}__${configHash.slice(0, 8)}`;
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function hashConfig(parts: unknown[]): string {
  const h = createHash("sha256");
  for (const p of parts) {
    h.update(typeof p === "string" ? p : JSON.stringify(p));
  }
  return h.digest("hex");
}

export function runDir(runId: string): string {
  return join(RUNS_ROOT, runId);
}

export function initRun(meta: RunMeta): string {
  const dir = runDir(meta.run_id);
  ensureDir(dir);
  writeJson(join(dir, "run.meta.json"), meta);
  return dir;
}

export function writeRunInput(dir: string, input: unknown): void {
  writeJson(join(dir, "input.json"), input);
}

export function writeNormalizeReport(dir: string, report: unknown): void {
  writeJson(join(dir, "normalize_report.json"), report);
}

export function writeClassifyTrace(dir: string, lines: object[]): void {
  writeJsonl(join(dir, "classify_trace.jsonl"), lines);
}

export function writeScoreTrace(dir: string, lines: object[]): void {
  writeJsonl(join(dir, "score_trace.jsonl"), lines);
}

export function writeKeywordScores(dir: string, scored: unknown): void {
  writeJson(join(dir, "keyword_scores.json"), scored);
}

export function writeCategoryTopKeywords(dir: string, top: unknown): void {
  writeJson(join(dir, "category_top_keywords.json"), top);
}

export function writeReportMd(dir: string, md: string): void {
  writeText(join(dir, "keyword_baseline_report.md"), md);
}

export function writeRunSummary(dir: string, md: string): void {
  writeText(join(dir, "run_summary.md"), md);
}

export function finalizeRun(dir: string, meta: RunMeta): void {
  writeJson(join(dir, "run.meta.json"), meta);
}

export function listRuns(opts?: { limit?: number; category?: string; strategy?: string }): RunMeta[] {
  const o = { limit: 50, ...opts };
  let entries: string[];
  try {
    entries = readdirSync(RUNS_ROOT);
  } catch {
    return [];
  }

  const result: RunMeta[] = [];
  for (const id of entries) {
    if (id.startsWith("_")) continue; // _compare / _eval
    const metaPath = join(RUNS_ROOT, id, "run.meta.json");
    try {
      const stat = statSync(metaPath);
      if (!stat.isFile()) continue;
      const meta = readJson<RunMeta>(metaPath);
      if (o.category && meta.category !== o.category) continue;
      if (o.strategy && meta.strategy !== o.strategy) continue;
      result.push(meta);
    } catch {
      continue;
    }
  }

  return result
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
    .slice(0, o.limit);
}

export function getRunMeta(runId: string): RunMeta | null {
  try {
    return readJson<RunMeta>(join(RUNS_ROOT, runId, "run.meta.json"));
  } catch {
    return null;
  }
}

export function getRunSummary(runId: string): string | null {
  try {
    return readText(join(RUNS_ROOT, runId, "run_summary.md"));
  } catch {
    return null;
  }
}

export function getRunFile<T = unknown>(runId: string, filename: string): T | null {
  try {
    return readJson<T>(join(RUNS_ROOT, runId, filename));
  } catch {
    return null;
  }
}

export const RUNS_ROOT_PATH = RUNS_ROOT;