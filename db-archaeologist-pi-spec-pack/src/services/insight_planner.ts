// Insight planner: 给定一个洞察方向 (topic + template) ， 推一份 InsightPlan：
//   - 候选 API（按 askApiCatalog 粗筛 + preferred_domains 加权）
//   - 每个 API 的字段打 role（metric / id / time / dim / meta）
//   - 与 template.required_dimensions / required_metrics 对齐 → coverage_report
//   - 拼一版 output_schema（用置信度最高的字段映射）
//   - 生成 llm_refinement_prompt 供 Agent 自动 follow-up
//
// 不发外网请求，纯规则 + 既有 derived 资产。

import path from "node:path";
import { createHash } from "node:crypto";
import { readYaml } from "../lib/io.js";
import { getCard, getCards, getMetricDict, getTaxonomy } from "./registry.js";
import { askApiCatalog } from "./qa.js";
import { buildAliasIndex } from "../normalizers/field_semantic_classifier.js";
import type { ApiAssetCard, ResponseField } from "../lib/types.js";

const ROOT = process.env.REGISTRY_ROOT ?? process.cwd();

// ─────────────────────────────────────────────
// types
// ─────────────────────────────────────────────

export type InsightTemplate = {
  cn_name: string;
  keywords?: string[];
  required_dimensions: string[];
  required_metrics: string[];
  preferred_domains?: string[];
  output_grain?: string;
  scenarios?: string[];
};

export type FieldRole = "dim" | "metric" | "id" | "time" | "meta";

export type SelectedField = {
  field_path: string;
  field_name?: string;
  field_desc?: string;
  field_type?: string;
  role: FieldRole;
  mapped_to_output: string | null;
  suggested_alias: string | null;
  confidence: number;
  source: "rule" | "llm" | "manual";
  selected: boolean;
  // extra rule trace
  matched_dim?: string;
  matched_metric?: string;
};

export type CandidateApi = {
  api_id: string;
  score: number;
  reasons: string[];
  role_in_plan: "primary" | "supplement" | "fallback";
  selected_fields: SelectedField[];
  missing_required_params: string[];
  gaps: string[];
  quality_score: number;
  lifecycle_status: string;
  domain: string;
  capability?: string;
  api_name: string;
  api_path: string;
};

export type OutputColumn = {
  col_name: string;
  type?: string;
  role: FieldRole;
  source: { api_id: string; field_path: string };
  fallback_sources?: Array<{ api_id: string; field_path: string }>;
  required_by_template: boolean;
};

export type InsightPlan = {
  plan_id: string;
  topic: string;
  template_key: string;
  template_cn_name: string;
  created_at: string;
  scope?: { time_range?: string | null; target_entities?: string[] };
  candidate_apis: CandidateApi[];
  output_schema: OutputColumn[];
  coverage_report: {
    required_dim_covered: string[];
    required_metric_covered: string[];
    missing_required: string[];
    confidence_avg: number;
    coverage_pct: number;
  };
  validation: { state: "proposed" | "field_selected" | "live_validated" | "published" };
  llm_refinement_prompt: string;
  notes?: string;
};

// ─────────────────────────────────────────────
// dim dictionary
// ─────────────────────────────────────────────

type DimSpec = { cn: string; keywords: string[] };

const DIM_DICT: Record<string, DimSpec> = {
  category:   { cn: "类目",   keywords: ["category", "cate", "类目", "leaf_cate"] },
  brand:      { cn: "品牌",   keywords: ["brand", "品牌"] },
  price_band: { cn: "价格带", keywords: ["price_band", "price_range", "价格带", "价位", "price_seg"] },
  item:       { cn: "商品",   keywords: ["goods", "item", "商品", "宝贝", "sku", "spu"] },
  keyword:    { cn: "关键词", keywords: ["keyword", "search_word", "词根", "搜索词", "关键词", "query_word"] },
  time:       { cn: "时间",   keywords: ["date", "day", "month", "year", "time", "trade_date", "stat_dt", "ds"] },
  shop:       { cn: "店铺",   keywords: ["shop", "店铺", "tenant", "seller"] },
  user:       { cn: "用户",   keywords: ["user", "buyer", "客户", "人群", "crowd"] },
};

