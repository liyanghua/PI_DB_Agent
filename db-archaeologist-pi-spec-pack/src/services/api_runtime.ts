// API 出站探针：按 ApiAssetCard 拼 URL、注入 ZICHEN_* 凭据、可选发请求并取 TOP N。
// 严格安全：LIVE_PROBE !== "true" 时绝不出站。
// 输出统一为 ApiProbeResult 形状（kind="api_probe_result"）。

import { getCard } from "./registry.js";
import type { ApiAssetCard, ParamRow } from "../lib/types.js";

const SECRET_REDACT = "***";
const RESPONSE_BODY_GUARD = 1024 * 1024; // 1MB
const DEFAULT_TIMEOUT_MS = 8000;
const TOP_MIN = 1;
const TOP_MAX = 50;

export type ProbeEnv = {
  baseUrl: string;
  tenantId: string;
  userId: string;
  appCodeKey: string;
  appCode: string;
};

export type AuthInjectTrace = { header: string[]; body: string[]; query: string[] };

export type AssembledRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  headers_keys: string[];
  query: Record<string, unknown>;
  body: unknown | null;
  auth_inject: AuthInjectTrace;
};

export type ApiProbeStatus =
  | { state: "blocked"; reason: "live_probe_disabled" | "env_missing" | "missing_params" | "card_not_found"; details?: unknown }
  | { state: "ok" | "http_error" | "network_error" | "timeout"; http?: number; elapsed_ms: number; error?: string };

export type ApiProbeResult = {
  kind: "api_probe_result";
  api_id: string;
  method: string;
  path: string;
  request: {
    url: string;
    query: Record<string, unknown>;
    body: unknown | null;
    headers_keys: string[];
    auth_inject: AuthInjectTrace;
  };
  status: ApiProbeStatus;
  response?: {
    root: string;
    total: number;
    truncated: boolean;
    top: unknown[];
    sample_keys: string[];
    raw_kind: "array" | "object" | "scalar";
  };
  missing_required_params?: Array<{ name: string; desc?: string; position?: string }>;
};

// ─────────────────────────────────────────────
// env loader
// ─────────────────────────────────────────────
export function loadProbeEnv(): { env?: ProbeEnv; missing: string[] } {
  const need = {
    baseUrl: process.env.ZICHEN_BASE_URL,
    tenantId: process.env.ZICHEN_TENANT_ID,
    userId: process.env.ZICHEN_USER_ID,
    appCodeKey: process.env.ZICHEN_APP_CODE_KEY,
    appCode: process.env.ZICHEN_APP_CODE,
  };
  const missing: string[] = [];
  for (const [k, v] of Object.entries(need)) {
    if (!v || String(v).trim() === "") missing.push(envName(k));
  }
  if (missing.length) return { missing };
  return { env: need as ProbeEnv, missing: [] };
}

function envName(k: string): string {
  switch (k) {
    case "baseUrl":     return "ZICHEN_BASE_URL";
    case "tenantId":    return "ZICHEN_TENANT_ID";
    case "userId":      return "ZICHEN_USER_ID";
    case "appCodeKey":  return "ZICHEN_APP_CODE_KEY";
    case "appCode":     return "ZICHEN_APP_CODE";
    default:            return k;
  }
}

// ─────────────────────────────────────────────
// assemble
// ─────────────────────────────────────────────
function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

function declaredQueryNames(card: ApiAssetCard): Set<string> {
  return new Set((card.request_schema?.query ?? []).map((p) => p.name));
}
function declaredBodyNames(card: ApiAssetCard): Set<string> {
  const rows = card.request_schema?.body;
  return new Set(Array.isArray(rows) ? rows.map((p) => p.name) : []);
}

function pickRequiredQuery(card: ApiAssetCard): ParamRow[] {
  return (card.request_schema?.query ?? []).filter((p) => p.required === true);
}

