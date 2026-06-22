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

export type AuthInjectTrace = {
  header: string[];
  body: string[];
  query: string[];
  policy_style?: "query_camel" | "body_snake" | "legacy_snake";
  source?: "verified_call" | "legacy";
};

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

export type RawPreview = {
  top_keys: string[];
  code?: unknown;
  msg?: string;
  data_kind: "null" | "missing" | "array" | "object" | "scalar";
  data_keys?: string[];
  data_array_length?: number;
  sample_text: string;
};

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
    raw_preview?: RawPreview;
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
  // 运行时开关：DBA_DISABLE_VERIFIED_CALL=1 强制走 legacy
  const disableVerified = process.env.DBA_DISABLE_VERIFIED_CALL === "1";
  if (!disableVerified && card.verified_call) {
    return assembleVerifiedCall(card, env, params);
  }
  return legacyAssembleRequest(card, env, params);
}

function deriveHostFromBaseUrl(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    return u.origin;
  } catch {
    return baseUrl.replace(/\/+$/, "").replace(/\/openApi.*$/i, "");
  }
}

function mergeBodyTemplate(template: Record<string, unknown>, userParams: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...template };
  for (const [k, v] of Object.entries(userParams)) {
    if (v === undefined) continue;
    if (v === null) {
      delete out[k];
      continue;
    }
    out[k] = v;
  }
  return out;
}

function assembleVerifiedCall(card: ApiAssetCard, env: ProbeEnv, params: Record<string, unknown>): AssembledRequest {
  const vc = card.verified_call!;
  const method = (card.method || "POST").toUpperCase();
  const useBody = method === "POST" || method === "PUT" || method === "PATCH";

  const host = process.env.ZICHEN_HOST?.trim() || deriveHostFromBaseUrl(env.baseUrl);

  const auth: AuthInjectTrace = {
    header: [],
    body: [],
    query: [],
    policy_style: vc.auth_inject_policy.style,
    source: "verified_call",
  };

  // 1. body：mergeBodyTemplate
  let body: Record<string, unknown> | null = null;
  if (useBody) {
    body = mergeBodyTemplate(vc.body_template ?? {}, params);
  }

  // 2. URL：host + base_url_segment + url_template；user 同名 query 覆盖
  const tplPath = vc.url_template || "";
  const qIdx = tplPath.indexOf("?");
  const pathOnly = qIdx >= 0 ? tplPath.slice(0, qIdx) : tplPath;
  const tplQs = qIdx >= 0 ? tplPath.slice(qIdx + 1) : "";
  const queryMap: Record<string, string> = {};
  if (tplQs) {
    for (const part of tplQs.split("&")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      const k = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
      const v = eq >= 0 ? decodeURIComponent(part.slice(eq + 1)) : "";
      queryMap[k] = v;
    }
  }

  // userParams 覆盖 URL 模板中已有 query key；POST 不额外追加 body-only 字段，避免验证模板固定值污染 live 请求
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (!useBody || Object.prototype.hasOwnProperty.call(queryMap, k)) {
      queryMap[k] = v === null ? "" : String(v);
    }
  }

  // 3. 身份注入
  if (vc.auth_inject_policy.style === "query_camel") {
    queryMap["userId"] = env.userId;
    queryMap["tenantId"] = env.tenantId;
    auth.query.push("userId", "tenantId");
    if (body) {
      // body 不写蛇形身份
      delete body["user_id"];
      delete body["tenant_id"];
    }
  } else if (vc.auth_inject_policy.style === "body_snake") {
    body = body ?? {};
    body["user_id"] = env.userId;
    body["tenant_id"] = env.tenantId;
    auth.body.push("user_id", "tenant_id");
  }

  // 4. headers：verified_call 默认仍需要 x-ca-* 签名头；旧 overlay 若 headers_required=[] 也按默认补齐
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const requiredHeaders = (vc.auth_inject_policy.headers_required?.length
    ? vc.auth_inject_policy.headers_required
    : ["x-ca-appCodeKey", "x-ca-appCode"]);
  for (const h of requiredHeaders) {
    if (h === "x-ca-appCodeKey") {
      headers["x-ca-appCodeKey"] = env.appCodeKey;
      auth.header.push("x-ca-appCodeKey");
    } else if (h === "x-ca-appCode") {
      headers["x-ca-appCode"] = env.appCode;
      auth.header.push("x-ca-appCode");
    }
  }

  const queryRecord: Record<string, unknown> = { ...queryMap };
  const qs = encodeQuery(queryRecord);
  const url = `${host}${vc.base_url_segment}${pathOnly}${qs ? `?${qs}` : ""}`;

  return {
    url,
    method,
    headers,
    headers_keys: Object.keys(headers),
    query: queryRecord,
    body: useBody ? (body ?? {}) : null,
    auth_inject: auth,
  };
}

