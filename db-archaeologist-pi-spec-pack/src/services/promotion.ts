// promotion.ts — 候选 API 升级路径分析。
//
// 输入：当前 api_asset_cards.json
// 输出：每个 candidate / draft / blocked 的"差什么"和"怎么补"，
//       供 backfill_from_probe.ts 与人工挑选使用。
//
// 不修改任何文件；只产出 PromotionPlan[]。

import type { ApiAssetCard, ResponseField } from "../lib/types.js";

export type PromotionGap =
  | "response_fields_missing"   // fields=0 但 example 存在 → 可从 example 反推
  | "response_example_missing"  // fields≥1 但 example 为空 → 需要 probe
  | "response_both_missing"     // 两者皆空 → 必须 probe
  | "path_placeholder"          // path 含 {xxx}
  | "param_undocumented"        // request_schema 全空
  | "low_quality_other";        // 兜底

export type FixHint =
  | "infer_fields_from_example"  // 仅静态推断
  | "probe_then_infer"           // 需要真实出站采样
  | "manual_path_resolve"        // 路径占位需人工定值
  | "manual_review";

export type PromotionPlan = {
  api_id: string;
  method: string;
  path: string;
  domain: string;
  lifecycle_status: string;
  quality_score: number;
  gaps: PromotionGap[];
  fix_hints: FixHint[];
  blockers: string[];     // 阻塞 promote 的硬约束（如 path_placeholder）
  promote_to: "agent_ready" | "verified" | "candidate" | "blocked";
  estimate: "low" | "medium" | "high"; // 修复难度
};

export type PromotionReport = {
  total: number;
  byGap: Record<PromotionGap, number>;
  byFix: Record<FixHint, number>;
  byPromote: Record<string, number>;
  plans: PromotionPlan[];
};

const PROMOTABLE_STATUSES = new Set(["candidate", "draft", "blocked"]);

function isEmptyObject(v: unknown): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0;
}

function exampleNonEmpty(ex: unknown): boolean {
  if (ex === null || ex === undefined) return false;
  if (typeof ex !== "object") return true;
  if (Array.isArray(ex)) return ex.length > 0;
  return !isEmptyObject(ex);
}

function hasParamSchema(card: ApiAssetCard): boolean {
  const r = card.request_schema;
  if (!r) return false;
  return (r.query.length + (r.body?.length ?? 0) + r.path_params.length) > 0;
}

function detectGaps(card: ApiAssetCard): PromotionGap[] {
  const gaps: PromotionGap[] = [];
  const fields = card.response_schema?.fields ?? [];
  const ex = card.response_schema?.example;
  const exOk = exampleNonEmpty(ex);

  if (fields.length === 0 && !exOk) gaps.push("response_both_missing");
  else if (fields.length === 0) gaps.push("response_fields_missing");
  else if (!exOk) gaps.push("response_example_missing");

  if (/\{[^}]+\}/.test(card.path)) gaps.push("path_placeholder");
  if (!hasParamSchema(card)) gaps.push("param_undocumented");
  if (gaps.length === 0) gaps.push("low_quality_other");
  return gaps;
}

function decideFix(gaps: PromotionGap[]): FixHint[] {
  const hints = new Set<FixHint>();
  if (gaps.includes("response_fields_missing")) hints.add("infer_fields_from_example");
  if (gaps.includes("response_example_missing") || gaps.includes("response_both_missing")) hints.add("probe_then_infer");
  if (gaps.includes("path_placeholder")) hints.add("manual_path_resolve");
  if (hints.size === 0) hints.add("manual_review");
  return [...hints];
}

function decidePromote(card: ApiAssetCard, gaps: PromotionGap[]): PromotionPlan["promote_to"] {
  if (gaps.includes("path_placeholder")) return "blocked";
  if (gaps.includes("response_both_missing")) return "candidate";
  if (gaps.includes("response_fields_missing")) return "verified";
  if (gaps.includes("response_example_missing")) return "verified";
  return card.quality_score >= 0.75 ? "agent_ready" : "candidate";
}

function decideEstimate(gaps: PromotionGap[]): PromotionPlan["estimate"] {
  if (gaps.includes("path_placeholder")) return "high";
  if (gaps.includes("response_both_missing")) return "medium";
  if (gaps.includes("response_fields_missing")) return "low";
  return "low";
}

function decideBlockers(gaps: PromotionGap[]): string[] {
  const out: string[] = [];
  if (gaps.includes("path_placeholder")) out.push("path_placeholder");
  if (gaps.includes("param_undocumented")) out.push("param_undocumented");
  return out;
}