const ID_NAME_RE = /(^|_)(id|ids|key)$|^(goods_id|item_id|sku_id|keyword|cate_id|category_id|brand_id|shop_id|user_id|spu_id)$/i;
const TIME_NAME_RE = /(^|_)(date|time|day|month|year|dt|ds|trade_date|stat_dt|start_date|end_date)$/i;

// ─────────────────────────────────────────────
// templates loader
// ─────────────────────────────────────────────

type TemplateFile = { templates: Record<string, InsightTemplate> };

let templatesCache: TemplateFile | null = null;

function loadTemplates(): TemplateFile {
  if (templatesCache) return templatesCache;
  templatesCache = readYaml<TemplateFile>(path.join(ROOT, "registry/insight_templates.seed.yaml"));
  return templatesCache;
}

export function listTemplates(): Array<{ key: string; tpl: InsightTemplate }> {
  const f = loadTemplates();
  return Object.entries(f.templates ?? {}).map(([key, tpl]) => ({ key, tpl }));
}

export function getTemplate(key: string): InsightTemplate | undefined {
  return loadTemplates().templates?.[key];
}

function autoMatchTemplate(topic: string): { key: string; tpl: InsightTemplate } | undefined {
  const lower = topic.toLowerCase();
  let best: { key: string; tpl: InsightTemplate; hit: number } | undefined;
  for (const { key, tpl } of listTemplates()) {
    const kws = [tpl.cn_name, ...(tpl.keywords ?? [])];
    let hit = 0;
    for (const kw of kws) {
      if (kw && lower.includes(kw.toLowerCase())) hit++;
    }
    if (hit > 0 && (!best || hit > best.hit)) best = { key, tpl, hit };
  }
  return best ? { key: best.key, tpl: best.tpl } : undefined;
}

// ─────────────────────────────────────────────
// field role tagging
// ─────────────────────────────────────────────

function fieldHaystack(f: ResponseField): string {
  return [f.path, f.name ?? "", f.desc ?? ""].join(" ").toLowerCase();
}

function matchDimKey(f: ResponseField, allowed?: Set<string>): { dim?: string; cn?: string; conf: number } {
  const hay = fieldHaystack(f);
  let pick: { dim: string; conf: number } | undefined;
  for (const [dim, spec] of Object.entries(DIM_DICT)) {
    if (allowed && !allowed.has(dim)) continue;
    for (const kw of spec.keywords) {
      if (hay.includes(kw.toLowerCase())) {
        const conf = kw.length >= 4 ? 0.8 : 0.6;
        if (!pick || conf > pick.conf) pick = { dim, conf };
      }
    }
  }
  if (!pick) return { conf: 0 };
  return { dim: pick.dim, cn: DIM_DICT[pick.dim].cn, conf: pick.conf };
}

function matchMetricKey(
  f: ResponseField,
  aliasIndex: Map<string, string>,
  allowed?: Set<string>
): { metric?: string; conf: number } {
  const candidates = [f.name ?? "", f.desc ?? ""].map(s => s.toLowerCase().trim()).filter(Boolean);
  for (const c of candidates) {
    const m = aliasIndex.get(c);
    if (m && (!allowed || allowed.has(m))) return { metric: m, conf: 0.95 };
  }
  for (const c of candidates) {
    for (const [alias, m] of aliasIndex) {
      if (alias.length >= 4 && c.includes(alias) && (!allowed || allowed.has(m))) {
        return { metric: m, conf: 0.7 };
      }
    }
  }
  return { conf: 0 };
}

