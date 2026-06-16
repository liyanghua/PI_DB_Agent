// components.mjs
// 命名 schema 渲染器。所有渲染器都返回 HTML 字符串。
// 输入是 spec-pack 各 service 的 details 对象。
//
// 暴露：
//   detectKind(details, hint?)   → string
//   renderByKind(kind, details, ctx)
//   renderJsonTree(value, opts)
//   renderQaResult / renderToolPlan / renderApiAssetCard / renderLineageChain / renderListing

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// ─────────────────────────────────────────────
// kind detection
// ─────────────────────────────────────────────
export function detectKind(details, hint) {
  if (hint?.kind) return hint.kind;
  if (!details || typeof details !== "object") return "scalar";
  if (Array.isArray(details)) return "array";
  if (details.kind === "api_probe_result") return "api_probe_result";
  if (details.answer_type === "api_candidates" && Array.isArray(details.candidates)) return "qa_result";
  if (Array.isArray(details.recommended_tools) && Array.isArray(details.blocked_or_deprioritized)) return "tool_plan";
  if (typeof details.api_id === "string" && details.method && details.path) return "api_asset_card";
  if (details.root && typeof details.root === "object" && Array.isArray(details.steps)) return "lineage_chain";
  if (Array.isArray(details.apis) && typeof details.domain === "string") return "domain_apis";
  if (Array.isArray(details.issues) && typeof details.count === "number") return "quality_issues";
  if (Array.isArray(details.items) || Array.isArray(details.list) || Array.isArray(details.rows)) return "generic_list";
  return "object";
}

export function renderByKind(kind, details, ctx) {
  switch (kind) {
    case "qa_result":        return renderQaResult(details);
    case "tool_plan":        return renderToolPlan(details);
    case "api_asset_card":   return renderApiAssetCard(details);
    case "lineage_chain":    return renderLineageChain(details, ctx);
    case "domain_apis":      return renderDomainApis(details);
    case "quality_issues":   return renderQualityIssues(details);
    case "api_probe_result": return renderApiProbeResult(details);
    case "generic_list":     return renderGenericList(details);
    case "array":            return renderArrayAsTable(details);
    case "scalar":           return `<pre class="text-[11.5px] font-mono whitespace-pre-wrap text-zinc-800">${escapeHtml(String(details))}</pre>`;
    default:                 return renderJsonTree(details);
  }
}

// ─────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────
function statusBadge(s) {
  const map = {
    agent_ready: "badge-ok", verified: "badge-ok",
    candidate: "badge-info", draft: "badge-mute", raw: "badge-mute",
    deprecated: "badge-warn", blocked: "badge-err",
  };
  return `<span class="badge ${map[s] || "badge-mute"}">${escapeHtml(s ?? "-")}</span>`;
}
function severityBadge(s) {
  const map = { high: "badge-err", medium: "badge-warn", low: "badge-mute" };
  return `<span class="badge ${map[s] || "badge-mute"}">${escapeHtml(s ?? "-")}</span>`;
}
function methodBadge(m) {
  const map = { GET: "badge-info", POST: "badge-ok", PUT: "badge-warn", DELETE: "badge-err", PATCH: "badge-warn" };
  return `<span class="badge ${map[m] || "badge-mute"} mono">${escapeHtml(m || "?")}</span>`;
}
function qualityBar(q) {
  const v = Math.max(0, Math.min(1, Number(q) || 0));
  const pct = (v * 100).toFixed(0);
  const color = v >= 0.75 ? "#10b981" : v >= 0.5 ? "#f59e0b" : "#ef4444";
  return `<div class="inline-flex items-center gap-1.5"><span class="inline-block w-12 h-1.5 rounded-full bg-zinc-200 overflow-hidden align-middle"><span class="block h-full" style="width:${pct}%; background:${color}"></span></span><span class="font-mono text-[11px] text-zinc-600">${v.toFixed(2)}</span></div>`;
}
function chip(text, extraCls = "") {
  return `<span class="chip ${extraCls}">${escapeHtml(text)}</span>`;
}

