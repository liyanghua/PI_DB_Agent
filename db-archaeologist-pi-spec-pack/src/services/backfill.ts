// backfill.ts — pure card transformer.
// 给定 cards + 可选 probeSamples，按以下规则补全：
//
// 1. 若卡片有 example 但 fields 为空 → inferFieldsFromExample 直接补
// 2. 若提供了 probe sample 且 status==ok → 把 payload 填进 example、fields 反推合并
// 3. 重算 quality_score / quality_breakdown / lifecycle_status
//
// 已有 fields（人工写的 desc）不会被覆盖，仅在没有同 path 的字段时追加。

import type { ApiAssetCard, ResponseField } from "../lib/types.js";
import { inferFieldsFromExample } from "./promotion.js";
import { scoreCard } from "../normalizers/quality_scorer.js";
import { decideLifecycle } from "../normalizers/lifecycle.js";

export type ProbeSample = {
  api_id: string;
  request?: { url?: string; method?: string; body?: unknown; query?: unknown };
  response?: { http?: number; elapsed_ms?: number; payload: unknown };
  captured_at?: string;
};

export type ProbeBundle = { samples: ProbeSample[] };

export type CardChange = {
  api_id: string;
  before: { lifecycle: string; quality: number; fields: number; hasExample: boolean };
  after: { lifecycle: string; quality: number; fields: number; hasExample: boolean };
  source: "example_only" | "probe_payload" | "noop";
  reasons: string[];
};

export type BackfillReport = {
  changed: CardChange[];
  skipped: { api_id: string; reason: string }[];
};

function mergeFields(existing: ResponseField[], inferred: ResponseField[]): ResponseField[] {
  const byPath = new Map(existing.map((f) => [f.path, f]));
  for (const inf of inferred) {
    if (!byPath.has(inf.path)) byPath.set(inf.path, inf);
  }
  return [...byPath.values()];
}

function rescore(card: ApiAssetCard): ApiAssetCard {
  const { score, breakdown } = scoreCard(card);
  const next: ApiAssetCard = { ...card, quality_score: score, quality_breakdown: breakdown };
  const lc = decideLifecycle(next);
  next.lifecycle_status = lc.status;
  return next;
}

function snapshot(c: ApiAssetCard) {
  return {
    lifecycle: c.lifecycle_status,
    quality: c.quality_score,
    fields: c.response_schema?.fields.length ?? 0,
    hasExample: c.response_schema?.example !== null && c.response_schema?.example !== undefined,
  };
}

export function applyBackfill(
  cards: ApiAssetCard[],
  bundle: ProbeBundle | null = null,
): { cards: ApiAssetCard[]; report: BackfillReport } {
  const samples = new Map<string, ProbeSample>();
  if (bundle) for (const s of bundle.samples) samples.set(s.api_id, s);

  const changed: CardChange[] = [];
  const skipped: BackfillReport["skipped"] = [];

  const next = cards.map((c0) => {
    const before = snapshot(c0);
    const reasons: string[] = [];
    let card: ApiAssetCard = c0;
    let source: CardChange["source"] = "noop";

    const sample = samples.get(c0.api_id);
    if (sample && sample.response && sample.response.payload !== undefined && (sample.response.http ?? 0) < 400) {
      const payload = sample.response.payload;
      const root = card.response_schema?.root ?? "data";
      const inferred = inferFieldsFromExample(payload, root);
      const merged = mergeFields(card.response_schema?.fields ?? [], inferred);
      card = {
        ...card,
        response_schema: {
          root,
          fields: merged,
          example: payload,
        },
      };
      reasons.push(`probe_payload http=${sample.response.http ?? "?"}`);
      reasons.push(`fields ${c0.response_schema?.fields.length ?? 0}→${merged.length}`);
      source = "probe_payload";
    } else {
      const fields = card.response_schema?.fields ?? [];
      const ex = card.response_schema?.example;
      if (fields.length === 0 && ex !== null && ex !== undefined) {
        const root = card.response_schema?.root ?? "data";
        const inferred = inferFieldsFromExample(ex, root);
        if (inferred.length > 0) {
          card = {
            ...card,
            response_schema: { root, fields: inferred, example: ex },
          };
          reasons.push(`infer_from_example fields 0→${inferred.length}`);
          source = "example_only";
        }
      }
    }

    if (source === "noop") {
      if (sample) skipped.push({ api_id: c0.api_id, reason: `probe http=${sample.response?.http ?? "?"}` });
      return c0;
    }

    const rescored = rescore(card);
    const after = snapshot(rescored);
    if (after.lifecycle !== before.lifecycle) reasons.push(`lifecycle ${before.lifecycle}→${after.lifecycle}`);
    if (after.quality !== before.quality) reasons.push(`quality ${before.quality}→${after.quality}`);
    changed.push({ api_id: c0.api_id, before, after, source, reasons });
    return rescored;
  });

  return { cards: next, report: { changed, skipped } };
}

export function renderBackfillMd(rep: BackfillReport): string {
  const lines: string[] = [];
  lines.push("# Backfill report");
  lines.push("");
  lines.push(`Changed: ${rep.changed.length}`);
  lines.push(`Skipped: ${rep.skipped.length}`);
  lines.push("");
  const promoted = rep.changed.filter((c) => c.before.lifecycle !== c.after.lifecycle);
  lines.push(`Lifecycle promoted: ${promoted.length}`);
  lines.push("");
  lines.push("| api_id | source | before | after | reasons |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const c of rep.changed) {
    const b = `${c.before.lifecycle}/${c.before.quality}/${c.before.fields}f`;
    const a = `${c.after.lifecycle}/${c.after.quality}/${c.after.fields}f`;
    lines.push(`| \`${c.api_id}\` | ${c.source} | ${b} | ${a} | ${c.reasons.join("; ")} |`);
  }
  if (rep.skipped.length > 0) {
    lines.push("");
    lines.push("## Skipped");
    for (const s of rep.skipped) lines.push(`- \`${s.api_id}\`: ${s.reason}`);
  }
  return lines.join("\n") + "\n";
}