export function analyzePromotion(cards: ApiAssetCard[]): PromotionReport {
  const plans: PromotionPlan[] = [];
  const byGap: Record<string, number> = {};
  const byFix: Record<string, number> = {};
  const byPromote: Record<string, number> = {};

  for (const c of cards) {
    if (!PROMOTABLE_STATUSES.has(c.lifecycle_status)) continue;
    const gaps = detectGaps(c);
    const fix_hints = decideFix(gaps);
    const blockers = decideBlockers(gaps);
    const promote_to = decidePromote(c, gaps);
    const estimate = decideEstimate(gaps);
    const plan: PromotionPlan = {
      api_id: c.api_id,
      method: c.method,
      path: c.path,
      domain: c.domain,
      lifecycle_status: c.lifecycle_status,
      quality_score: c.quality_score,
      gaps, fix_hints, blockers, promote_to, estimate,
    };
    plans.push(plan);
    for (const g of gaps) byGap[g] = (byGap[g] ?? 0) + 1;
    for (const f of fix_hints) byFix[f] = (byFix[f] ?? 0) + 1;
    byPromote[promote_to] = (byPromote[promote_to] ?? 0) + 1;
  }

  return {
    total: plans.length,
    byGap: byGap as Record<PromotionGap, number>,
    byFix: byFix as Record<FixHint, number>,
    byPromote,
    plans,
  };
}

// ─────────────────────────────────────────────
// 字段表反推（从 example 走对象树拿叶子路径）
// 同一份逻辑也供 backfill_from_probe.ts 复用。
// ─────────────────────────────────────────────
export function inferFieldsFromExample(ex: unknown, rootPath = "data"): ResponseField[] {
  const out: ResponseField[] = [];
  walk(ex, rootPath, out, 0);
  return dedupe(out);
}

function walk(v: unknown, p: string, out: ResponseField[], depth: number) {
  if (depth > 8) return;
  if (v === null || v === undefined) {
    out.push({ path: p, type: "null" });
    return;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) {
      out.push({ path: `${p}[]`, type: "array" });
      return;
    }
    const sample = v.find((x) => x && typeof x === "object" && !Array.isArray(x)) ?? v[0];
    walk(sample, `${p}[]`, out, depth + 1);
    return;
  }
  if (typeof v === "object") {
    for (const [k, sub] of Object.entries(v as Record<string, unknown>)) {
      const childPath = `${p}.${k}`;
      if (sub && typeof sub === "object") {
        walk(sub, childPath, out, depth + 1);
      } else {
        out.push({ path: childPath, name: k, type: leafType(sub) });
      }
    }
    return;
  }
  out.push({ path: p, type: leafType(v) });
}

function leafType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function dedupe(rows: ResponseField[]): ResponseField[] {
  const seen = new Map<string, ResponseField>();
  for (const r of rows) {
    if (!seen.has(r.path)) seen.set(r.path, r);
  }
  return [...seen.values()];
}

// ─────────────────────────────────────────────
// markdown report
// ─────────────────────────────────────────────
export function renderPromotionMd(rep: PromotionReport): string {
  const lines: string[] = [];
  lines.push("# Promotion Plan");
  lines.push("");
  lines.push(`Total candidates: ${rep.total}`);
  lines.push("");
  lines.push("## By gap");
  for (const [k, v] of Object.entries(rep.byGap).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  lines.push("## By fix hint");
  for (const [k, v] of Object.entries(rep.byFix).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  lines.push("## By target status");
  for (const [k, v] of Object.entries(rep.byPromote).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  lines.push("## Plans (top 30 by estimated ease)");
  const easyFirst = [...rep.plans].sort((a, b) => {
    const w = (e: PromotionPlan) => (e.estimate === "low" ? 0 : e.estimate === "medium" ? 1 : 2);
    return w(a) - w(b) || b.quality_score - a.quality_score;
  }).slice(0, 30);
  lines.push("");
  lines.push("| api_id | method | path | gap | fix | promote_to | est | q |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const p of easyFirst) {
    lines.push(`| \`${p.api_id}\` | ${p.method} | \`${p.path}\` | ${p.gaps.join("/")} | ${p.fix_hints.join("/")} | ${p.promote_to} | ${p.estimate} | ${p.quality_score.toFixed(2)} |`);
  }
  return lines.join("\n") + "\n";
}