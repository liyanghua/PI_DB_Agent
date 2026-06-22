import type {
  KeywordFieldMapping,
  KeywordSourceAudit,
  KeywordSourceAuditRow,
  PullReportSummary,
} from "./types.js";

const STATUS_CN: Record<string, string> = {
  ok: "有可用关键词数据",
  empty: "返回 0 行",
  business_empty: "请求成功但无业务数据",
  business_failed: "业务失败",
  data_root_null: "data 为空或缺失",
  root_path_mismatch: "响应路径不匹配",
  keyword_field_missing: "有响应行但缺关键词字段",
  context_mismatch: "返回类目/时间不匹配",
  skipped_missing_category_id: "跳过：缺 category_id",
  missing_required_params: "跳过：缺必填参数",
  not_registered: "跳过：接口未登记",
  live_disabled: "跳过：LIVE_PROBE 未开启",
  env_missing: "跳过：环境变量缺失",
  http_error: "HTTP 错误",
  network_error: "网络错误",
  timeout: "超时",
  unexpected_payload: "响应结构不识别",
  disabled_by_config: "跳过：mapping.enabled=false",
};

export function buildSourceAudit(
  pullReport: PullReportSummary | undefined,
  fieldMapping: KeywordFieldMapping,
): KeywordSourceAudit | undefined {
  if (!pullReport) return undefined;

  const apiOrder = fieldMapping.merge_order_priority?.length
    ? fieldMapping.merge_order_priority
    : Object.keys(fieldMapping.apis);

  // demand source_audit 仅审视 demand/trend/multi 域接口；competition / paid_value 域接口归 CPS / PVS capability。
  const auditableApiIds = apiOrder.filter((apiId) => {
    const hint = fieldMapping.apis[apiId]?.score_domain_hint;
    return hint !== "competition" && hint !== "paid_value";
  });

  const candidateApis: KeywordSourceAuditRow[] = auditableApiIds.map((apiId) => {
    const cfg = fieldMapping.apis[apiId];
    const st = pullReport.per_api[apiId] ?? { status: "not_registered" };
    const shaped = pullReport.shape?.[apiId];
    const rawRows = typeof st.total === "number" ? st.total : 0;
    const hasUsable = st.status === "ok" && rawRows > 0;
    const hasRows = rawRows > 0 || (typeof shaped?.count === "number" && shaped.count > 0);
    const reason = firstNonEmpty(st.hint, st.note, st.error, shaped?.note);

    return {
      api_id: apiId,
      method: cfg?.method,
      path: cfg?.path,
      priority: cfg?.priority,
      status: st.status,
      status_cn: STATUS_CN[st.status] ?? st.status,
      has_usable_keyword_data: hasUsable,
      has_response_rows: hasRows,
      raw_rows: rawRows,
      shaped_rows: shaped?.count,
      http: st.http,
      elapsed_ms: st.elapsed_ms,
      reason,
      note: shaped?.note,
      keyword_field: cfg?.keyword_field,
      response_root: cfg?.response_root,
    };
  });

  const usable = candidateApis.filter((x) => x.has_usable_keyword_data);
  const noUsable = candidateApis.filter((x) => !x.has_usable_keyword_data);

  return {
    kind: "keyword_source_audit",
    total_candidates: candidateApis.length,
    usable_apis: usable.length,
    no_usable_data_apis: noUsable.length,
    total_keywords: pullReport.total_keywords,
    usable_api_ids: usable.map((x) => x.api_id),
    no_usable_data_api_ids: noUsable.map((x) => x.api_id),
    candidate_apis: candidateApis,
  };
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return undefined;
}