function classifyFieldRole(
  f: ResponseField,
  aliasIndex: Map<string, string>,
  reqDims: Set<string>,
  reqMetrics: Set<string>
): SelectedField {
  const name = f.name ?? f.path.split(".").pop() ?? "";

  // priority: metric > id > time > dim > meta
  const metricHit = matchMetricKey(f, aliasIndex, reqMetrics);
  if (metricHit.metric) {
    return baseField(f, name, "metric", metricHit.conf, { matched_metric: metricHit.metric });
  }
  // also consider non-required metrics with lower priority but still a metric role
  const anyMetric = matchMetricKey(f, aliasIndex);
  if (anyMetric.metric) {
    return baseField(f, name, "metric", Math.min(anyMetric.conf, 0.6), { matched_metric: anyMetric.metric });
  }
  if (ID_NAME_RE.test(name)) {
    return baseField(f, name, "id", 0.9);
  }
  if (TIME_NAME_RE.test(name)) {
    return baseField(f, name, "time", 0.9, { matched_dim: "time" });
  }
  const dimHit = matchDimKey(f, reqDims);
  if (dimHit.dim) {
    return baseField(f, name, "dim", dimHit.conf, { matched_dim: dimHit.dim });
  }
  const anyDim = matchDimKey(f);
  if (anyDim.dim) {
    return baseField(f, name, "dim", Math.min(anyDim.conf, 0.5), { matched_dim: anyDim.dim });
  }
  return baseField(f, name, "meta", 0.3);
}

function baseField(
  f: ResponseField,
  name: string,
  role: FieldRole,
  confidence: number,
  extra: Partial<SelectedField> = {}
): SelectedField {
  return {
    field_path: f.path,
    field_name: name,
    field_desc: f.desc,
    field_type: f.type,
    role,
    mapped_to_output: null,
    suggested_alias: null,
    confidence,
    source: "rule",
    selected: confidence >= 0.6 && (role === "metric" || role === "dim" || role === "id" || role === "time"),
    ...extra,
  };
}

// ─────────────────────────────────────────────
// shortlisting
// ─────────────────────────────────────────────

function shortlistApis(
  topic: string,
  tpl: InsightTemplate,
  limit: number
): Array<{ card: ApiAssetCard; baseScore: number; reasons: string[] }> {
  // pre-load to ensure registry fully warm
  void getCards();
  const qa = askApiCatalog(topic, { limit: Math.max(limit * 2, 20) });
  const preferred = new Set(tpl.preferred_domains ?? []);
  const scenarios = tpl.scenarios ?? [];

  const out: Array<{ card: ApiAssetCard; baseScore: number; reasons: string[] }> = [];
  for (const c of qa.candidates) {
    const card = getCard(c.api_id);
    if (!card) continue;
    let score = 0.45 * c.quality_score + 0.55; // baseline from being in qa.candidates
    const reasons: string[] = [c.reason];
    if (preferred.has(card.domain)) {
      score += 0.25;
      reasons.push(`preferred_domain:${card.domain}`);
    }
    for (const s of scenarios) {
      if (card.name.includes(s) || (card.capability ?? "").includes(s)) {
        score += 0.1;
        reasons.push(`scenario:${s}`);
        break;
      }
    }
    out.push({ card, baseScore: score, reasons });
  }

  // also pull preferred-domain top quality cards that QA missed
  if (preferred.size > 0) {
    const seen = new Set(out.map(x => x.card.api_id));
    const extras = getCards()
      .filter(c => preferred.has(c.domain) && !seen.has(c.api_id))
      .filter(c => c.lifecycle_status !== "blocked" && c.lifecycle_status !== "deprecated")
      .sort((a, b) => b.quality_score - a.quality_score)
      .slice(0, 5);
    for (const card of extras) {
      out.push({
        card,
        baseScore: 0.4 + 0.2 * card.quality_score,
        reasons: [`preferred_domain_seed:${card.domain}`],
      });
    }
  }

  out.sort((a, b) => b.baseScore - a.baseScore);
  return out.slice(0, limit);
}

// ─────────────────────────────────────────────
// per-card field tagging + gaps
// ─────────────────────────────────────────────

