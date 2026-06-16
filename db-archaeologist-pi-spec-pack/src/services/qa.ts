// QA service: query → candidate APIs ranked by lexical + char-ngram + KG proximity + quality.
// No embedding; pure CPU on ~160 cards.

import { getCards, getTools, getMetricDict, getTaxonomy, kgInbound } from "./registry.js";
import type { ApiAssetCard, ToolRegistryEntry } from "../lib/types.js";

const SYNONYMS: Record<string, string[]> = {
  转化: ["pay_rate", "conversion", "支付转化率", "actual_conversion"],
  访客: ["visitor", "visitors", "访客数", "search_visitors"],
  流量: ["traffic", "flow"],
  推广: ["promotion", "ad_", "campaign", "投流", "投放"],
  关键词: ["keyword", "search_word", "词根", "搜索词"],
  竞争: ["competition", "竞品", "格局"],
  商品: ["goods", "item", "sku"],
  店铺: ["shop", "tenant"],
  类目: ["category", "cate"],
  价格带: ["price_band", "价位"],
  评论: ["review", "comment", "好评"],
  人群: ["crowd", "user_profile", "画像"],
  趋势: ["trend", "yoy", "环比"],
  下滑: ["drop", "decline", "下降"],
  诊断: ["diagnose", "诊断"],
};

