// write.ts: S7 — Router run 落盘 + 列举 + 读取
// 根目录：registry/koif_routes/<router_run_id>/

import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, readJson, readText, ROOT, writeJson, writeText } from "../../lib/io.js";
import type {
  NextAction,
  RouterRunMeta,
  ScoreVectorEntry,
  StrategyRouteHit,
} from "./types.js";

const ROUTES_ROOT = "registry/koif_routes";

export function buildRouterRunId(categoryId: string, configHash: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `router_v1__${ts}__${categoryId}__${configHash.slice(0, 8)}`;
}

export function hashRouterConfig(parts: unknown[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(typeof p === "string" ? p : JSON.stringify(p));
  return h.digest("hex");
}

export interface RouterRunBundle {
  meta: RouterRunMeta;
  score_vector: ScoreVectorEntry[];
  strategy_routes: StrategyRouteHit[];
  next_actions: NextAction[];
  report_md: string;
}

export function writeRouterRun(bundle: RouterRunBundle): string {
  const dir = join(ROUTES_ROOT, bundle.meta.router_run_id);
  ensureDir(dir);
  writeJson(join(dir, "router_meta.json"), bundle.meta);
  writeJson(join(dir, "score_vector.json"), bundle.score_vector);
  writeJson(join(dir, "strategy_routes.json"), bundle.strategy_routes);
  writeJson(join(dir, "next_actions.json"), bundle.next_actions);
  writeText(join(dir, "router_report.md"), bundle.report_md);
  return dir;
}

export function listRouterRuns(opts?: { limit?: number; category?: string }): RouterRunMeta[] {
  let entries: string[];
  try {
    entries = readdirSync(ROUTES_ROOT);
  } catch {
    return [];
  }
  const out: RouterRunMeta[] = [];
  for (const id of entries) {
    if (id.startsWith("_")) continue;
    try {
      const meta = readJson<RouterRunMeta>(join(ROUTES_ROOT, id, "router_meta.json"));
      if (opts?.category && meta.category !== opts.category) continue;
      out.push(meta);
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => (a.started_at < b.started_at ? 1 : -1)).slice(0, opts?.limit ?? 50);
}

export function getRouterRun(routerRunId: string): {
  meta: RouterRunMeta;
  score_vector: ScoreVectorEntry[];
  strategy_routes: StrategyRouteHit[];
  next_actions: NextAction[];
  report_md: string;
} | null {
  try {
    const dir = join(ROUTES_ROOT, routerRunId);
    return {
      meta: readJson<RouterRunMeta>(join(dir, "router_meta.json")),
      score_vector: readJson<ScoreVectorEntry[]>(join(dir, "score_vector.json")),
      strategy_routes: readJson<StrategyRouteHit[]>(join(dir, "strategy_routes.json")),
      next_actions: readJson<NextAction[]>(join(dir, "next_actions.json")),
      report_md: readText(join(dir, "router_report.md")),
    };
  } catch {
    return null;
  }
}

export function getRouterReport(routerRunId: string): string | null {
  try {
    return readText(join(ROUTES_ROOT, routerRunId, "router_report.md"));
  } catch {
    return null;
  }
}

export function getRouterActions(routerRunId: string): NextAction[] | null {
  try {
    return readJson<NextAction[]>(join(ROUTES_ROOT, routerRunId, "next_actions.json"));
  } catch {
    return null;
  }
}

export const ROUTER_ROUTES_ROOT = ROUTES_ROOT;