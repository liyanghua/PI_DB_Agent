// live_pull.ts: 真实出站编排（§S2 live 分支）
// 输入：CategoryContext + date_range + KeywordFieldMapping
// 输出：每接口的 ApiProbeResult 映射 + PullReport
// 行为：
//   - 串行调用 probeApiSample，避免并发限流；每接口间 150ms。
//   - request_template 支持 { query: {...}, body: {...} } 嵌套或纯单层；扁平化成 params，由 assembleRequest 按 card 声明分流。
//   - 变量占位符：{tertiary_category} {category_id} {start_date} {end_date} {tenant_id} {user_id}；后两个可由 assembleRequest 自动注入，模板里如显式声明也接受。
//   - 缺 category_id 的接口直接 skipped_missing_category_id；不会报错。
//   - 不依赖 LIVE_PROBE 直接读环境，但 probeApiSample 内部会做 live_probe_disabled 闸门，本模块只做语义归并。

import type { ApiProbeResult } from "../api_runtime.js";
import { probeApiSample } from "../api_runtime.js";
import type { CategoryContext } from "./resolve.js";
import type { KeywordFieldMapping } from "./types.js";

export interface DateRange {
  start_date: string;
  end_date: string;
}

export type PullStatus =
  | "ok"
  | "empty"
  | "business_empty"
  | "business_failed"
  | "data_root_null"
  | "root_path_mismatch"
  | "keyword_field_missing"
  | "context_mismatch"
  | "skipped_missing_category_id"
  | "missing_required_params"
  | "not_registered"
  | "live_disabled"
  | "env_missing"
  | "http_error"
  | "network_error"
  | "timeout"
  | "unexpected_payload"
  | "disabled_by_config";

export interface ApiPullStatus {
  status: PullStatus;
  http?: number;
  total?: number;
  elapsed_ms?: number;
  error?: string;
  note?: string;
  hint?: string;
  code?: unknown;
  msg?: string;
  data_kind?: "null" | "missing" | "array" | "object" | "scalar";
  top_keys?: string[];
  data_keys?: string[];
}

export interface PullReport {
  date_range: DateRange;
  per_api: Record<string, ApiPullStatus>;
  effective_apis: number;
  total_keywords: number;
}

export interface LivePullInput {
  ctx: CategoryContext;
  date_range: DateRange;
  field_mapping: KeywordFieldMapping;
  inter_call_delay_ms?: number;
  top_per_api?: number;
}

export interface LivePullResult {
  probe_results: Record<string, ApiProbeResult>;
  report: PullReport;
}

const DEFAULT_DELAY = 150;
const DEFAULT_TOP = 200;

const VAR_RE = /\{([a-zA-Z0-9_]+)\}/g;

export function defaultDateRange(now: Date = new Date()): DateRange {
  // 上一个完整自然月：今天 2026-03-15 → 2026-02-01 ~ 2026-02-28
  // 见 docs/12 §5.6 / docs/18 §3.4
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed: 当月
  const startUtc = new Date(Date.UTC(y, m - 1, 1));
  const endUtc = new Date(Date.UTC(y, m, 0)); // 当月第 0 天 = 上月最后一天
  return { start_date: ymd(startUtc), end_date: ymd(endUtc) };
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function buildVarTable(ctx: CategoryContext, date_range: DateRange): Record<string, string | undefined> {
  return {
    tertiary_category: ctx.tertiary_category,
    category_id: ctx.category_id,
    start_date: date_range.start_date,
    end_date: date_range.end_date,
    tenant_id: process.env.ZICHEN_TENANT_ID,
    user_id: process.env.ZICHEN_USER_ID,
  };
}

interface Rendered {
  params: Record<string, unknown>;
  missing_vars: string[];
  needs_category_id: boolean;
}

function renderRequestTemplate(
  template: Record<string, unknown> | undefined,
  vars: Record<string, string | undefined>,
  dateFormat?: "month" | "day",
): Rendered {
  const params: Record<string, unknown> = {};
  const missing: string[] = [];
  let needs_category_id = false;

  if (!template) return { params, missing_vars: missing, needs_category_id };

  const visit = (node: Record<string, unknown>): void => {
    for (const [k, v] of Object.entries(node)) {
      if ((k === "query" || k === "body") && v && typeof v === "object" && !Array.isArray(v)) {
        visit(v as Record<string, unknown>);
        continue;
      }
      if (v == null) {
        params[k] = v;
        continue;
      }
      if (typeof v === "string") {
        const replaced = v.replace(VAR_RE, (_, name: string) => {
          if (name === "category_id") needs_category_id = true;
          const val = vars[name];
          if (val == null || val === "") {
            missing.push(name);
            return "";
          }
          return String(val);
        });
        if (replaced === "" && v !== "") {
          continue;
        }
        params[k] = replaced;
        continue;
      }
      params[k] = v;
    }
  };

  visit(template);

  // date_format=month：把日期键值截短为 YYYY-MM（见 docs/18 §3.4）
  if (dateFormat === "month") {
    const dateKeys = ["start_date", "end_date", "business_date"];
    for (const k of dateKeys) {
      const v = params[k];
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
        params[k] = v.slice(0, 7);
      }
    }
  }

  return { params, missing_vars: Array.from(new Set(missing)), needs_category_id };
}