const STATUS_PENALTY: Record<string, number> = {
  draft: -0.3,
  candidate: -0.05,
  verified: 0,
  agent_ready: 0.05,
  blocked: -1,
  deprecated: -0.5,
  raw: -0.2,
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function expandQuery(q: string): string[] {
  const tokens = new Set<string>();
  tokens.add(normalize(q));
  for (const [cn, syns] of Object.entries(SYNONYMS)) {
    if (q.includes(cn)) {
      tokens.add(cn);
      for (const s of syns) tokens.add(s.toLowerCase());
    }
  }
  for (const ch of q.split(/[\s,，。、:：]+/)) {
    if (ch.length >= 2) tokens.add(normalize(ch));
  }
  return [...tokens].filter(t => t.length > 0);
}

function charNgramScore(query: string, doc: string, n = 2): number {
  if (query.length < n || doc.length < n) return 0;
  const grams = new Set<string>();
  for (let i = 0; i <= query.length - n; i++) grams.add(query.slice(i, i + n));
  let hit = 0;
  for (const g of grams) if (doc.includes(g)) hit++;
  return grams.size === 0 ? 0 : hit / grams.size;
}

function tokenScore(tokens: string[], doc: string): number {
  if (tokens.length === 0) return 0;
  const lower = doc.toLowerCase();
  let hit = 0;
  for (const t of tokens) if (t.length >= 2 && lower.includes(t)) hit++;
  return hit / tokens.length;
}

type ScoredCard = { card: ApiAssetCard; score: number; reasons: string[] };

function scoreCardForQuery(card: ApiAssetCard, q: string, tokens: string[]): ScoredCard {
  const reasons: string[] = [];
  const haystack = [
    card.name,
    card.module,
    card.path,
    card.domain,
    card.capability ?? "",
    ...(card.response_schema?.fields ?? []).map(f => `${f.name ?? ""} ${f.desc ?? ""}`),
    ...(card.entity_mapping ?? []).map(e => e.entity),
    ...(card.metric_mapping ?? []).map(m => m.metric),
  ].join(" ");

  const lex = tokenScore(tokens, haystack);
  const ngram = charNgramScore(q, haystack, 2);
  const baseQuality = card.quality_score;
  const statusBonus = STATUS_PENALTY[card.lifecycle_status] ?? 0;

  let score = 0.45 * lex + 0.25 * ngram + 0.2 * baseQuality + statusBonus;

  for (const [cn] of Object.entries(SYNONYMS)) {
    if (q.includes(cn) && (card.name.includes(cn) || (card.capability ?? "").includes(cn))) {
      score += 0.15;
      reasons.push(`domain_hint:${cn}`);
    }
  }
  if ((card.capability ?? "") && q.includes(card.capability!)) {
    score += 0.2;
    reasons.push(`capability_match:${card.capability}`);
  }

  if (lex > 0.3) reasons.push(`lexical:${lex.toFixed(2)}`);
  if (ngram > 0.3) reasons.push(`ngram:${ngram.toFixed(2)}`);
  reasons.push(`quality:${baseQuality.toFixed(2)}`);
  if (statusBonus !== 0) reasons.push(`status:${card.lifecycle_status}${statusBonus >= 0 ? "+" : ""}${statusBonus}`);

  if ((card.issues ?? []).some(i => i.type === "missing_response_fields")) {
    score -= 0.15;
    reasons.push("penalty:missing_fields");
  }
  if ((card.issues ?? []).some(i => i.type === "empty_response_example")) {
    score -= 0.1;
    reasons.push("penalty:empty_example");
  }
  if (card.module && /测试|test/i.test(card.module)) {
    score -= 0.2;
    reasons.push("penalty:test_module");
  }

  return { card, score, reasons };
}

function maybeFilterByDomain(question: string): string | undefined {
  const tax = getTaxonomy();
  for (const d of tax.domains ?? []) {
    if (question.includes(d.name)) return d.name;
  }
  return undefined;
}

export type QaCandidate = {
  api_id: string;
  name: string;
  method: string;
  path: string;
  domain: string;
  lifecycle_status: string;
  quality_score: number;
  reason: string;
  risks: string[];
};

export type QaResult = {
  answer_type: "api_candidates";
  question: string;
  candidates: QaCandidate[];
  recommended_tools: Array<{ tool_id: string; tool_name: string; reason: string }>;
  notes: string;
};

export function askApiCatalog(question: string, opts: { domain?: string; limit?: number } = {}): QaResult {
  const cards = getCards();
  const tools = getTools();
  const tokens = expandQuery(question);
  const domainFilter = opts.domain ?? maybeFilterByDomain(question);
  const limit = opts.limit ?? 8;

  const isFieldEmptyMeta = /字段说明.*空|返回字段.*空|missing.*field/i.test(question);
  const isEmptyExampleMeta = /示例.*空|返回示例.*空|empty.*example/i.test(question);
  const isPlaceholderMeta = /占位|\{api-id\}|placeholder/i.test(question);

  const ranked: ScoredCard[] = [];
  for (const card of cards) {
    if (card.lifecycle_status === "blocked" && !isPlaceholderMeta) continue;
    if (card.lifecycle_status === "deprecated") continue;
    if (domainFilter && card.domain !== domainFilter) continue;

    if (isFieldEmptyMeta || isEmptyExampleMeta || isPlaceholderMeta) {
      const issues = card.issues ?? [];
      const matched =
        (isFieldEmptyMeta && issues.some(i => i.type === "missing_response_fields")) ||
        (isEmptyExampleMeta && issues.some(i => i.type === "empty_response_example")) ||
        (isPlaceholderMeta && issues.some(i => i.type === "path_placeholder"));
      if (!matched) continue;
      ranked.push({
        card,
        score: 1 + card.quality_score * 0.1,
        reasons: ["meta:issue_filter"],
      });
      continue;
    }

    const sc = scoreCardForQuery(card, question, tokens);
    if (sc.score <= 0) continue;
    ranked.push(sc);
  }
  ranked.sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, limit);

  const candidates: QaCandidate[] = top.map(({ card, reasons }) => ({
    api_id: card.api_id,
    name: card.name,
    method: card.method,
    path: card.path,
    domain: card.domain,
    lifecycle_status: card.lifecycle_status,
    quality_score: card.quality_score,
    reason: reasons.join(", "),
    risks: (card.issues ?? []).filter(i => i.severity !== "low").map(i => i.type),
  }));

  const apiToTool = new Map<string, ToolRegistryEntry>();
  for (const t of tools) {
    for (const id of [...(t.source_apis ?? []), ...(t.fallback_apis ?? [])]) {
      if (!apiToTool.has(id)) apiToTool.set(id, t);
    }
  }
  const recommendedSet = new Map<string, { tool: ToolRegistryEntry; reason: string }>();
  for (const c of candidates) {
    const t = apiToTool.get(c.api_id);
    if (t && !recommendedSet.has(t.tool_id)) {
      recommendedSet.set(t.tool_id, { tool: t, reason: `wraps ${c.api_id}` });
    }
  }

  const notes = `total_matched=${ranked.length}, returned=${candidates.length}, domain_filter=${domainFilter ?? "none"}`;

  return {
    answer_type: "api_candidates",
    question,
    candidates,
    recommended_tools: [...recommendedSet.values()].map(({ tool, reason }) => ({
      tool_id: tool.tool_id,
      tool_name: tool.tool_name,
      reason,
    })),
    notes,
  };
}

export function searchByMetric(metric: string): ApiAssetCard[] {
  const dict = getMetricDict();
  const cards = getCards();
  const lower = metric.toLowerCase();
  const direct = dict.metrics?.[lower];
  const aliases = new Set<string>([lower, ...(direct?.aliases ?? []).map(s => s.toLowerCase())]);
  return cards.filter(c => (c.metric_mapping ?? []).some(m => aliases.has(m.metric.toLowerCase())));
}

export function questionLineage(question: string): Array<{ api_id: string; tool_id?: string }> {
  const r = askApiCatalog(question, { limit: 5 });
  return r.candidates.map(c => ({ api_id: c.api_id }));
}

void kgInbound;