function buildCandidate(
  card: ApiAssetCard,
  baseScore: number,
  reasons: string[],
  tpl: InsightTemplate,
  aliasIndex: Map<string, string>
): CandidateApi {
  const reqDims = new Set(tpl.required_dimensions ?? []);
  const reqMetrics = new Set(tpl.required_metrics ?? []);

  const fields = card.response_schema?.fields ?? [];
  const tagged = fields.map(f => classifyFieldRole(f, aliasIndex, reqDims, reqMetrics));

  // covered sets contributed by this card
  const dimsCovered = new Set<string>();
  const metricsCovered = new Set<string>();
  for (const sf of tagged) {
    if (sf.role === "metric" && sf.matched_metric && reqMetrics.has(sf.matched_metric)) metricsCovered.add(sf.matched_metric);
    if (sf.role === "dim" && sf.matched_dim && reqDims.has(sf.matched_dim)) dimsCovered.add(sf.matched_dim);
    if (sf.role === "time" && reqDims.has("time")) dimsCovered.add("time");
  }

  const gaps: string[] = [];
  for (const d of reqDims) if (!dimsCovered.has(d)) gaps.push(`missing_dim:${d}`);
  for (const m of reqMetrics) if (!metricsCovered.has(m)) gaps.push(`missing_metric:${m}`);

  const requiredQuery = (card.request_schema?.query ?? []).filter(p => p.required);
  const missingRequiredParams = requiredQuery.map(p => p.name);

  // boost score by per-card hit
  const hitBonus = (dimsCovered.size + metricsCovered.size) * 0.08;
  const score = +(baseScore + hitBonus).toFixed(4);

  reasons.push(`hits:dim=${dimsCovered.size}/${reqDims.size},metric=${metricsCovered.size}/${reqMetrics.size}`);

  return {
    api_id: card.api_id,
    score,
    reasons,
    role_in_plan: "supplement",
    selected_fields: tagged,
    missing_required_params: missingRequiredParams,
    gaps,
    quality_score: card.quality_score,
    lifecycle_status: card.lifecycle_status,
    domain: card.domain,
    capability: card.capability,
    api_name: card.name,
    api_path: card.path,
  };
}

function assignRolesInPlan(cands: CandidateApi[]): void {
  cands.sort((a, b) => b.score - a.score);
  cands.forEach((c, i) => {
    c.role_in_plan = i < 3 ? "primary" : i < 8 ? "supplement" : "fallback";
  });
}

// ─────────────────────────────────────────────
// output schema + coverage
// ─────────────────────────────────────────────