function sampleRecords(probe: ApiProbeResult): Array<Record<string, unknown>> {
  const top = probe.response?.top ?? [];
  return top.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Array<Record<string, unknown>>;
}

function uniqueNonEmpty(records: Array<Record<string, unknown>>, fields: string[]): string[] {
  const out = new Set<string>();
  for (const r of records) {
    for (const f of fields) {
      const v = r[f];
      if (v == null) continue;
      const s = String(v).trim();
      if (s) out.add(s);
    }
  }
  return Array.from(out);
}

function parseDateIntervalValue(v: unknown): Array<[number, number]> {
  if (v == null) return [];
  const s = String(v);
  const hits = Array.from(s.matchAll(/(\d{4})-(\d{2})(?:-(\d{2}))?/g));
  if (hits.length === 0) return [];

  const toInterval = (m: RegExpMatchArray): [number, number] => {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = m[3] ? Number(m[3]) : 1;
    const start = Date.UTC(y, mo - 1, d);
    if (m[3]) return [start, start];
    const end = Date.UTC(y, mo, 0);
    return [start, end];
  };

  if (hits.length >= 2 && /[~～至-]/.test(s)) {
    const a = toInterval(hits[0]!);
    const b = toInterval(hits[1]!);
    return [[Math.min(a[0], b[0]), Math.max(a[1], b[1])]];
  }
  return hits.map(toInterval);
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

export function validateProbeContext(probe: ApiProbeResult, ctx: CategoryContext, dateRange: DateRange): ApiPullStatus | null {
  if (probe.status.state !== "ok" || !probe.response || (probe.response.total ?? 0) === 0) return null;
  const records = sampleRecords(probe).slice(0, 50);
  if (records.length === 0) return null;

  const mismatches: string[] = [];
  const requestQuery = probe.request.query ?? {};
  const requestBody = (probe.request.body && typeof probe.request.body === "object" && !Array.isArray(probe.request.body))
    ? probe.request.body as Record<string, unknown>
    : {};
  const requestedTertiary = String(requestQuery.tertiary_category ?? requestBody.tertiary_category ?? ctx.tertiary_category ?? "").trim();
  const requestedCategoryId = String(requestQuery.category_id ?? requestBody.category_id ?? ctx.category_id ?? "").trim();

  const actualCategories = uniqueNonEmpty(records, ["tertiary_category", "cate_name", "category_name"]);
  const mismatchedCategories = requestedTertiary
    ? actualCategories.filter((x) => x !== requestedTertiary)
    : [];
  if (requestedTertiary && actualCategories.length > 0 && mismatchedCategories.length > 0) {
    mismatches.push(`cate_name/tertiary_category 返回 [${actualCategories.slice(0, 5).join(",")}]，请求 ${requestedTertiary}`);
  }

  const actualCategoryIds = uniqueNonEmpty(records, ["category_id", "cate_id"]);
  if (requestedCategoryId && actualCategoryIds.length > 0 && !actualCategoryIds.includes(requestedCategoryId)) {
    mismatches.push(`category_id 返回 [${actualCategoryIds.slice(0, 5).join(",")}]，请求 ${requestedCategoryId}`);
  }

  const dateFields = ["statist_date", "business_date", "biz_date", "start_date", "end_date"];
  const intervals: Array<[number, number]> = [];
  for (const r of records) {
    for (const f of dateFields) intervals.push(...parseDateIntervalValue(r[f]));
  }
  const requested = parseDateIntervalValue(`${dateRange.start_date} ~ ${dateRange.end_date}`)[0];
  if (requested && intervals.length > 0 && !intervals.some((x) => overlaps(x, requested))) {
    const samples = uniqueNonEmpty(records, dateFields).slice(0, 5).join(",");
    mismatches.push(`biz_date/business_date 返回 [${samples}]，请求 ${dateRange.start_date}~${dateRange.end_date}`);
  }

  if (mismatches.length === 0) return null;
  const st = probe.status;
  return {
    status: "context_mismatch",
    http: st.http,
    total: probe.response.total,
    elapsed_ms: st.elapsed_ms,
    hint: `${mismatches.join("；")}；已剔除，不进入关键词榜`,
  };
}

function firstSegmentBelowData(root: string | undefined): string | undefined {
  if (!root) return undefined;
  const stripped = root.replace(/\[\]$/g, "");
  const parts = stripped.split(".").filter(Boolean);
  if (parts.length < 2) return undefined;
  if (parts[0] !== "data") return undefined;
  return parts[1];
}

function classifyProbeV2(
  probe: ApiProbeResult,
  expectedRoot: string | undefined,
  expectedKwField: string | undefined,
): ApiPullStatus {
  const st = probe.status;
  if (st.state === "blocked") {
    if (st.reason === "card_not_found") return { status: "not_registered", note: "card_not_found" };
    if (st.reason === "live_probe_disabled") return { status: "live_disabled" };
    if (st.reason === "env_missing") {
      const missing = (st.details as { missing?: string[] } | undefined)?.missing ?? [];
      return { status: "env_missing", note: `missing=${missing.join(",")}` };
    }
    if (st.reason === "missing_params") return { status: "missing_required_params" };
    return { status: "missing_required_params", note: st.reason };
  }
  if (st.state === "timeout") return { status: "timeout", elapsed_ms: st.elapsed_ms, error: st.error };
  if (st.state === "network_error") return { status: "network_error", elapsed_ms: st.elapsed_ms, error: st.error };
  if (st.state === "http_error") {
    const rp = probe.response?.raw_preview;
    return {
      status: "http_error",
      http: st.http,
      elapsed_ms: st.elapsed_ms,
      error: st.error,
      code: rp?.code,
      msg: rp?.msg,
      top_keys: rp?.top_keys,
      data_kind: rp?.data_kind,
      data_keys: rp?.data_keys,
    };
  }

  // state === "ok"
  const total = probe.response?.total ?? 0;
  const rp = probe.response?.raw_preview;
  const sample_keys = probe.response?.sample_keys ?? [];
  const base: ApiPullStatus = {
    status: "ok",
    http: st.http,
    total,
    elapsed_ms: st.elapsed_ms,
    code: rp?.code,
    msg: rp?.msg,
    top_keys: rp?.top_keys,
    data_kind: rp?.data_kind,
    data_keys: rp?.data_keys,
  };

  // 1) 业务失败：code 非成功
  if (rp && rp.code != null && rp.code !== "") {
    const codeStr = String(rp.code).toLowerCase();
    const okCodes = new Set(["200", "0", "ok", "success", "true"]);
    if (!okCodes.has(codeStr)) {
      return { ...base, status: "business_failed", hint: `code=${rp.code}; msg=${rp.msg ?? ""}` };
    }
  }

  // 2) data 整体缺失或为 null
  if (rp && (rp.data_kind === "null" || rp.data_kind === "missing")) {
    const sample = rp.sample_text ? ` sample=${rp.sample_text.slice(0, 120).replace(/\s+/g, " ")}` : "";
    return {
      ...base,
      status: "data_root_null",
      hint: `data_kind=${rp.data_kind}; top_keys=[${(rp.top_keys ?? []).join(",")}];${sample}`,
    };
  }

  // 3) total=0 且 cards.response_schema.root 与实际 data 子键不一致
  if (total === 0 && rp?.data_kind === "object" && Array.isArray(rp.data_keys) && rp.data_keys.length > 0) {
    const firstSeg = firstSegmentBelowData(expectedRoot);
    if (firstSeg && !rp.data_keys.includes(firstSeg)) {
      return {
        ...base,
        status: "root_path_mismatch",
        hint: `expected=data.${firstSeg}, got data_keys=[${rp.data_keys.join(",")}]`,
      };
    }
  }

  // 4) total=0 但路径无明显错位 -> 业务空
  if (total === 0) {
    return { ...base, status: "business_empty", hint: "data 路径正确，但所选类目/区间内无关键词" };
  }

  // 5) 有数据但找不到 keyword 字段
  if (expectedKwField && sample_keys.length > 0 && !sample_keys.includes(expectedKwField)) {
    return {
      ...base,
      status: "keyword_field_missing",
      hint: `expected_field=${expectedKwField}; sample_keys=[${sample_keys.slice(0, 10).join(",")}]`,
    };
  }

  return base;
}

export async function livePullKeywordMetrics(input: LivePullInput): Promise<LivePullResult> {
  const { ctx, date_range, field_mapping } = input;
  const delay = input.inter_call_delay_ms ?? DEFAULT_DELAY;
  const top = input.top_per_api ?? DEFAULT_TOP;
  const vars = buildVarTable(ctx, date_range);

  const apiNames = field_mapping.merge_order_priority?.length
    ? field_mapping.merge_order_priority
    : Object.keys(field_mapping.apis);

  const probe_results: Record<string, ApiProbeResult> = {};
  const per_api: Record<string, ApiPullStatus> = {};
  let effective_apis = 0;
  let total_keywords = 0;
  let first = true;

  for (const apiName of apiNames) {
    const cfg = field_mapping.apis[apiName];
    if (!cfg) {
      per_api[apiName] = { status: "not_registered", note: "fieldMapping.apis 中未声明" };
      continue;
    }

    if (cfg.enabled === false) {
      per_api[apiName] = { status: "disabled_by_config", note: "mapping.enabled=false，已在 registry 层禁用" };
      continue;
    }

    const rendered = renderRequestTemplate(cfg.request_template as Record<string, unknown> | undefined, vars, cfg.date_format);

    if (rendered.needs_category_id && !ctx.category_id) {
      per_api[apiName] = {
        status: "skipped_missing_category_id",
        note: "request_template 需要 category_id，但当前未解析到",
      };
      continue;
    }

    if (!first && delay > 0) {
      await sleep(delay);
    }
    first = false;

    const probe = await probeApiSample({
      api_id: apiName,
      params: rendered.params,
      top,
      response_root_override: cfg.response_root,
    });
    const contextMismatch = validateProbeContext(probe, ctx, date_range);
    if (contextMismatch) {
      const sanitizedProbe: ApiProbeResult = {
        ...probe,
        response: probe.response ? { ...probe.response, total: 0, top: [] } : probe.response,
      };
      probe_results[apiName] = sanitizedProbe;
      per_api[apiName] = contextMismatch;
      continue;
    }

    probe_results[apiName] = probe;
    const cls = classifyProbeV2(probe, cfg.response_root, cfg.keyword_field);
    if (rendered.missing_vars.length && !cls.note) {
      cls.note = `missing_vars=${rendered.missing_vars.join(",")}`;
    }
    per_api[apiName] = cls;
    if (cls.status === "ok") {
      effective_apis += 1;
      total_keywords += cls.total ?? 0;
    }
  }

  return {
    probe_results,
    report: { date_range, per_api, effective_apis, total_keywords },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}