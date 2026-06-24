// aggregate.ts: S3+S4 — 读 capability run_dir，按 keyword 合并成 ScoreVector

import { join } from "node:path";
import { readJson, ROOT } from "../../lib/io.js";
import type { KeywordScoreRecord } from "../keyword_demand/types.js";
import type { TrendResult } from "../keyword_trend/types.js";
import type { CompetitionScoreRecord } from "../keyword_competition/types.js";
import type { CapabilityRunRef, ScoreVectorEntry } from "./types.js";

export interface AggregateScoreVectorInput {
  category: string;
  capability_runs: CapabilityRunRef[];
}

export interface AggregateScoreVectorOutput {
  score_vector: ScoreVectorEntry[];
  available_capabilities: string[];
}

export function aggregateScoreVector(input: AggregateScoreVectorInput): AggregateScoreVectorOutput {
  const map = new Map<string, ScoreVectorEntry>();
  const available_capabilities: string[] = [];

  for (const run of input.capability_runs) {
    if (run.status !== "ok") continue;

    if (run.capability === "kds") {
      const scores = readKeywordScores(run.run_dir);
      if (scores) {
        available_capabilities.push("kds");
        for (const r of scores) {
          const e = upsertEntry(map, r.keyword, input.category);
          e.scores.kds = r.scores.kds;
          e.kds_level = r.explanation?.kds_level;
          e.rank_reason = r.explanation?.rank_reason;
          if (!e.available_scores.includes("kds")) e.available_scores.push("kds");
        }
      }
    }

    if (run.capability === "tms") {
      const result = readTrendResult(run.run_dir);
      if (result) {
        available_capabilities.push("tms");
        for (const r of result.records) {
          const e = upsertEntry(map, r.keyword, input.category);
          e.scores.tms = r.scores.tms;
          e.trend_label = r.trend_label;
          if (!e.available_scores.includes("tms")) e.available_scores.push("tms");
        }
      }
    }

    if (run.capability === "cps") {
      const scores = readCpsScores(run.run_dir);
      if (scores) {
        available_capabilities.push("cps");
        for (const r of scores) {
          const e = upsertEntry(map, r.keyword, input.category);
          e.scores.cps = r.cps;
          const lvl = r.explanation?.cps_level;
          if (lvl === "strong" || lvl === "medium" || lvl === "weak") e.cps_bucket = lvl;
          if (r.cpc_source === "paid" || r.cpc_source === "fallback" || r.cpc_source === "missing") {
            e.cpc_source = r.cpc_source;
          }
          if (!e.available_scores.includes("cps")) e.available_scores.push("cps");
        }
      }
    }
  }

  return { score_vector: Array.from(map.values()), available_capabilities };
}

function upsertEntry(map: Map<string, ScoreVectorEntry>, keyword: string, category: string): ScoreVectorEntry {
  let e = map.get(keyword);
  if (!e) {
    e = {
      subject_kind: "keyword",
      subject_id: keyword,
      keyword,
      category,
      scores: {},
      available_scores: [],
    };
    map.set(keyword, e);
  }
  return e;
}

function readKeywordScores(runDir: string): KeywordScoreRecord[] | null {
  try {
    const abs = runDir.startsWith("/") ? runDir : join(ROOT, runDir);
    return readJson<KeywordScoreRecord[]>(join(abs, "keyword_scores.json"));
  } catch {
    return null;
  }
}

function readTrendResult(runDir: string): TrendResult | null {
  try {
    const abs = runDir.startsWith("/") ? runDir : join(ROOT, runDir);
    return readJson<TrendResult>(join(abs, "trend_result.json"));
  } catch {
    return null;
  }
}

function readCpsScores(runDir: string): CompetitionScoreRecord[] | null {
  try {
    const abs = runDir.startsWith("/") ? runDir : join(ROOT, runDir);
    return readJson<CompetitionScoreRecord[]>(join(abs, "cps_scores.json"));
  } catch {
    return null;
  }
}