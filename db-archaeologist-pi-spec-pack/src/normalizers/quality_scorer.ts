// 7-factor quality scoring (v2). All factor scores normalized to [0,1].
// Final = 0.20*contract + 0.20*response + 0.15*example + 0.15*semantic
//       + 0.10*lineage  + 0.10*runtime  + 0.10*security
// Without runtime probe, runtime defaults to 0.5 (neutral, no blocking).

import type { ApiAssetCard, ResponseField, ParamRow } from "../lib/types.js";

export type QualityBreakdown = {
  contract: number;
  response: number;
  example: number;
  semantic: number;
  lineage: number;
  runtime: number;
  security: number;
};

const W = {
  contract: 0.2,
  response: 0.2,
  example: 0.15,
  semantic: 0.15,
  lineage: 0.1,
  runtime: 0.1,
  security: 0.1,
};

function fracDescribed(rows: { desc?: string }[]): number {
  if (rows.length === 0) return 0;
  const have = rows.filter(r => (r.desc ?? "").trim().length > 0 && r.desc !== "none").length;
  return have / rows.length;
}

function scoreContract(card: ApiAssetCard): number {
  const req = card.request_schema;
  if (!req) return 0;
  const total = req.query.length + (req.body?.length ?? 0) + req.path_params.length;
  if (total === 0) return 0.4;
  const all = [...req.query, ...(req.body ?? []), ...req.path_params] as ParamRow[];
  const typed = all.filter(p => (p.type ?? "").length > 0).length / total;
  const described = fracDescribed(all);
  const requiredKnown = all.filter(p => p.required !== undefined).length / total;
  return 0.4 * typed + 0.4 * described + 0.2 * requiredKnown;
}

function scoreResponse(card: ApiAssetCard): number {
  const fields = card.response_schema?.fields ?? [];
  if (fields.length === 0) return 0;
  const typed = fields.filter(f => (f.type ?? "").length > 0).length / fields.length;
  const described = fracDescribed(fields as ResponseField[]);
  const richness = Math.min(1, fields.length / 12);
  return 0.4 * typed + 0.4 * described + 0.2 * richness;
}

function scoreExample(card: ApiAssetCard): number {
  const ex = card.response_schema?.example;
  if (ex === null || ex === undefined) return 0;
  if (typeof ex !== "object") return 0.3;
  const obj = ex as Record<string, unknown>;
  const hasEnvelope = "code" in obj || "data" in obj || "msg" in obj;
  let depth = 1;
  if ("data" in obj && obj.data && typeof obj.data === "object") {
    depth = 2;
    const data = obj.data as Record<string, unknown>;
    if ("result" in data) depth = 3;
  }
  return Math.min(1, 0.3 + (hasEnvelope ? 0.3 : 0) + 0.15 * depth);
}

function scoreSemantic(card: ApiAssetCard): number {
  const fields = card.response_schema?.fields ?? [];
  if (fields.length === 0) return 0;
  const cn = fields.filter(f => /[\u4e00-\u9fff]/.test(f.desc ?? "")).length / fields.length;
  const named = fields.filter(f => /^[a-z][a-z0-9_]*$/i.test(f.name ?? "")).length / fields.length;
  return 0.6 * cn + 0.4 * named;
}

function scoreLineage(card: ApiAssetCard): number {
  let s = 0;
  if (card.entity_mapping && card.entity_mapping.length > 0) s += 0.5;
  if (card.metric_mapping && card.metric_mapping.length > 0) s += 0.5;
  return s;
}

function scoreRuntime(_card: ApiAssetCard): number {
  return 0.5;
}

function scoreSecurity(card: ApiAssetCard): number {
  const headers = card.request_schema?.headers ?? [];
  const hasAuthHeader = headers.some(h => /appCode|token|auth/i.test(h));
  const placeholder = /\{[^}]+\}/.test(card.path);
  let s = hasAuthHeader ? 0.7 : 0.4;
  if (placeholder) s -= 0.1;
  return Math.max(0, Math.min(1, s));
}

export function scoreCard(card: ApiAssetCard): { score: number; breakdown: QualityBreakdown } {
  const b: QualityBreakdown = {
    contract: scoreContract(card),
    response: scoreResponse(card),
    example: scoreExample(card),
    semantic: scoreSemantic(card),
    lineage: scoreLineage(card),
    runtime: scoreRuntime(card),
    security: scoreSecurity(card),
  };
  const score =
    W.contract * b.contract +
    W.response * b.response +
    W.example * b.example +
    W.semantic * b.semantic +
    W.lineage * b.lineage +
    W.runtime * b.runtime +
    W.security * b.security;
  return { score: Math.round(score * 1000) / 1000, breakdown: b };
}