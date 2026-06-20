// auto_resolve.ts: 当 taxonomy 未命中且用户未给 category_id 时，
// 通过 fieldMapping.category_lookup_api 反查淘宝类目库，挑首个等价/包含命中的条目。
// 仅在 live=true 时调用；底层依赖 probeApiSample，本身不直接出站。

import { probeApiSample } from "../api_runtime.js";
import type { KeywordFieldMapping } from "./types.js";

export interface AutoResolveCandidate {
  cate_name: string;
  cate_id: string;
  match_kind: "exact" | "ci_exact" | "input_contains_cate" | "cate_contains_input";
  match_score: number;
}

export interface AutoResolveTrace {
  api_id: string | null;
  status:
    | "disabled"
    | "matched"
    | "miss"
    | "not_registered"
    | "blocked"
    | "http_error"
    | "network_error"
    | "timeout"
    | "unexpected_payload";
  reason?: string;
  candidates: AutoResolveCandidate[];
  total_returned?: number;
  elapsed_ms?: number;
}

export interface AutoResolveResult {
  category_id?: string;
  category_name?: string;
  trace: AutoResolveTrace;
}

const TOP_FETCH = 50;

/**
 * 调 fieldMapping.category_lookup_api 反查类目，按下列规则挑候选：
 *   1) cate_name === input（大小写精确）
 *   2) cate_name.toLowerCase() === input.toLowerCase()
 *   3) input 包含 cate_name（input 含 cate）
 *   4) cate_name 包含 input（cate 含 input）
 *
 * 返回首个 best-match。candidates 字段保留所有命中以备 trace。
 */
export async function autoResolveCategory(
  input: string,
  fieldMapping: KeywordFieldMapping,
): Promise<AutoResolveResult> {
  const lookupApi = fieldMapping.category_lookup_api;
  if (!lookupApi || !lookupApi.trim()) {
    return {
      trace: {
        api_id: null,
        status: "disabled",
        reason: "fieldMapping.category_lookup_api 未配置",
        candidates: [],
      },
    };
  }

  const t0 = Date.now();
  const probe = await probeApiSample({ api_id: lookupApi, params: {}, top: TOP_FETCH });
  const elapsed_ms = Date.now() - t0;

  if (probe.status.state !== "ok") {
    const st = probe.status;
    if (st.state === "blocked") {
      return {
        trace: {
          api_id: lookupApi,
          status: st.reason === "card_not_found" ? "not_registered" : "blocked",
          reason: st.reason,
          candidates: [],
          elapsed_ms,
        },
      };
    }
    return {
      trace: {
        api_id: lookupApi,
        status: st.state,
        reason: "error" in st ? st.error : undefined,
        candidates: [],
        elapsed_ms,
      },
    };
  }

  const rows = probe.response?.top ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      trace: {
        api_id: lookupApi,
        status: "miss",
        reason: "response.top 为空",
        candidates: [],
        total_returned: 0,
        elapsed_ms,
      },
    };
  }

  const normalizedInput = input.trim();
  const lowerInput = normalizedInput.toLowerCase();

  const exact: AutoResolveCandidate[] = [];
  const ciExact: AutoResolveCandidate[] = [];
  const inputContains: AutoResolveCandidate[] = [];
  const cateContains: AutoResolveCandidate[] = [];

  let firstUnexpected = true;
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      if (firstUnexpected) firstUnexpected = false;
      continue;
    }
    const obj = row as Record<string, unknown>;
    const cateName = String(obj.cate_name ?? obj.category_name ?? "").trim();
    const cateId = String(obj.cate_id ?? obj.category_id ?? "").trim();
    if (!cateName || !cateId) continue;

    const lowerCate = cateName.toLowerCase();
    if (cateName === normalizedInput) {
      exact.push({ cate_name: cateName, cate_id: cateId, match_kind: "exact", match_score: 1.0 });
    } else if (lowerCate === lowerInput) {
      ciExact.push({ cate_name: cateName, cate_id: cateId, match_kind: "ci_exact", match_score: 0.95 });
    } else if (lowerInput.includes(lowerCate) && lowerCate.length >= 2) {
      inputContains.push({
        cate_name: cateName,
        cate_id: cateId,
        match_kind: "input_contains_cate",
        match_score: lowerCate.length / Math.max(lowerInput.length, 1),
      });
    } else if (lowerCate.includes(lowerInput) && lowerInput.length >= 2) {
      cateContains.push({
        cate_name: cateName,
        cate_id: cateId,
        match_kind: "cate_contains_input",
        match_score: lowerInput.length / Math.max(lowerCate.length, 1),
      });
    }
  }

  const ranked = [
    ...exact,
    ...ciExact,
    ...inputContains.sort((a, b) => b.match_score - a.match_score),
    ...cateContains.sort((a, b) => b.match_score - a.match_score),
  ];

  if (ranked.length === 0) {
    return {
      trace: {
        api_id: lookupApi,
        status: "miss",
        reason: `输入 "${input}" 在 ${rows.length} 条类目候选中未命中任何 cate_name`,
        candidates: [],
        total_returned: rows.length,
        elapsed_ms,
      },
    };
  }

  const winner = ranked[0]!;
  return {
    category_id: winner.cate_id,
    category_name: winner.cate_name,
    trace: {
      api_id: lookupApi,
      status: "matched",
      candidates: ranked.slice(0, 5),
      total_returned: rows.length,
      elapsed_ms,
    },
  };
}