function buildOutputSchema(cands: CandidateApi[], tpl: InsightTemplate) {
  const reqDims = tpl.required_dimensions ?? [];
  const reqMetrics = tpl.required_metrics ?? [];
  const cols: OutputColumn[] = [];

  type Pick = { conf: number; api_id: string; field_path: string; field_type?: string; field_name?: string };
  function bestForDim(dim: string): { primary?: Pick; fallbacks: Pick[] } {
    const all: Pick[] = [];
    for (const c of cands) {
      for (const sf of c.selected_fields) {
        if (dim === "time" && sf.role === "time") {
          all.push({ conf: sf.confidence, api_id: c.api_id, field_path: sf.field_path, field_type: sf.field_type, field_name: sf.field_name });
        } else if (sf.role === "dim" && sf.matched_dim === dim) {
          all.push({ conf: sf.confidence, api_id: c.api_id, field_path: sf.field_path, field_type: sf.field_type, field_name: sf.field_name });
        }
      }
    }
    all.sort((a, b) => b.conf - a.conf);
    return { primary: all[0], fallbacks: all.slice(1, 4) };
  }

  function bestForMetric(metric: string): { primary?: Pick; fallbacks: Pick[] } {
    const all: Pick[] = [];
    for (const c of cands) {
      for (const sf of c.selected_fields) {
        if (sf.role === "metric" && sf.matched_metric === metric) {
          all.push({ conf: sf.confidence, api_id: c.api_id, field_path: sf.field_path, field_type: sf.field_type, field_name: sf.field_name });
        }
      }
    }
    all.sort((a, b) => b.conf - a.conf);
    return { primary: all[0], fallbacks: all.slice(1, 4) };
  }

  const covered = { dim: new Set<string>(), metric: new Set<string>() };

  for (const dim of reqDims) {
    const { primary, fallbacks } = bestForDim(dim);
    if (!primary) continue;
    covered.dim.add(dim);
    cols.push({
      col_name: dim === "time" ? "stat_date" : dim,
      type: primary.field_type,
      role: dim === "time" ? "time" : "dim",
      source: { api_id: primary.api_id, field_path: primary.field_path },
      fallback_sources: fallbacks.map(f => ({ api_id: f.api_id, field_path: f.field_path })),
      required_by_template: true,
    });
  }
  for (const metric of reqMetrics) {
    const { primary, fallbacks } = bestForMetric(metric);
    if (!primary) continue;
    covered.metric.add(metric);
    cols.push({
      col_name: metric,
      type: primary.field_type,
      role: "metric",
      source: { api_id: primary.api_id, field_path: primary.field_path },
      fallback_sources: fallbacks.map(f => ({ api_id: f.api_id, field_path: f.field_path })),
      required_by_template: true,
    });
  }

  // mark mapped_to_output back onto candidate fields for UX
  const sourceLookup = new Map<string, string>();
  for (const col of cols) {
    sourceLookup.set(`${col.source.api_id}::${col.source.field_path}`, col.col_name);
  }
  for (const c of cands) {
    for (const sf of c.selected_fields) {
      const key = `${c.api_id}::${sf.field_path}`;
      const mapped = sourceLookup.get(key);
      if (mapped) {
        sf.mapped_to_output = mapped;
        sf.suggested_alias = mapped;
      }
    }
  }

  const totalReq = reqDims.length + reqMetrics.length;
  const coverageHit = covered.dim.size + covered.metric.size;
  const missing: string[] = [];
  for (const d of reqDims) if (!covered.dim.has(d)) missing.push(`dim:${d}`);
  for (const m of reqMetrics) if (!covered.metric.has(m)) missing.push(`metric:${m}`);

  return {
    cols,
    coverage: {
      required_dim_covered: [...covered.dim],
      required_metric_covered: [...covered.metric],
      missing_required: missing,
      coverage_pct: totalReq === 0 ? 1 : +(coverageHit / totalReq).toFixed(3),
    },
  };
}

function avgConfidence(cands: CandidateApi[]): number {
  let sum = 0;
  let n = 0;
  for (const c of cands) {
    for (const sf of c.selected_fields) {
      if (sf.selected) {
        sum += sf.confidence;
        n++;
      }
    }
  }
  return n === 0 ? 0 : +(sum / n).toFixed(3);
}

// ─────────────────────────────────────────────
// llm refinement prompt
// ─────────────────────────────────────────────