export function assembleRequest(card: ApiAssetCard, env: ProbeEnv, params: Record<string, unknown> = {}): AssembledRequest {
  const method = (card.method || "GET").toUpperCase();
  const useBody = method === "POST" || method === "PUT" || method === "PATCH";

  const declaredQ = declaredQueryNames(card);
  const declaredB = declaredBodyNames(card);

  const auth: AuthInjectTrace = { header: [], body: [], query: [] };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-ca-appCodeKey": env.appCodeKey,
    "x-ca-appCode": env.appCode,
  };
  auth.header.push("x-ca-appCodeKey", "x-ca-appCode");

  const query: Record<string, unknown> = {};
  let body: Record<string, unknown> | null = null;

  // 用户传的 params 先按声明位置分流；未声明的字段按 method 默认（POST→body, GET→query）
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined) continue;
    if (declaredQ.has(k)) query[k] = v;
    else if (declaredB.has(k)) {
      body = body ?? {};
      body[k] = v;
    } else if (useBody) {
      body = body ?? {};
      body[k] = v;
    } else {
      query[k] = v;
    }
  }

  // tenant_id / user_id 注入：用户已显式提供则跳过
  const idents: Array<["tenant_id" | "user_id", string]> = [
    ["tenant_id", env.tenantId],
    ["user_id", env.userId],
  ];
  for (const [name, val] of idents) {
    if (name in (params || {})) continue;
    if (declaredQ.has(name)) {
      query[name] = val;
      auth.query.push(name);
    } else if (declaredB.has(name)) {
      body = body ?? {};
      body[name] = val;
      auth.body.push(name);
    } else if (useBody) {
      body = body ?? {};
      body[name] = val;
      auth.body.push(name);
    } else {
      query[name] = val;
      auth.query.push(name);
    }
  }

  const baseUrl = joinUrl(env.baseUrl, card.path);
  const qs = encodeQuery(query);
  const url = qs ? `${baseUrl}?${qs}` : baseUrl;

  const finalBody = useBody ? (body ?? {}) : null;

  return {
    url,
    method,
    headers,
    headers_keys: Object.keys(headers),
    query,
    body: finalBody,
    auth_inject: auth,
  };
}