function legacyAssembleRequest(card: ApiAssetCard, env: ProbeEnv, params: Record<string, unknown> = {}): AssembledRequest {
  const method = (card.method || "GET").toUpperCase();
  const useBody = method === "POST" || method === "PUT" || method === "PATCH";

  const declaredQ = declaredQueryNames(card);
  const declaredB = declaredBodyNames(card);

  const auth: AuthInjectTrace = {
    header: [],
    body: [],
    query: [],
    policy_style: "legacy_snake",
    source: "legacy",
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-ca-appCodeKey": env.appCodeKey,
    "x-ca-appCode": env.appCode,
  };
  auth.header.push("x-ca-appCodeKey", "x-ca-appCode");

  const query: Record<string, unknown> = {};
  let body: Record<string, unknown> | null = null;

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
  // 可选：当 mapping.response_root 与 card.response_schema.root 不一致时，
  // 由调用方（如 keyword_demand/live_pull）传入 mapping 的 root；
  // 用于 pickTop 的 sample_keys/total 提取，不影响真机请求本身。
  response_root_override?: string;
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

  // 必填参数校验：verified_call 命中时跳过（运行时关闭开关亦同步）
  const useVerified = !!card.verified_call && process.env.DBA_DISABLE_VERIFIED_CALL !== "1";
  const required = useVerified ? [] : pickRequiredQuery(card);
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
        response: extractResponse(payload, card, top, args.response_root_override),
      };
    }

    return {
      kind: "api_probe_result",
      api_id: args.api_id,
      method: card.method,
      path: card.path,
      request: requestFacade(assembled),
      status: { state: "ok", http: httpStatus, elapsed_ms: elapsed },
      response: extractResponse(payload, card, top, args.response_root_override),
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

function extractRawPreview(payload: unknown): RawPreview {
  const REDACT_KEYS = new Set([
    "appCodeKey", "appCode", "app_code_key", "app_code",
    "x-ca-appCodeKey", "x-ca-appCode", "authorization", "token", "secret",
    "accessToken", "access_token", "refreshToken", "refresh_token",
  ]);

  // top_keys
  let top_keys: string[] = [];
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    top_keys = Object.keys(payload).slice(0, 16);
  }

  // code / msg
  const obj = payload as Record<string, unknown>;
  const code = obj?.code;
  let msg = obj?.msg;
  if (typeof msg === "string" && msg.length > 200) {
    msg = msg.slice(0, 200) + "...";
  }

  // data classification
  const dataValue = obj?.data;
  let data_kind: RawPreview["data_kind"] = "missing";
  let data_keys: string[] | undefined;
  let data_array_length: number | undefined;

  if (dataValue === null) {
    data_kind = "null";
  } else if (dataValue === undefined) {
    data_kind = "missing";
  } else if (Array.isArray(dataValue)) {
    data_kind = "array";
    data_array_length = dataValue.length;
    // try extract keys from first element
    if (dataValue.length > 0 && dataValue[0] && typeof dataValue[0] === "object" && !Array.isArray(dataValue[0])) {
      data_keys = Object.keys(dataValue[0] as Record<string, unknown>).slice(0, 16);
    }
  } else if (typeof dataValue === "object") {
    data_kind = "object";
    data_keys = Object.keys(dataValue as Record<string, unknown>).slice(0, 16);
  } else {
    data_kind = "scalar";
  }

  // sample_text with redaction
  let sample_text = "";
  try {
    const raw = JSON.stringify(payload);
    sample_text = raw.slice(0, 2048);
    // simple redaction: replace sensitive values
    for (const key of REDACT_KEYS) {
      const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "gi");
      sample_text = sample_text.replace(pattern, `"${key}":"***"`);
    }
  } catch {
    sample_text = "[unserializable]";
  }

  return {
    top_keys,
    code,
    msg,
    data_kind,
    data_keys,
    data_array_length,
    sample_text,
  };
}

function extractResponse(payload: unknown, card: ApiAssetCard, top: number, rootOverride?: string) {
  const root = rootOverride || card.response_schema?.root || "$";
  const guarded = guardSize(payload);
  const raw_preview = extractRawPreview(guarded);
  const picked = pickTop(guarded, root, top);
  return {
    root,
    total: picked.total,
    truncated: picked.truncated,
    top: picked.top,
    sample_keys: picked.sample_keys,
    raw_kind: picked.raw_kind,
    raw_preview,
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