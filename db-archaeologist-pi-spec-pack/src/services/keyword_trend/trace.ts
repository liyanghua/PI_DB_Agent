// trace.ts: keyword_trend run 目录读写 + meta
// run_id = <YYYYMMDDHHmm>__<strategy>__<categoryId>__<sha8>
// mirror keyword_demand/trace.ts，只换根目录与 capability 名

import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, readJson, writeJson } from "../../lib/io.js";
import type { TrendRunMeta, TrendResult } from "./types.js";

const RUNS_ROOT = "registry/derived/keyword_trend";

export function buildTrendRunId(strategy: string, categoryId: string, configHash: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${ts}__${strategy}__${categoryId}__${configHash.slice(0, 8)}`;
}

export function hashConfig(parts: unknown[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(typeof p === "string" ? p : JSON.stringify(p));
  return h.digest("hex");
}

export function initTrendRun(meta: TrendRunMeta): string {
  const dir = join(RUNS_ROOT, meta.run_id);
  ensureDir(dir);
  writeJson(join(dir, "run.meta.json"), meta);
  return dir;
}

export function finalizeTrendRun(dir: string, meta: TrendRunMeta): void {
  writeJson(join(dir, "run.meta.json"), meta);
}

export function listTrendRuns(opts?: { limit?: number; category?: string }): TrendRunMeta[] {
  let entries: string[];
  try {
    entries = readdirSync(RUNS_ROOT);
  } catch {
    return [];
  }
  const out: TrendRunMeta[] = [];
  for (const id of entries) {
    if (id.startsWith("_")) continue;
    try {
      const meta = readJson<TrendRunMeta>(join(RUNS_ROOT, id, "run.meta.json"));
      if (opts?.category && meta.category !== opts.category) continue;
      out.push(meta);
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => (a.started_at < b.started_at ? 1 : -1)).slice(0, opts?.limit ?? 50);
}

export function getTrendRunMeta(runId: string): TrendRunMeta | null {
  try {
    return readJson<TrendRunMeta>(join(RUNS_ROOT, runId, "run.meta.json"));
  } catch {
    return null;
  }
}

export function getTrendResult(runId: string): TrendResult | null {
  try {
    return readJson<TrendResult>(join(RUNS_ROOT, runId, "trend_result.json"));
  } catch {
    return null;
  }
}

export const TREND_RUNS_ROOT = RUNS_ROOT;