// ─────────────────────────────────────────────
// QaResult
// ─────────────────────────────────────────────
export function renderQaResult(d) {
  const cands = d.candidates || [];
  const tools = d.recommended_tools || [];
  return `
    <div class="space-y-3">
      <div class="flex items-center gap-2 text-[12px] text-zinc-600">
        <span class="badge badge-info">QA · API 候选</span>
        <span class="text-zinc-500">${escapeHtml(d.notes || "")}</span>
      </div>
      ${cands.length ? `
      <div class="overflow-x-auto border border-zinc-200 rounded">
        <table class="data-table">
          <thead><tr>
            <th>#</th><th>method</th><th>path</th><th>name</th>
            <th>domain</th><th>status</th><th>quality</th><th>risks</th>
          </tr></thead>
          <tbody>
            ${cands.map((c, i) => `<tr>
              <td class="num">${i + 1}</td>
              <td>${methodBadge(c.method)}</td>
              <td class="mono"><span data-prompt-fill="${escapeHtml("api_id=" + c.api_id)}" class="cursor-pointer hover:text-iris-600" title="点击复制 api_id">${escapeHtml(c.path)}</span></td>
              <td>${escapeHtml(c.name)}</td>
              <td>${escapeHtml(c.domain)}</td>
              <td>${statusBadge(c.lifecycle_status)}</td>
              <td>${qualityBar(c.quality_score)}</td>
              <td class="text-[11px] text-zinc-600">${(c.risks || []).map((r) => chip(r, "badge-warn")).join(" ") || "<span class=\"text-zinc-400\">–</span>"}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>` : `<div class="text-zinc-400 text-[12px]">无候选</div>`}
      ${tools.length ? `
      <div>
        <div class="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">推荐工具</div>
        <div class="flex flex-wrap gap-1.5">
          ${tools.map((t) => `<button class="chip" data-prompt-tool="${escapeHtml(t.tool_id)}" title="${escapeHtml(t.reason)}">${escapeHtml(t.tool_name)}</button>`).join("")}
        </div>
      </div>` : ""}
    </div>`;
}

// ─────────────────────────────────────────────
// ToolPlan
// ─────────────────────────────────────────────
export function renderToolPlan(d) {
  const items = d.recommended_tools || [];
  const blocked = d.blocked_or_deprioritized || [];
  return `
    <div class="space-y-3">
      <div class="flex items-center gap-2 text-[12px] text-zinc-600">
        <span class="badge badge-info">ToolPlan</span>
        <span>intent: ${escapeHtml(d.intent || "-")}</span>
        <span class="ml-auto text-zinc-500">${escapeHtml(d.next_question || "")}</span>
      </div>
      ${items.length ? `
      <ol class="tool-plan space-y-2">
        ${items.map((it) => `
          <li class="border border-zinc-200 rounded bg-white p-2.5">
            <div class="flex items-center gap-2 mb-1.5">
              <span class="badge badge-info mono">#${it.call_order}</span>
              <span class="font-mono text-[12.5px] text-iris-600">${escapeHtml(it.tool_id)}</span>
              <span class="ml-auto">${qualityBar(it.quality_score)}</span>
            </div>
            <div class="text-[11.5px] text-zinc-600 mb-1.5">${escapeHtml(it.reason || "")}</div>
            <div class="grid grid-cols-2 gap-2 text-[11.5px]">
              <div>
                <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-0.5">required params</div>
                <div class="flex flex-wrap gap-1">${(it.required_params || []).map((p) => {
                  const missing = (it.missing_params || []).includes(p);
                  return `<span class="badge ${missing ? "badge-warn" : "badge-mute"} mono">${escapeHtml(p)}${missing ? " *" : ""}</span>`;
                }).join("") || "<span class=\"text-zinc-400\">–</span>"}</div>
              </div>
              <div>
                <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-0.5">source apis</div>
                <div class="space-y-0.5 font-mono text-[11px] text-zinc-700">${(it.source_apis || []).map((p) => `<div>${escapeHtml(p)}</div>`).join("") || "<span class=\"text-zinc-400\">–</span>"}</div>
              </div>
            </div>
            ${(it.risks || []).length ? `<div class="mt-1.5 flex flex-wrap gap-1">${it.risks.map((r) => `<span class="badge badge-warn">${escapeHtml(r)}</span>`).join("")}</div>` : ""}
          </li>`).join("")}
      </ol>` : `<div class="text-zinc-400 text-[12px]">未匹配到工具</div>`}
      ${blocked.length ? `
      <details class="rounded border border-zinc-200 bg-zinc-50">
        <summary class="px-3 py-1.5 text-[11.5px] text-zinc-600">blocked / deprioritized · ${blocked.length}</summary>
        <div class="px-3 py-2 space-y-1 text-[11.5px] font-mono">
          ${blocked.map((b) => `<div><span class="badge badge-err mr-1">${escapeHtml(b.ref)}</span><span class="text-zinc-600">${escapeHtml(b.reason || "")}</span></div>`).join("")}
        </div>
      </details>` : ""}
    </div>`;
}

// ─────────────────────────────────────────────
// ApiAssetCard
// ─────────────────────────────────────────────
export function renderApiAssetCard(c) {
  const fields = c.response_schema?.fields || [];
  const reqQ = c.request_schema?.query || [];
  const reqB = c.request_schema?.body || [];
  return `
    <div class="space-y-3">
      <div class="flex items-center gap-2 flex-wrap">
        ${methodBadge(c.method)}
        <span class="font-mono text-[13px] text-iris-600">${escapeHtml(c.path)}</span>
        ${statusBadge(c.lifecycle_status)}
        ${qualityBar(c.quality_score)}
      </div>
      <div class="text-[12.5px] text-zinc-700"><strong>${escapeHtml(c.name || "")}</strong></div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        <div class="text-zinc-500">api_id</div><div class="font-mono text-zinc-800">${escapeHtml(c.api_id)}</div>
        <div class="text-zinc-500">module</div><div class="text-zinc-800">${escapeHtml(c.module || "-")}</div>
        <div class="text-zinc-500">domain</div><div class="text-zinc-800">${escapeHtml(c.domain || "-")}</div>
        <div class="text-zinc-500">capability</div><div class="text-zinc-800">${escapeHtml(c.capability || "-")}</div>
      </div>
      ${(c.issues || []).length ? `
      <div>
        <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">issues</div>
        <div class="flex flex-wrap gap-1">${c.issues.map((i) => `<span class="badge ${({high:"badge-err",medium:"badge-warn",low:"badge-mute"})[i.severity] || "badge-mute"}">${escapeHtml(i.type)}</span>`).join("")}</div>
      </div>` : ""}
      ${reqQ.length || (Array.isArray(reqB) && reqB.length) ? `
      <div>
        <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">request</div>
        ${paramTable("query", reqQ)}
        ${Array.isArray(reqB) && reqB.length ? paramTable("body", reqB) : ""}
      </div>` : ""}
      ${fields.length ? `
      <div>
        <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">response fields · ${fields.length}</div>
        <div class="overflow-x-auto border border-zinc-200 rounded max-h-72 overflow-y-auto scroll-thin">
          <table class="data-table">
            <thead><tr><th>path</th><th>name</th><th>type</th><th>desc</th></tr></thead>
            <tbody>${fields.map((f) => `<tr>
              <td class="mono">${escapeHtml(f.path)}</td>
              <td>${escapeHtml(f.name || "")}</td>
              <td class="mono text-zinc-500">${escapeHtml(f.type || "")}</td>
              <td>${escapeHtml(f.desc || "")}</td>
            </tr>`).join("")}</tbody>
          </table>
        </div>
      </div>` : ""}
      ${c.response_schema?.example != null ? `
      <details class="rounded border border-zinc-200 bg-zinc-50">
        <summary class="px-3 py-1.5 text-[11.5px] text-zinc-600">response example</summary>
        <div class="px-3 py-2">${renderJsonTree(c.response_schema.example, { collapsed: true })}</div>
      </details>` : ""}
    </div>`;
}

function paramTable(label, rows) {
  if (!rows || !rows.length) return "";
  return `
    <div class="mt-1.5">
      <div class="text-[10.5px] text-zinc-500 mb-0.5">${escapeHtml(label)}</div>
      <div class="overflow-x-auto border border-zinc-200 rounded">
        <table class="data-table">
          <thead><tr><th>name</th><th>type</th><th>required</th><th>desc</th></tr></thead>
          <tbody>${rows.map((p) => `<tr>
            <td class="mono">${escapeHtml(p.name || "")}</td>
            <td class="mono text-zinc-500">${escapeHtml(p.type || "")}</td>
            <td>${p.required ? `<span class="badge badge-warn">required</span>` : `<span class="text-zinc-400">–</span>`}</td>
            <td>${escapeHtml(p.desc || "")}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────
// LineageChain
// ─────────────────────────────────────────────
export function renderLineageChain(d, ctx) {
  const root = d.root || {};
  const steps = d.steps || [];
  const grouped = new Map();
  for (const s of steps) {
    const key = s.via || "edge";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(s);
  }
  const renderText = ctx?.renderMarkdown ? ctx.renderMarkdown(d.text || "") : `<pre class="text-[11.5px] font-mono whitespace-pre-wrap text-zinc-800">${escapeHtml(d.text || "")}</pre>`;
  return `
    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <span class="badge badge-info">${escapeHtml(root.type || "Lineage")}</span>
        <span class="font-mono text-[12.5px] text-iris-600">${escapeHtml(root.id || "")}</span>
        <span class="text-[12.5px] text-zinc-700">${escapeHtml(root.label || "")}</span>
      </div>
      ${[...grouped.entries()].map(([via, list]) => `
        <div>
          <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">${escapeHtml(via)} · ${list.length}</div>
          <div class="flex flex-col gap-1">
            ${list.map((s) => `<div class="flex items-center gap-1.5 text-[11.5px] font-mono">
              <span class="text-zinc-700">${escapeHtml(s.from)}</span>
              <span class="text-zinc-400">→</span>
              <span class="text-iris-600">${escapeHtml(s.to)}</span>
            </div>`).join("")}
          </div>
        </div>`).join("")}
      <details class="rounded border border-zinc-200 bg-zinc-50">
        <summary class="px-3 py-1.5 text-[11.5px] text-zinc-600">narrative</summary>
        <div class="px-3 py-2 markdown">${renderText}</div>
      </details>
    </div>`;
}

// ─────────────────────────────────────────────
// ApiProbeResult
// ─────────────────────────────────────────────
export function renderApiProbeResult(d) {
  const status = d.status || {};
  const req = d.request || {};
  const resp = d.response;
  const missing = d.missing_required_params || [];
  const isBlocked = status.state === "blocked";
  const isOk = status.state === "ok";
  const stateBadge = (() => {
    if (status.state === "ok") return `<span class="badge badge-ok">ok ${status.http ?? ""}</span>`;
    if (status.state === "http_error") return `<span class="badge badge-err">http ${status.http ?? "?"}</span>`;
    if (status.state === "timeout") return `<span class="badge badge-err">timeout</span>`;
    if (status.state === "network_error") return `<span class="badge badge-err">network</span>`;
    if (status.state === "blocked") {
      const reasonMap = {
        live_probe_disabled: "LIVE_PROBE 未开启",
        env_missing: "ZICHEN_* 环境变量缺失",
        missing_params: "缺少必填参数",
        card_not_found: "api_id 不存在",
      };
      return `<span class="badge badge-warn">blocked · ${escapeHtml(reasonMap[status.reason] || status.reason)}</span>`;
    }
    return `<span class="badge badge-mute">${escapeHtml(status.state || "?")}</span>`;
  })();

  const headerRow = `
    <div class="flex items-center gap-2 flex-wrap">
      ${methodBadge(d.method)}
      <span class="font-mono text-[12.5px] text-iris-600">${escapeHtml(d.path)}</span>
      ${stateBadge}
      ${typeof status.elapsed_ms === "number" ? `<span class="badge badge-mute mono">${status.elapsed_ms}ms</span>` : ""}
      <span class="ml-auto text-[11px] text-zinc-500 font-mono">${escapeHtml(d.api_id)}</span>
    </div>`;

  const blockedHint = isBlocked && status.reason === "missing_params" && missing.length ? `
    <div class="border border-amber-200 bg-amber-50 rounded p-2 text-[12px] text-amber-800 space-y-1">
      <div class="font-medium">缺少必填参数 · ${missing.length}</div>
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead><tr><th>name</th><th>position</th><th>desc</th></tr></thead>
          <tbody>${missing.map((p) => `<tr>
            <td class="mono">${escapeHtml(p.name)}</td>
            <td class="mono text-zinc-500">${escapeHtml(p.position || "query")}</td>
            <td>${escapeHtml(p.desc || "")}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </div>` : "";

  const blockedEnv = isBlocked && status.reason === "env_missing" ? `
    <div class="border border-amber-200 bg-amber-50 rounded p-2 text-[12px] text-amber-800">
      .env 缺：${(status.details?.missing || []).map((k) => `<span class="badge badge-warn mono mr-0.5">${escapeHtml(k)}</span>`).join(" ")}
    </div>` : "";

  const blockedLive = isBlocked && status.reason === "live_probe_disabled" ? `
    <div class="border border-amber-200 bg-amber-50 rounded p-2 text-[12px] text-amber-800">
      已拼装请求但未发起。设置 <span class="font-mono">LIVE_PROBE=true</span> 后重试。
    </div>` : "";

  const errorBlock = (status.state === "http_error" || status.state === "network_error" || status.state === "timeout") && status.error ? `
    <div class="border border-rose-200 bg-rose-50 rounded p-2 text-[12px] text-rose-800 whitespace-pre-wrap break-words font-mono">${escapeHtml(status.error)}</div>` : "";

  const requestSection = req.url ? `
    <details class="rounded border border-zinc-200 bg-zinc-50" ${isOk ? "" : "open"}>
      <summary class="px-3 py-1.5 text-[11.5px] text-zinc-600">request</summary>
      <div class="px-3 py-2 space-y-2 text-[11.5px]">
        <div>
          <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-0.5">url</div>
          <div class="font-mono break-all text-zinc-800">${escapeHtml(req.url)}</div>
        </div>
        ${Object.keys(req.query || {}).length ? `
        <div>
          <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-0.5">query</div>
          <table class="data-table"><thead><tr><th>name</th><th>value</th><th>auth</th></tr></thead><tbody>
            ${Object.entries(req.query).map(([k, v]) => `<tr>
              <td class="mono">${escapeHtml(k)}</td>
              <td class="mono">${escapeHtml(formatScalar(v))}</td>
              <td>${(req.auth_inject?.query || []).includes(k) ? `<span class="badge badge-info">env</span>` : `<span class="text-zinc-400">–</span>`}</td>
            </tr>`).join("")}
          </tbody></table>
        </div>` : ""}
        ${req.body && typeof req.body === "object" ? `
        <div>
          <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-0.5">body${(req.auth_inject?.body || []).length ? ` · env: ${(req.auth_inject.body).map((x) => escapeHtml(x)).join(", ")}` : ""}</div>
          ${renderJsonTree(req.body, { collapsed: false })}
        </div>` : ""}
        <div>
          <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-0.5">headers (values redacted)</div>
          <div class="flex flex-wrap gap-1">${(req.headers_keys || []).map((k) => `<span class="badge ${(req.auth_inject?.header || []).includes(k) ? "badge-info" : "badge-mute"} mono">${escapeHtml(k)} = ***</span>`).join("")}</div>
        </div>
      </div>
    </details>` : "";

  const responseSection = resp ? `
    <div>
      <div class="flex items-center gap-2 mb-1 text-[12px] text-zinc-700">
        <span class="badge badge-info">response</span>
        <span class="font-mono text-zinc-500">root: ${escapeHtml(resp.root)}</span>
        <span class="ml-auto text-zinc-500">total ${escapeHtml(String(resp.total))} · 显示 ${escapeHtml(String((resp.top || []).length))}${resp.truncated ? " (truncated)" : ""}</span>
      </div>
      ${(resp.top || []).length
        ? renderArrayAsTable(resp.top)
        : `<div class="text-zinc-400 text-[12px]">(empty)</div>`}
    </div>` : "";

  return `<div class="space-y-3">
    ${headerRow}
    ${blockedHint}
    ${blockedEnv}
    ${blockedLive}
    ${errorBlock}
    ${requestSection}
    ${responseSection}
  </div>`;
}

// ─────────────────────────────────────────────
// list_domain_apis / list_api_quality_issues
// ─────────────────────────────────────────────
export function renderDomainApis(d) {
  const apis = d.apis || [];
  return `
    <div class="space-y-2">
      <div class="flex items-center gap-2 text-[12px] text-zinc-600">
        <span class="badge badge-info">domain</span>
        <span class="font-mono">${escapeHtml(d.domain)}</span>
        <span class="ml-auto text-zinc-500">${escapeHtml(String(d.count ?? apis.length))} 条</span>
      </div>
      <div class="overflow-x-auto border border-zinc-200 rounded max-h-96 overflow-y-auto scroll-thin">
        <table class="data-table">
          <thead><tr><th>method</th><th>path</th><th>name</th><th>capability</th><th>status</th><th>quality</th><th>issues</th></tr></thead>
          <tbody>${apis.map((a) => `<tr>
            <td>${methodBadge(a.method)}</td>
            <td class="mono">${escapeHtml(a.path)}</td>
            <td>${escapeHtml(a.name || "")}</td>
            <td>${escapeHtml(a.capability || "-")}</td>
            <td>${statusBadge(a.lifecycle_status)}</td>
            <td>${qualityBar(a.quality_score)}</td>
            <td class="text-[11px]">${(a.issues || []).map((i) => `<span class="badge badge-warn mr-0.5">${escapeHtml(i)}</span>`).join("") || "<span class=\"text-zinc-400\">–</span>"}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </div>`;
}

export function renderQualityIssues(d) {
  const issues = d.issues || [];
  const blocked = d.blocked_apis || [];
  return `
    <div class="space-y-3">
      <div class="flex items-center gap-2 text-[12px] text-zinc-600">
        <span class="badge badge-warn">quality issues</span>
        <span class="ml-auto text-zinc-500">${escapeHtml(String(d.count ?? issues.length))} 条</span>
      </div>
      <div class="overflow-x-auto border border-zinc-200 rounded max-h-96 overflow-y-auto scroll-thin">
        <table class="data-table">
          <thead><tr><th>severity</th><th>issue</th><th>method</th><th>path</th><th>domain</th><th>status</th><th>message</th></tr></thead>
          <tbody>${issues.map((i) => `<tr>
            <td>${severityBadge(i.severity)}</td>
            <td class="mono">${escapeHtml(i.issue_type)}</td>
            <td>${methodBadge(i.method)}</td>
            <td class="mono">${escapeHtml(i.path)}</td>
            <td>${escapeHtml(i.domain || "-")}</td>
            <td>${statusBadge(i.lifecycle_status)}</td>
            <td>${escapeHtml(i.message || "")}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
      ${blocked.length ? `
      <details class="rounded border border-zinc-200 bg-zinc-50">
        <summary class="px-3 py-1.5 text-[11.5px] text-zinc-600">blocked apis · ${blocked.length}</summary>
        <div class="px-3 py-2 space-y-0.5 text-[11.5px] font-mono">
          ${blocked.map((b) => `<div><span class="badge badge-err mr-1">${escapeHtml(b.api_id || b.path || "")}</span><span class="text-zinc-600">${escapeHtml((b.reasons || []).join("|"))}</span></div>`).join("")}
        </div>
      </details>` : ""}
    </div>`;
}

// ─────────────────────────────────────────────
// generic list / array
// ─────────────────────────────────────────────
export function renderGenericList(d) {
  const arr = d.items || d.list || d.rows || [];
  const meta = Object.keys(d).filter((k) => !["items", "list", "rows"].includes(k));
  return `
    <div class="space-y-2">
      ${meta.length ? `<div class="flex flex-wrap gap-1.5 text-[11.5px]">${meta.map((k) => `<span class="badge badge-mute">${escapeHtml(k)}: ${escapeHtml(formatScalar(d[k]))}</span>`).join("")}</div>` : ""}
      ${renderArrayAsTable(arr)}
    </div>`;
}

export function renderArrayAsTable(arr) {
  if (!arr || !arr.length) return `<div class="text-zinc-400 text-[12px]">(empty)</div>`;
  if (arr.every((x) => x == null || typeof x !== "object")) {
    return `<ul class="list-disc pl-5 text-[12.5px] space-y-0.5">${arr.map((x) => `<li>${escapeHtml(formatScalar(x))}</li>`).join("")}</ul>`;
  }
  const cols = collectColumns(arr).slice(0, 12);
  return `
    <div class="overflow-x-auto border border-zinc-200 rounded max-h-96 overflow-y-auto scroll-thin">
      <table class="data-table">
        <thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>
        <tbody>${arr.map((row) => `<tr>${cols.map((c) => `<td>${cellRender(c, row?.[c])}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function collectColumns(arr) {
  const seen = new Set();
  const order = [];
  for (const row of arr) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      for (const k of Object.keys(row)) if (!seen.has(k)) { seen.add(k); order.push(k); }
    }
  }
  return order;
}

function cellRender(col, v) {
  if (v == null) return `<span class="text-zinc-400">–</span>`;
  if (typeof v === "object") return `<span class="text-zinc-500 text-[11px]">${escapeHtml(JSON.stringify(v).slice(0, 80))}${JSON.stringify(v).length > 80 ? "…" : ""}</span>`;
  if (col === "severity") return severityBadge(v);
  if (col === "lifecycle_status" || col === "status") return statusBadge(v);
  if (col === "method") return methodBadge(v);
  if (col === "quality_score") return qualityBar(v);
  if (typeof v === "number") return `<span class="num">${formatScalar(v)}</span>`;
  return escapeHtml(formatScalar(v));
}

function formatScalar(v) {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

// ─────────────────────────────────────────────
// JSON tree (collapsible)
// ─────────────────────────────────────────────
export function renderJsonTree(value, opts = {}) {
  const collapsed = opts.collapsed === true;
  return `<div class="json-tree">${jsonNode(value, "", collapsed, 0)}</div>`;
}

function jsonNode(v, key, collapsed, depth) {
  const keyHtml = key !== "" ? `<span class="k">${escapeHtml(key)}</span>: ` : "";
  if (v === null) return `<div>${keyHtml}<span class="nu">null</span></div>`;
  if (typeof v === "string") return `<div>${keyHtml}<span class="s">"${escapeHtml(v)}"</span></div>`;
  if (typeof v === "number") return `<div>${keyHtml}<span class="n">${escapeHtml(String(v))}</span></div>`;
  if (typeof v === "boolean") return `<div>${keyHtml}<span class="b">${v}</span></div>`;
  if (Array.isArray(v)) {
    if (!v.length) return `<div>${keyHtml}<span class="nu">[]</span></div>`;
    const open = !collapsed && depth < 2 ? " open" : "";
    return `<details${open}><summary>${keyHtml}<span class="nu">[${v.length}]</span></summary>${v.map((x, i) => jsonNode(x, String(i), collapsed, depth + 1)).join("")}</details>`;
  }
  const entries = Object.entries(v);
  if (!entries.length) return `<div>${keyHtml}<span class="nu">{}</span></div>`;
  const open = !collapsed && depth < 2 ? " open" : "";
  return `<details${open}><summary>${keyHtml}<span class="nu">{${entries.length}}</span></summary>${entries.map(([k, val]) => jsonNode(val, k, collapsed, depth + 1)).join("")}</details>`;
}