function encodeQuery(q: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const x of v) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(x))}`);
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join("&");
}

// ─────────────────────────────────────────────
// response root navigator
// ─────────────────────────────────────────────
export function pickFromRoot(payload: unknown, rootPath: string): { value: unknown; raw_kind: "array" | "object" | "scalar" } {
  if (!rootPath || rootPath === "$" || rootPath === "") {
    return classify(payload);
  }
  // 支持 "data.result[]" / "data.list" 这类点路径，[] 视为取数组本身
  const stripped = rootPath.replace(/\[\]$/g, "");
  const parts = stripped.split(".").filter(Boolean);
  let cur: unknown = payload;
  for (const seg of parts) {
    if (cur == null) return classify(null);
    if (Array.isArray(cur)) {
      cur = (cur as unknown[]).map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>)[seg] : undefined)).filter((v) => v !== undefined);
      if (Array.isArray(cur) && cur.length === 1 && Array.isArray((cur as unknown[])[0])) cur = (cur as unknown[])[0];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return classify(undefined);
    }
  }
  return classify(cur);
}

function classify(v: unknown): { value: unknown; raw_kind: "array" | "object" | "scalar" } {
  if (Array.isArray(v)) return { value: v, raw_kind: "array" };
  if (v && typeof v === "object") return { value: v, raw_kind: "object" };
  return { value: v, raw_kind: "scalar" };
}

export function pickTop(payload: unknown, rootPath: string, top: number): { total: number; truncated: boolean; top: unknown[]; sample_keys: string[]; raw_kind: "array" | "object" | "scalar" } {
  const { value, raw_kind } = pickFromRoot(payload, rootPath);
  if (raw_kind === "array") {
    const arr = value as unknown[];
    const sliced = arr.slice(0, top);
    const sample = sliced.find((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown> | undefined;
    return {
      total: arr.length,
      truncated: arr.length > top,
      top: sliced,
      sample_keys: sample ? Object.keys(sample) : [],
      raw_kind,
    };
  }
  if (raw_kind === "object") {
    const obj = value as Record<string, unknown>;
    return {
      total: 1,
      truncated: false,
      top: [obj],
      sample_keys: Object.keys(obj),
      raw_kind,
    };
  }
  return {
    total: value === undefined ? 0 : 1,
    truncated: false,
    top: value === undefined ? [] : [value],
    sample_keys: [],
    raw_kind,
  };
}

// ─────────────────────────────────────────────
// public: probeApiSample
// ─────────────────────────────────────────────
export type ProbeApiSampleInput = {
  api_id: string;
  params?: Record<string, unknown>;
  top?: number;
  timeout_ms?: number;
};

export async function probeApiSample(args: ProbeApiSampleInput): Promise<ApiProbeResult> {
  if (!args || typeof args.api_id !== "string" || !args.api_id.trim()) {
    throw new Error("probe_api_sample: api_id is required");
  }
  const top = clamp(args.top ?? 10, TOP_MIN, TOP_MAX);
  const timeout_ms = clamp(args.timeout_ms ?? DEFAULT_TIMEOUT_MS, 1000, 30_000);

  const card = getCard(args.api_id);
  if (!card) {
    return shellResult(args.api_id, undefined, undefined, {
      state: "blocked", reason: "card_not_found",
    });
  }

  // env
  const { env, missing } = loadProbeEnv();
  if (!env) {
    return shellResult(args.api_id, card, undefined, {
      state: "blocked", reason: "env_missing", details: { missing },
    });
  }

  // 必填参数校验（仅看 query 声明，body 端结构在源 markdown 不稳定，先放宽）
  const required = pickRequiredQuery(card);
  const userParams = args.params ?? {};
  const missingParams = required.filter((p) => userParams[p.name] === undefined || userParams[p.name] === "");
  const assembled = assembleRequest(card, env, userParams);

  if (missingParams.length) {
    return shellResult(args.api_id, card, assembled, {
      state: "blocked", reason: "missing_params",
    }, undefined, missingParams.map((p) => ({ name: p.name, desc: p.desc, position: p.position })));
  }

  // live probe gate
  if (String(process.env.LIVE_PROBE).toLowerCase() !== "true") {
    return shellResult(args.api_id, card, assembled, {
      state: "blocked", reason: "live_probe_disabled",
    });
  }

  // fetch
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout_ms);
  let httpStatus: number | undefined;
  try {
    const init: RequestInit = {
      method: assembled.method,
      headers: assembled.headers,
      signal: ac.signal,
    };
    if (assembled.body !== null) init.body = JSON.stringify(assembled.body);
    const resp = await fetch(assembled.url, init);
    httpStatus = resp.status;
    const text = await resp.text();
    const elapsed = Date.now() - t0;
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

    if (!resp.ok) {
      return {
        kind: "api_probe_result",
        api_id: args.api_id,
        method: card.method,
        path: card.path,
        request: requestFacade(assembled),
        status: { state: "http_error", http: httpStatus, elapsed_ms: elapsed, error: typeof payload === "string" ? payload.slice(0, 500) : safe(payload).slice(0, 500) },
        response: extractResponse(payload, card, top),
      };
    }

    return {
      kind: "api_probe_result",
      api_id: args.api_id,
      method: card.method,
      path: card.path,
      request: requestFacade(assembled),
      status: { state: "ok", http: httpStatus, elapsed_ms: elapsed },
      response: extractResponse(payload, card, top),
    };
  } catch (err: unknown) {
    const elapsed = Date.now() - t0;
    const aborted = (err as { name?: string })?.name === "AbortError";
    return {
      kind: "api_probe_result",
      api_id: args.api_id,
      method: card.method,
      path: card.path,
      request: requestFacade(assembled),
      status: aborted
        ? { state: "timeout", elapsed_ms: elapsed, error: `timeout ${timeout_ms}ms` }
        : { state: "network_error", elapsed_ms: elapsed, http: httpStatus, error: String((err as Error)?.message ?? err) },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────
function clamp(n: number, lo: number, hi: number): number {
  if (typeof n !== "number" || isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function shellResult(
  api_id: string,
  card: ApiAssetCard | undefined,
  assembled: AssembledRequest | undefined,
  status: ApiProbeStatus,
  response?: ApiProbeResult["response"],
  missing_required_params?: ApiProbeResult["missing_required_params"],
): ApiProbeResult {
  return {
    kind: "api_probe_result",
    api_id,
    method: card?.method ?? "?",
    path: card?.path ?? "?",
    request: assembled
      ? requestFacade(assembled)
      : { url: "", query: {}, body: null, headers_keys: [], auth_inject: { header: [], body: [], query: [] } },
    status,
    response,
    missing_required_params,
  };
}

function requestFacade(a: AssembledRequest) {
  return {
    url: a.url,
    query: a.query,
    body: a.body,
    headers_keys: a.headers_keys,
    auth_inject: a.auth_inject,
  };
}

function extractResponse(payload: unknown, card: ApiAssetCard, top: number) {
  const root = card.response_schema?.root || "$";
  const guarded = guardSize(payload);
  const picked = pickTop(guarded, root, top);
  return {
    root,
    total: picked.total,
    truncated: picked.truncated,
    top: picked.top,
    sample_keys: picked.sample_keys,
    raw_kind: picked.raw_kind,
  };
}

function guardSize(v: unknown): unknown {
  try {
    const s = JSON.stringify(v);
    if (s.length <= RESPONSE_BODY_GUARD) return v;
  } catch { /* unserializable, fall through */ }
  if (Array.isArray(v)) return v.slice(0, 50);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, val] of Object.entries(v)) {
      out[k] = Array.isArray(val) ? val.slice(0, 50) : val;
      if (++count >= 50) break;
    }
    return out;
  }
  return v;
}

function safe(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

void SECRET_REDACT;