function buildLlmPrompt(plan: Omit<InsightPlan, "llm_refinement_prompt">): string {
  const lines: string[] = [];
  lines.push(`# 任务：精排洞察方案 ${plan.template_cn_name}`);
  lines.push(`话题：${plan.topic}`);
  lines.push(`模板要求维度：${(getTemplate(plan.template_key)?.required_dimensions ?? []).join(", ")}`);
  lines.push(`模板要求指标：${(getTemplate(plan.template_key)?.required_metrics ?? []).join(", ")}`);
  lines.push("");
  lines.push("# 当前候选 API（粗筛）");
  for (const c of plan.candidate_apis.slice(0, 8)) {
    lines.push(`- [${c.role_in_plan}] ${c.api_id} (${c.api_path}) score=${c.score}`);
    const top = c.selected_fields.filter(sf => sf.selected).slice(0, 6);
    for (const sf of top) {
      lines.push(`    · ${sf.role} ${sf.field_path} → ${sf.mapped_to_output ?? "?"} conf=${sf.confidence}`);
    }
    if (c.gaps.length) lines.push(`    gaps: ${c.gaps.join(", ")}`);
  }
  lines.push("");
  lines.push("# 当前 output_schema");
  for (const col of plan.output_schema) {
    lines.push(`- ${col.col_name} (${col.role}) ← ${col.source.api_id}.${col.source.field_path}`);
  }
  lines.push("");
  lines.push("# 缺口");
  lines.push(plan.coverage_report.missing_required.length === 0 ? "（无）" : plan.coverage_report.missing_required.join(", "));
  lines.push("");
  lines.push("请输出：");
  lines.push("1. 哪些字段映射不准，应该改成哪个 api_id.field_path？");
  lines.push("2. 缺口字段（如有）建议从哪个 API 补，或可以放弃；");
  lines.push("3. output_schema 是否需要增删列、改名、改聚合粒度。");
  lines.push("用 JSON 输出 { adjustments: [...], drop_columns: [...], add_columns: [...], notes: \"\" }");
  return lines.join("\n");
}

// ─────────────────────────────────────────────
// public api
// ─────────────────────────────────────────────

export type ProposeInsightPlanInput = {
  topic: string;
  template_key?: string;
  scope?: { time_range?: string | null; target_entities?: string[] };
  candidate_limit?: number;
};

export function proposeInsightPlan(args: ProposeInsightPlanInput): InsightPlan {
  if (!args || typeof args.topic !== "string" || !args.topic.trim()) {
    throw new Error("propose_insight_plan: topic is required");
  }
  const limit = clamp(args.candidate_limit ?? 12, 3, 30);

  const tplPick = args.template_key
    ? { key: args.template_key, tpl: getTemplate(args.template_key) }
    : autoMatchTemplate(args.topic);

  if (!tplPick || !tplPick.tpl) {
    const available = listTemplates().map(t => `${t.key}(${t.tpl.cn_name})`).join(", ");
    throw new Error(`propose_insight_plan: cannot resolve template; pass template_key. available=[${available}]`);
  }
  const tpl = tplPick.tpl;
  const templateKey = tplPick.key;

  const dict = getMetricDict();
  const aliasIndex = buildAliasIndex(dict);

  const shortlist = shortlistApis(args.topic, tpl, limit);
  const cands: CandidateApi[] = shortlist.map(s => buildCandidate(s.card, s.baseScore, [...s.reasons], tpl, aliasIndex));
  assignRolesInPlan(cands);

  const { cols, coverage } = buildOutputSchema(cands, tpl);

  const created_at = new Date().toISOString();
  const planId = makePlanId(templateKey, args.topic, created_at);

  // taxonomy 读一下，触发一次预热（也供 prompt 里参考；当前未必使用）
  void getTaxonomy();

  const draft: Omit<InsightPlan, "llm_refinement_prompt"> = {
    plan_id: planId,
    topic: args.topic,
    template_key: templateKey,
    template_cn_name: tpl.cn_name,
    created_at,
    scope: args.scope,
    candidate_apis: cands,
    output_schema: cols,
    coverage_report: {
      required_dim_covered: coverage.required_dim_covered,
      required_metric_covered: coverage.required_metric_covered,
      missing_required: coverage.missing_required,
      confidence_avg: avgConfidence(cands),
      coverage_pct: coverage.coverage_pct,
    },
    validation: { state: "proposed" },
    notes: shortlist.length === 0 ? "shortlist empty; check topic wording or template choice" : undefined,
  };

  return { ...draft, llm_refinement_prompt: buildLlmPrompt(draft) };
}

// ─────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  if (typeof n !== "number" || isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function makePlanId(templateKey: string, topic: string, ts: string): string {
  const h = createHash("sha1").update(`${templateKey}|${topic}|${ts}`).digest("hex").slice(0, 8);
  const stamp = ts.replace(/[-:T.Z]/g, "").slice(0, 14);
  return `${templateKey}_${stamp}_${h}`;
}