// main.mjs — entry point
import { state, subscribe, applyBridgeEvent, pushUserMessage, setSessionState, setRegistry, applySessionStats, clearExtPending, setStreaming, setConnectionStatus, setDocViewTurn, closeDocView, setFollowBottom, setInspectorTab, setRawFilter } from "./store.mjs";
import { renderMarkdown, renderDetails, escapeHtml as esc } from "./render.mjs";

// ─────────────────────────────────────────────
// SSE client with auto-reconnect
// ─────────────────────────────────────────────
let es = null;
let backoffMs = 500;

function connectSse() {
  es?.close();
  es = new EventSource("/api/stream");
  const handler = (kind) => (msg) => {
    let data = null;
    try { data = JSON.parse(msg.data); } catch { data = { _raw: msg.data }; }
    applyBridgeEvent({ kind, ...data });
  };
  for (const k of ["hello", "ready", "exit", "stderr", "rpc_response", "ext_ui_request", "agent_event"]) {
    es.addEventListener(k, handler(k));
  }
  es.addEventListener("heartbeat", () => {});
  es.onopen = () => { backoffMs = 500; };
  es.onerror = () => {
    setConnectionStatus("connecting", { error: "sse disconnected" });
    es.close();
    setTimeout(connectSse, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 8000);
  };
}

// ─────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────
async function api(p, body) {
  const r = await fetch(p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  if (!r.ok) throw Object.assign(new Error(json.error || `http ${r.status}`), { json });
  return json;
}
async function getJson(p) {
  const r = await fetch(p);
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.json();
}

// ─────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const conv = $("#conversation");
const inspector = $("#inspector");
const composer = $("#composer");
const sendBtn = $("#sendBtn");
const abortBtn = $("#abortBtn");
const newSessionBtn = $("#newSessionBtn");
const palette = $("#palette");
const paletteInput = $("#paletteInput");
const paletteList = $("#paletteList");
const extModal = $("#extModal");
const modelChip = $("#modelChip");
const thinkingChip = $("#thinkingChip");
const docView = $("#docView");
const docOutline = $("#docOutline");
const docContent = $("#docContent");
const docTitle = $("#docTitle");
const docCloseBtn = $("#docCloseBtn");
const docCopyBtn = $("#docCopyBtn");
const scrollBottomBtn = $("#scrollBottomBtn");

// ─────────────────────────────────────────────
// Light palette tokens (centralized)
// ─────────────────────────────────────────────
const C = {
  card: "bg-white border border-zinc-200 card-shadow",
  panel: "bg-white border border-zinc-200",
  subPanel: "bg-zinc-50 border border-zinc-200",
  hover: "hover:bg-zinc-100",
  divider: "border-zinc-200",
  textMain: "text-zinc-900",
  textSoft: "text-zinc-600",
  textMute: "text-zinc-500",
  textHint: "text-zinc-400",
  pre: "bg-zinc-50 border border-zinc-200 text-zinc-800",
};

// ─────────────────────────────────────────────
// Quick chips
// ─────────────────────────────────────────────
document.querySelectorAll("[data-quick]").forEach((el) => {
  el.addEventListener("click", () => {
    const prefix = el.getAttribute("data-prefix") || "";
    composer.value = prefix + composer.value;
    composer.focus();
  });
});

// ─────────────────────────────────────────────
// Composer
// ─────────────────────────────────────────────
async function sendPrompt(messageOverride) {
  const message = messageOverride ?? composer.value.trim();
  if (!message) return;
  if (!messageOverride) composer.value = "";
  pushUserMessage(message);
  setStreaming(true);
  try {
    await api("/api/prompt", { message });
  } catch (err) {
    setStreaming(false);
    appendErrorTurn(err.message || String(err));
  }
}
function appendErrorTurn(msg) {
  state.turns.push({ id: `e_${Date.now()}`, kind: "assistant", parts: [{ kind: "text", text: `❌ ${msg}` }], status: "error", t0: Date.now(), t1: Date.now() });
  renderAll();
}
sendBtn.addEventListener("click", () => sendPrompt());
composer.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
});
abortBtn.addEventListener("click", async () => {
  try { await api("/api/abort"); } catch (err) { console.warn(err); }
});
newSessionBtn.addEventListener("click", async () => {
  try {
    await api("/api/new_session");
    state.turns.length = 0;
    state.toolsById.clear();
    state.toolsOrder.length = 0;
    state.metrics = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, toolCalls: 0 };
    renderAll();
    refreshState();
  } catch (err) { console.warn(err); }
});

// ─────────────────────────────────────────────
// Command palette
// ─────────────────────────────────────────────
const PALETTE_ACTIONS = [
  { id: "ask", label: "🔍 ask_api_catalog · 商品诊断有哪些接口？", run: () => sendPrompt("商品诊断有哪些接口？请用 ask_api_catalog 工具找候选并给出调用顺序。") },
  { id: "select", label: "🛠 select_tools_for_task · 选 top3 工具", run: () => sendPrompt("帮我做蓝海词挖掘，先用 select_tools_for_task 给出 top3 工具链与参数缺口。") },
  { id: "domain", label: "📂 list_domain_apis · 商品域", run: () => sendPrompt("用 list_domain_apis 列出 商品域 下 agent_ready 的接口（按 quality_score 排）。") },
  { id: "quality", label: "🚧 list_api_quality_issues · severity=high", run: () => sendPrompt("用 list_api_quality_issues 列出 severity=high 的质量问题，限 50 条。") },
  { id: "lineage", label: "🔗 explain_tool_lineage · 商品销量诊断", run: () => sendPrompt("用 explain_tool_lineage 解释 商品销量诊断 这条 metric 的链路。") },
  { id: "card", label: "🪪 get_api_asset_card · 输入 api_id", run: () => { composer.value = "get_api_asset_card api_id="; composer.focus(); } },
  { id: "clear", label: "/clear · 开新会话", run: () => newSessionBtn.click() },
  { id: "export", label: "/export · 导出 HTML", run: async () => { try { const r = await api("/api/prompt", { message: "/export" }); console.log(r); } catch (e) { console.warn(e); } } },
];
function openPalette() {
  palette.classList.remove("hidden");
  palette.classList.add("flex");
  paletteInput.value = "";
  renderPalette("");
  paletteInput.focus();
}
function closePalette() { palette.classList.add("hidden"); palette.classList.remove("flex"); }
function renderPalette(q) {
  const ql = q.toLowerCase();
  const list = PALETTE_ACTIONS.filter((a) => a.label.toLowerCase().includes(ql));
  paletteList.innerHTML = list.map((a, i) => `<button data-i="${i}" class="w-full text-left px-4 py-2.5 hover:bg-zinc-100 text-[13px] text-zinc-800 border-b border-zinc-200 last:border-0">${a.label}</button>`).join("");
  paletteList.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => { list[+btn.dataset.i].run(); closePalette(); });
  });
}
paletteInput.addEventListener("input", () => renderPalette(paletteInput.value));
paletteInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePalette();
  if (e.key === "Enter") { paletteList.querySelector("button")?.click(); }
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    palette.classList.contains("hidden") ? openPalette() : closePalette();
  }
});
palette.addEventListener("click", (e) => { if (e.target === palette) closePalette(); });

// ─────────────────────────────────────────────
// Model / thinking pickers
// ─────────────────────────────────────────────
modelChip.addEventListener("click", async () => {
  try {
    const r = await api("/api/get_available_models");
    const models = r.data?.models || [];
    if (!models.length) return alert("no models");
    openPickerModal("选择 model", models.map((m) => ({
      label: `${m.provider}/${m.id}  ·  ctx ${m.contextWindow ?? "?"}`,
      onPick: async () => { await api("/api/set_model", { provider: m.provider, modelId: m.id }); refreshState(); },
    })));
  } catch (err) { alert(err.message); }
});
thinkingChip.addEventListener("click", () => {
  openPickerModal("Thinking level", ["off", "minimal", "low", "medium", "high"].map((lv) => ({
    label: lv,
    onPick: async () => { await api("/api/set_thinking", { level: lv }); refreshState(); },
  })));
});
function openPickerModal(title, options) {
  extModal.classList.remove("hidden");
  extModal.innerHTML = `
    <div class="w-[420px] bg-white border border-zinc-200 card-shadow rounded-lg overflow-hidden">
      <div class="px-4 py-2.5 border-b border-zinc-200 text-[13px] text-zinc-700 font-medium">${escapeHtml(title)}</div>
      <div class="max-h-80 overflow-y-auto scroll-thin">
        ${options.map((o, i) => `<button data-i="${i}" class="w-full text-left px-4 py-2.5 hover:bg-zinc-100 text-[13px] text-zinc-800 border-b border-zinc-200 last:border-0">${escapeHtml(o.label)}</button>`).join("")}
      </div>
      <div class="px-4 py-2 text-right border-t border-zinc-200"><button class="chip" id="pmCancel">取消</button></div>
    </div>`;
  extModal.querySelectorAll("button[data-i]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = +btn.dataset.i;
      extModal.classList.add("hidden");
      try { await options[i].onPick(); } catch (err) { alert(err.message); }
    });
  });
  $("#pmCancel").addEventListener("click", () => extModal.classList.add("hidden"));
}

// ─────────────────────────────────────────────
// Extension UI request handling
// ─────────────────────────────────────────────
function renderExtModal(req) {
  if (!req) { extModal.classList.add("hidden"); extModal.innerHTML = ""; return; }
  const id = req.id;
  const close = async (payload) => {
    await fetch("/api/ext_ui_response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...payload }),
    }).catch(() => {});
    clearExtPending();
  };
  extModal.classList.remove("hidden");
  let body = "";
  if (req.method === "select") {
    body = `
      <div class="px-4 py-2.5 border-b border-zinc-200 text-[13px] text-zinc-700 font-medium">${escapeHtml(req.title)}</div>
      <div class="max-h-80 overflow-y-auto scroll-thin">
        ${(req.options || []).map((o, i) => `<button data-i="${i}" class="w-full text-left px-4 py-2.5 hover:bg-zinc-100 text-[13px] text-zinc-800 border-b border-zinc-200 last:border-0">${escapeHtml(o)}</button>`).join("")}
      </div>
      <div class="px-4 py-2 text-right border-t border-zinc-200"><button class="chip" id="extCancel">取消</button></div>`;
  } else if (req.method === "confirm") {
    body = `
      <div class="px-4 py-3 border-b border-zinc-200 text-[13px] text-zinc-800 font-medium">${escapeHtml(req.title)}</div>
      <div class="px-4 py-3 text-[12.5px] text-zinc-600">${escapeHtml(req.message || "")}</div>
      <div class="px-4 py-2 flex gap-2 justify-end border-t border-zinc-200"><button class="chip" id="extNo">否</button><button class="chip bg-iris-500 text-white border-iris-500" id="extYes">是</button></div>`;
  } else if (req.method === "input" || req.method === "editor") {
    body = `
      <div class="px-4 py-2.5 border-b border-zinc-200 text-[13px] text-zinc-800 font-medium">${escapeHtml(req.title)}</div>
      <textarea id="extText" rows="${req.method === "editor" ? 8 : 2}" class="w-full bg-white outline-none px-4 py-3 text-[13px] resize-none text-zinc-900" placeholder="${escapeHtml(req.placeholder || "")}">${escapeHtml(req.prefill || "")}</textarea>
      <div class="px-4 py-2 flex gap-2 justify-end border-t border-zinc-200"><button class="chip" id="extCancel">取消</button><button class="chip bg-iris-500 text-white border-iris-500" id="extOk">确定</button></div>`;
  } else {
    close({ value: "" });
    return;
  }
  extModal.innerHTML = `<div class="w-[460px] bg-white border border-zinc-200 card-shadow rounded-lg overflow-hidden">${body}</div>`;
  if (req.method === "select") {
    extModal.querySelectorAll("button[data-i]").forEach((btn) => btn.addEventListener("click", () => close({ value: req.options[+btn.dataset.i] })));
    $("#extCancel").addEventListener("click", () => close({ cancelled: true }));
  } else if (req.method === "confirm") {
    $("#extYes").addEventListener("click", () => close({ confirmed: true }));
    $("#extNo").addEventListener("click", () => close({ confirmed: false }));
  } else {
    $("#extOk").addEventListener("click", () => close({ value: $("#extText").value }));
    $("#extCancel").addEventListener("click", () => close({ cancelled: true }));
  }
}

// ─────────────────────────────────────────────
// Render helpers
// ─────────────────────────────────────────────
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmtMs(ms) { if (ms == null || isNaN(ms)) return "–"; if (ms < 1000) return `${ms}ms`; return `${(ms/1000).toFixed(2)}s`; }
function fmtNum(n) { return n == null ? "–" : Number(n).toLocaleString("en-US"); }
function fmtCost(n) { return n == null ? "–" : `$${Number(n).toFixed(4)}`; }

function renderTopbar(s) {
  $("#modelLabel").textContent = "model: " + (s.connection.model || "未选");
  $("#thinkingLabel").textContent = "thinking: " + (s.connection.thinking || "medium");
  const dot = $("#connDot");
  const summary = $("#connSummary");
  dot.className = "dot " + ({ ready: "dot-ok", connecting: "dot-pending", error: "dot-err", exited: "dot-err" }[s.connection.status] || "dot-pending");
  summary.textContent = s.connection.status === "ready"
    ? `pi · pid ${s.connection.pid ?? "?"}`
    : `${s.connection.status}${s.connection.error ? " · " + s.connection.error : ""}`;
  $("#cwdLabel").textContent = (s.connection.cwd || "").split("/").slice(-2).join("/");
  $("#pidLabel").textContent = s.connection.pid ?? "–";
  abortBtn.classList.toggle("hidden", !s.streaming);
}

function renderConversation(s) {
  if (!s.turns.length) {
    conv.innerHTML = `<div class="h-full flex items-center justify-center text-zinc-400 text-[13px] flex-col gap-3">
      <div class="font-mono text-[12px] tracking-wide text-zinc-400">DB ARCHAEOLOGIST · ready</div>
      <div class="text-zinc-500 text-[12.5px]">问点什么，或按 <span class="kbd">⌘K</span> 打开命令面板</div>
      <div class="flex gap-2 mt-2">
        <button class="chip" data-prompt="商品诊断有哪些接口？">商品诊断有哪些接口？</button>
        <button class="chip" data-prompt="蓝海词挖掘需要哪些工具？">蓝海词挖掘需要哪些工具？</button>
        <button class="chip" data-prompt="列出 商品域 下 agent_ready 的 API。">列出 agent_ready 接口</button>
      </div>
    </div>`;
    conv.querySelectorAll("button[data-prompt]").forEach((b) => b.addEventListener("click", () => sendPrompt(b.dataset.prompt)));
    scrollBottomBtn?.classList.add("hidden");
    return;
  }
  conv.innerHTML = s.turns.map(renderTurn).join("");
  bindToolToggles();
  bindToolActions();
  bindTurnActions();
  if (s.followBottom) conv.scrollTop = conv.scrollHeight;
  updateScrollBottomBtn();
}

function updateScrollBottomBtn() {
  if (!scrollBottomBtn) return;
  scrollBottomBtn.classList.toggle("hidden", !!state.followBottom || !state.turns.length);
}

function renderTurn(t) {
  if (t.kind === "user") {
    return `<div class="flex"><div class="ml-auto max-w-[78%] bg-iris-500/10 border border-iris-500/30 rounded-lg px-3 py-2 text-[13.5px] text-zinc-900 whitespace-pre-wrap leading-relaxed">${escapeHtml(t.text)}</div></div>`;
  }
  const elapsed = t.t1 ? fmtMs(t.t1 - t.t0) : "running";
  const status = t.status === "running" ? `<span class="dot dot-running"></span><span class="text-amber-600">streaming</span>` :
                 t.status === "error"   ? `<span class="dot dot-err"></span><span class="text-rose-600">error</span>` :
                                          `<span class="dot dot-ok"></span><span class="text-emerald-600">done</span>`;
  const parts = (t.parts || []).map((p) => renderPart(p, t)).join("");
  return `
    <div class="border border-zinc-200 rounded-lg bg-white card-shadow" data-turn-id="${t.id}">
      <div class="px-3 py-2 border-b border-zinc-200 flex items-center gap-2 text-[11.5px] text-zinc-500">
        <span class="font-mono text-zinc-700">assistant</span>
        ${status}
        <span class="ml-auto">${elapsed}</span>
        <button class="chip" data-doc-open="${t.id}" title="Open as document (⌘.)">📄 文档</button>
      </div>
      <div class="px-3 py-3 space-y-2">${parts || `<div class="text-zinc-400 text-[12.5px]">…</div>`}</div>
      ${t.error ? `<div class="px-3 py-2 border-t border-rose-200 bg-rose-50 text-[12px] text-rose-700">${escapeHtml(t.error)}</div>` : ""}
    </div>`;
}

function renderPart(p, turn) {
  if (p.kind === "thinking") {
    return `
      <details class="rounded border border-zinc-200 bg-zinc-50">
        <summary class="px-3 py-1.5 text-[11.5px] text-zinc-600 flex items-center gap-2"><span>🧠 thinking</span><span class="text-zinc-400">${escapeHtml((p.text || "").length + " chars")}</span></summary>
        <pre class="px-3 py-2 text-[12px] text-zinc-700 whitespace-pre-wrap font-mono">${escapeHtml(p.text || "")}</pre>
      </details>`;
  }
  if (p.kind === "tool") {
    const tool = state.toolsById.get(p.toolCallId);
    if (!tool) return "";
    return renderToolCard(tool);
  }
  const isStreaming = turn.status === "running" && !p.done;
  const html = renderMarkdown(p.text || "");
  return `<div class="markdown ${isStreaming ? "blink" : ""}">${html}</div>`;
}

function renderToolCard(tool) {
  const dotClass = tool.status === "ok" ? "dot-ok" : tool.status === "error" ? "dot-err" : "dot-running";
  const elapsed = tool.t1 ? fmtMs(tool.t1 - tool.t0) : "running";
  const args = safeStringify(tool.args);
  const details = tool.details ?? extractResult(tool.result);
  const detailsHtml = renderDetails(details, tool.isError ? { kind: "object" } : undefined);
  return `
    <div class="rounded border border-zinc-200 bg-zinc-50">
      <button data-toggle="${tool.id}" class="w-full px-3 py-2 flex items-center gap-2 text-left text-[12px] hover:bg-zinc-100 rounded">
        <span class="dot ${dotClass}"></span>
        <span class="font-mono text-iris-600">${escapeHtml(tool.name)}</span>
        <span class="text-zinc-500 truncate flex-1">${escapeHtml(summarizeArgs(tool.args))}</span>
        <span class="text-zinc-500">${elapsed}</span>
      </button>
      <div data-tool-body="${tool.id}" class="hidden border-t border-zinc-200 px-3 py-2 space-y-2">
        <details class="rounded bg-white border border-zinc-200">
          <summary class="px-2 py-1 text-[10.5px] uppercase tracking-wider text-zinc-500">input</summary>
          <pre class="text-[11.5px] font-mono text-zinc-800 px-2 py-2 overflow-x-auto whitespace-pre">${escapeHtml(args)}</pre>
        </details>
        <div>
          <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1 flex items-center gap-2">
            <span>output</span>
            ${tool.isError ? `<span class="badge badge-err">error</span>` : ""}
          </div>
          <div class="bg-white border border-zinc-200 rounded p-2 ${tool.isError ? "text-rose-700" : ""}">${detailsHtml}</div>
        </div>
      </div>
    </div>`;
}
function bindToolActions() {
  conv.querySelectorAll("[data-prompt-fill]").forEach((el) => {
    el.addEventListener("click", () => {
      const v = el.getAttribute("data-prompt-fill") || "";
      composer.value = (composer.value ? composer.value + " " : "") + v;
      composer.focus();
    });
  });
  conv.querySelectorAll("[data-prompt-tool]").forEach((el) => {
    el.addEventListener("click", () => {
      const v = el.getAttribute("data-prompt-tool") || "";
      composer.value = `请用 ${v} 工具继续：` + composer.value;
      composer.focus();
    });
  });
}
function bindTurnActions() {
  conv.querySelectorAll("[data-doc-open]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      setDocViewTurn(el.getAttribute("data-doc-open"));
    });
  });
}
function bindToolToggles() {
  conv.querySelectorAll("button[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.toggle;
      const body = conv.querySelector(`[data-tool-body="${id}"]`);
      if (body) body.classList.toggle("hidden");
    });
  });
}
function summarizeArgs(args) {
  if (!args || typeof args !== "object") return String(args ?? "");
  const keys = Object.keys(args);
  if (!keys.length) return "{}";
  const head = keys.slice(0, 3).map((k) => `${k}=${truncate(JSON.stringify(args[k]), 24)}`).join(" ");
  return keys.length > 3 ? head + ` … +${keys.length - 3}` : head;
}
function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function safeStringify(v) { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }
function extractResult(r) {
  if (!r) return r;
  if (typeof r === "object" && "details" in r) return r.details;
  if (typeof r === "object" && Array.isArray(r.content)) {
    const txt = r.content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
    try { return JSON.parse(txt); } catch { return txt; }
  }
  return r;
}

function renderInspector(s) {
  const tab = s.inspectorTab || "trace";
  const tabBtn = (id, label, count) => {
    const active = tab === id;
    return `<button data-insp-tab="${id}" class="px-2.5 py-1 text-[11.5px] rounded ${active ? "bg-iris-500 text-white" : "text-zinc-600 hover:bg-zinc-100"}">${label}${count != null ? ` <span class="opacity-60 ml-0.5">${count}</span>` : ""}</button>`;
  };
  const errCount = (s.upstreamErrors || []).length;
  const rawCount = (s.raw || []).length;
  const tabs = `<div class="flex items-center gap-1 px-1 py-1 rounded border border-zinc-200 bg-white">${tabBtn("trace", "Trace")}${tabBtn("registry", "Registry")}${tabBtn("upstream", "Upstream", errCount || null)}${tabBtn("raw", "Raw", rawCount || null)}</div>`;

  let body = "";
  if (tab === "trace") body = renderInspectorTrace(s);
  else if (tab === "registry") body = renderInspectorRegistry(s);
  else if (tab === "upstream") body = renderInspectorUpstream(s);
  else body = renderInspectorRaw(s);

  inspector.innerHTML = `${tabs}<div class="space-y-3">${body}</div>`;

  inspector.querySelectorAll("[data-insp-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setInspectorTab(btn.getAttribute("data-insp-tab")));
  });
  const rawInput = inspector.querySelector("#rawFilterInput");
  if (rawInput) rawInput.addEventListener("input", (e) => setRawFilter(e.target.value));
  const refreshBtn = inspector.querySelector("#registryRefreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "rebuilding…";
    try {
      const r = await api("/api/registry/refresh");
      if (r.report) console.log("[rebuild]", r.report);
    } catch (err) {
      alert("rebuild failed: " + err.message);
    } finally {
      await refreshRegistry();
      refreshBtn.disabled = false;
    }
  });
}

function renderInspectorTrace(s) {
  const turn = [...s.turns].reverse().find((t) => t.kind === "assistant");
  const trace = turn ? buildTrace(turn) : [];
  const tu = topToolsUsed(s);
  return `
    <div class="rounded border border-zinc-200 bg-white card-shadow">
      <div class="px-3 py-2 border-b border-zinc-200 text-[11px] uppercase tracking-wider text-zinc-500">Run Trace</div>
      <div class="p-2 space-y-1">${trace.length ? trace.map(traceRow).join("") : `<div class="text-zinc-400 text-[12px] px-2 py-3">还没有 turn</div>`}</div>
    </div>
    <div class="rounded border border-zinc-200 bg-white card-shadow">
      <div class="px-3 py-2 border-b border-zinc-200 text-[11px] uppercase tracking-wider text-zinc-500">Tokens & Cost</div>
      <div class="p-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        <div class="text-zinc-500">input</div><div class="font-mono text-right text-zinc-900">${fmtNum(s.metrics.input)}</div>
        <div class="text-zinc-500">output</div><div class="font-mono text-right text-zinc-900">${fmtNum(s.metrics.output)}</div>
        <div class="text-zinc-500">cache read</div><div class="font-mono text-right text-zinc-900">${fmtNum(s.metrics.cacheRead)}</div>
        <div class="text-zinc-500">cache write</div><div class="font-mono text-right text-zinc-900">${fmtNum(s.metrics.cacheWrite)}</div>
        <div class="text-zinc-500">cost</div><div class="font-mono text-right text-iris-600">${fmtCost(s.metrics.cost)}</div>
        <div class="text-zinc-500">tool calls</div><div class="font-mono text-right text-zinc-900">${fmtNum(s.metrics.toolCalls)}</div>
      </div>
    </div>
    <div class="rounded border border-zinc-200 bg-white card-shadow">
      <div class="px-3 py-2 border-b border-zinc-200 text-[11px] uppercase tracking-wider text-zinc-500">Tools used</div>
      <div class="p-2 text-[12px] space-y-0.5">${tu.length ? tu.map((t) => `<div class="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-100"><span class="font-mono text-iris-600">${escapeHtml(t.name)}</span><span class="ml-auto text-zinc-500">${t.count}</span></div>`).join("") : `<div class="text-zinc-400 px-2 py-2">–</div>`}</div>
    </div>`;
}

function renderInspectorRegistry(s) {
  const reg = s.registry;
  const diags = (s.diagnostics || []).slice(-6).reverse();
  return `
    <div class="rounded border border-zinc-200 bg-white card-shadow">
      <div class="px-3 py-2 border-b border-zinc-200 flex items-center gap-2">
        <span class="text-[11px] uppercase tracking-wider text-zinc-500">Registry snapshot</span>
        <button id="registryRefreshBtn" class="ml-auto chip" title="rebuild_all → 重新读取">刷新</button>
      </div>
      ${reg ? `
        <div class="p-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
          <div class="text-zinc-500">cards</div><div class="font-mono text-right text-zinc-900">${fmtNum(reg.cards.total)}</div>
          <div class="text-zinc-500">tools</div><div class="font-mono text-right text-zinc-900">${fmtNum(reg.tools.total)}</div>
          <div class="text-zinc-500">blocked</div><div class="font-mono text-right text-zinc-900">${fmtNum(reg.tools.blocked)}</div>
        </div>
        <div class="px-3 pb-3 text-[11.5px]">
          <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">by lifecycle</div>
          ${Object.entries(reg.cards.byStatus).map(([k, v]) => `<span class="chip mr-1 mb-1 inline-block">${escapeHtml(k)} · ${v}</span>`).join("")}
        </div>
        <div class="px-3 pb-3 text-[11.5px]">
          <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">by domain</div>
          ${Object.entries(reg.cards.byDomain || {}).slice(0, 8).map(([k, v]) => `<span class="chip mr-1 mb-1 inline-block">${escapeHtml(k)} · ${v}</span>`).join("")}
        </div>` : `<div class="p-3 text-[12px] text-zinc-400">loading…</div>`}
    </div>
    ${diags.length ? `
    <div class="rounded border border-zinc-200 bg-white card-shadow">
      <div class="px-3 py-2 border-b border-zinc-200 text-[11px] uppercase tracking-wider text-zinc-500">pi diagnostics</div>
      <div class="p-2 text-[11.5px] font-mono space-y-1">${diags.map((d) => `<div class="${d.level === 'error' ? 'text-rose-700' : 'text-zinc-600'} whitespace-pre-wrap break-all">${escapeHtml(d.text)}</div>`).join("")}</div>
    </div>` : ""}`;
}

function renderInspectorUpstream(s) {
  const list = (s.upstreamErrors || []).slice().reverse();
  if (!list.length) {
    return `<div class="rounded border border-zinc-200 bg-white card-shadow p-3 text-[12px] text-zinc-400">尚无上游错误事件</div>`;
  }
  const rows = list.map((e) => {
    const isFinal = e.phase === "final";
    const cls = isFinal ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50";
    const txtCls = isFinal ? "text-rose-800" : "text-amber-800";
    const time = new Date(e.at).toLocaleTimeString();
    const head = isFinal
      ? `final · ${escapeHtml(e.hint || "upstream_unknown")}`
      : `retry ${e.attempt ?? "?"}/${e.maxAttempts ?? "?"} · 退避 ${e.delayMs ?? "?"}ms`;
    return `<div class="rounded border ${cls} ${txtCls} p-2 text-[11.5px] space-y-0.5">
      <div class="flex items-center gap-2">
        <span class="badge ${isFinal ? "badge-err" : "badge-warn"}">${isFinal ? "final" : "retry"}</span>
        <span class="font-medium">${escapeHtml(head)}</span>
        <span class="ml-auto font-mono text-[11px] opacity-70">${escapeHtml(time)}</span>
      </div>
      <div class="font-mono break-words opacity-90">${escapeHtml(e.errorMessage || "(no message)")}</div>
    </div>`;
  }).join("");
  return `
    <div class="rounded border border-zinc-200 bg-white card-shadow">
      <div class="px-3 py-2 border-b border-zinc-200 text-[11px] uppercase tracking-wider text-zinc-500">Upstream timeline · ${list.length}</div>
      <div class="p-2 space-y-1.5">${rows}</div>
    </div>`;
}

function renderInspectorRaw(s) {
  const q = (s.rawFilter || "").trim().toLowerCase();
  const list = (s.raw || []).slice().reverse();
  const filtered = q
    ? list.filter((r) => {
        try {
          return JSON.stringify(r.evt).toLowerCase().includes(q);
        } catch { return false; }
      })
    : list;
  const rows = filtered.slice(0, 60).map((r) => {
    const evt = r.evt || {};
    const kind = evt.kind || "?";
    let sub = "";
    if (kind === "agent_event") sub = evt.payload?.type || "";
    else if (kind === "upstream_error") sub = evt.phase || "";
    const time = new Date(r.at).toLocaleTimeString();
    let body;
    try { body = JSON.stringify(evt); } catch { body = "(unserializable)"; }
    return `<details class="rounded border border-zinc-200 bg-zinc-50">
      <summary class="px-2 py-1 flex items-center gap-2 text-[11.5px]">
        <span class="badge badge-mute mono">${escapeHtml(kind)}${sub ? ` · ${escapeHtml(sub)}` : ""}</span>
        <span class="ml-auto font-mono text-[10.5px] text-zinc-500">${escapeHtml(time)}</span>
      </summary>
      <pre class="px-2 py-2 text-[11px] font-mono whitespace-pre-wrap break-all text-zinc-700">${escapeHtml(body.slice(0, 1200))}${body.length > 1200 ? "…" : ""}</pre>
    </details>`;
  }).join("");
  return `
    <div class="rounded border border-zinc-200 bg-white card-shadow">
      <div class="px-3 py-2 border-b border-zinc-200 flex items-center gap-2">
        <span class="text-[11px] uppercase tracking-wider text-zinc-500">Raw events</span>
        <span class="ml-auto text-[11px] text-zinc-500">${filtered.length}/${list.length}</span>
      </div>
      <div class="px-2 py-2 border-b border-zinc-200">
        <input id="rawFilterInput" value="${escapeHtml(s.rawFilter || "")}" placeholder="过滤：toolcall / message_update / upstream …" class="w-full px-2 py-1 text-[12px] border border-zinc-200 rounded outline-none focus:border-iris-500" />
      </div>
      <div class="p-2 space-y-1 max-h-[calc(100vh-260px)] overflow-y-auto scroll-thin">${rows || `<div class="text-zinc-400 text-[12px] px-2 py-3">无匹配</div>`}</div>
    </div>`;
}
function buildTrace(turn) {
  const rows = [];
  for (const p of turn.parts || []) {
    if (p.kind === "thinking") rows.push({ label: "thinking", t: p.createdAt, kind: "thinking", chars: (p.text || "").length });
    else if (p.kind === "tool") {
      const t = state.toolsById.get(p.toolCallId);
      if (t) rows.push({ label: t.name, t: t.t0, kind: "tool", elapsed: t.t1 ? t.t1 - t.t0 : null, status: t.status });
    } else if (p.kind === "text") rows.push({ label: "text", t: p.createdAt, kind: "text", chars: (p.text || "").length });
  }
  return rows.sort((a, b) => (a.t || 0) - (b.t || 0));
}
function traceRow(r) {
  const dot = r.kind === "tool"
    ? (r.status === "ok" ? "dot-ok" : r.status === "error" ? "dot-err" : "dot-running")
    : "dot-pending";
  const tail = r.kind === "tool"
    ? (r.elapsed != null ? fmtMs(r.elapsed) : "running")
    : `${r.chars ?? 0}c`;
  return `<div class="px-2 py-1 flex items-center gap-2 text-[12px]">
    <span class="dot ${dot}"></span>
    <span class="font-mono ${r.kind === "tool" ? "text-iris-600" : "text-zinc-700"}">${escapeHtml(r.label)}</span>
    <span class="ml-auto text-zinc-500">${tail}</span>
  </div>`;
}
function topToolsUsed(s) {
  const map = new Map();
  for (const id of s.toolsOrder) {
    const t = s.toolsById.get(id);
    if (!t) continue;
    map.set(t.name, (map.get(t.name) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function renderSessionList(s) {
  const t = $("#sessionList");
  if (!s.sessionState) { t.innerHTML = `<div class="text-zinc-400 px-2 py-1">loading…</div>`; return; }
  const cur = s.sessionState;
  t.innerHTML = `
    <div class="px-2 py-2 rounded bg-iris-500/5 border border-iris-500/30">
      <div class="text-[11px] text-zinc-500">current</div>
      <div class="text-[12.5px] font-mono text-zinc-900 truncate">${escapeHtml(cur.sessionName || cur.sessionId || "session")}</div>
      <div class="text-[11px] text-zinc-500">${cur.messageCount ?? 0} messages</div>
    </div>
    <div class="text-[11px] text-zinc-400 px-2 pt-3 pb-1 uppercase tracking-wider">tip</div>
    <div class="px-2 text-[11.5px] text-zinc-500 leading-relaxed">+ New 开新会话；输入框 ⌘K 打开工具面板。</div>`;
}

// ─────────────────────────────────────────────
// State refresh helpers
// ─────────────────────────────────────────────
let statePollTimer = null;
async function refreshState() {
  try { const r = await api("/api/get_state"); setSessionState(r.data); } catch {}
  try { const s = await api("/api/get_session_stats"); applySessionStats(s.data); } catch {}
}
async function refreshRegistry() {
  try { const r = await getJson("/api/registry"); setRegistry(r); } catch {}
}

// ─────────────────────────────────────────────
// Master render
// ─────────────────────────────────────────────
function renderAll() {
  renderTopbar(state);
  renderUpstreamBanner(state);
  renderConversation(state);
  renderInspector(state);
  renderSessionList(state);
  renderExtModal(state.extPending);
  renderDocView(state);
}
subscribe(() => renderAll());

function renderUpstreamBanner(s) {
  const el = document.getElementById("upstreamBanner");
  if (!el) return;
  const list = s.upstreamErrors || [];
  if (!list.length) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  const last = list[list.length - 1];
  const ageMs = Date.now() - last.at;
  if (last.phase !== "final" && ageMs > 10_000) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  const isFinal = last.phase === "final";
  const palette = isFinal
    ? { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-800", badge: "badge-err" }
    : { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", badge: "badge-warn" };
  const hintMap = {
    network_unreachable: "上游 API 不可达（DNS/防火墙/代理）",
    auth_invalid: "凭据无效（401，检查 API key 形状）",
    auth_forbidden: "凭据被拒（403）",
    rate_limited: "命中速率限制（429），稍后重试",
    upstream_timeout: "上游超时",
    upstream_unknown: "上游未知错误",
  };
  const hintText = last.hint ? (hintMap[last.hint] || last.hint) : "";
  const phaseText = isFinal
    ? `连接上游模型失败 · 已用完重试`
    : `自动重试中 · 第 ${last.attempt ?? "?"}/${last.maxAttempts ?? "?"} 次（退避 ${last.delayMs ?? "?"}ms）`;
  el.className = `border-b text-[12px] px-4 py-2 leading-relaxed ${palette.bg} ${palette.border} ${palette.text}`;
  el.innerHTML = `
    <div class="flex items-start gap-2">
      <span class="badge ${palette.badge} mt-0.5">${isFinal ? "upstream error" : "retry"}</span>
      <div class="flex-1 min-w-0">
        <div class="font-medium">${escapeHtml(phaseText)}${hintText ? ` · <span class="text-[11.5px] opacity-80">${escapeHtml(hintText)}</span>` : ""}</div>
        <div class="font-mono text-[11.5px] opacity-80 break-words">${escapeHtml(last.errorMessage || "(no message)")}</div>
      </div>
      <button class="chip" id="upstreamBannerDismiss">关闭</button>
    </div>`;
  const dismiss = document.getElementById("upstreamBannerDismiss");
  if (dismiss) dismiss.addEventListener("click", () => {
    state.upstreamErrors = [];
    el.classList.add("hidden");
    el.innerHTML = "";
  }, { once: true });
}

// ─────────────────────────────────────────────
// Scroll follow (sticky bottom)
// ─────────────────────────────────────────────
conv.addEventListener("scroll", () => {
  const nearBottom = conv.scrollHeight - conv.scrollTop - conv.clientHeight < 24;
  setFollowBottom(nearBottom);
  updateScrollBottomBtn();
}, { passive: true });
scrollBottomBtn?.addEventListener("click", () => {
  setFollowBottom(true);
  conv.scrollTop = conv.scrollHeight;
  updateScrollBottomBtn();
});

// ─────────────────────────────────────────────
// Document View
// ─────────────────────────────────────────────
function renderDocView(s) {
  if (!s.docViewTurnId) {
    docView.classList.add("hidden");
    return;
  }
  const turn = s.turns.find((t) => t.id === s.docViewTurnId);
  if (!turn) { docView.classList.add("hidden"); return; }
  docView.classList.remove("hidden");
  docTitle.textContent = `Assistant turn · ${new Date(turn.t0).toLocaleTimeString()}`;
  const sections = [];
  (turn.parts || []).forEach((p, idx) => {
    if (p.kind === "text") {
      sections.push({ id: `sec-text-${idx}`, label: `text ${idx + 1}`, html: `<div class="markdown">${renderMarkdown(p.text || "")}</div>` });
    } else if (p.kind === "thinking") {
      sections.push({ id: `sec-think-${idx}`, label: `thinking ${idx + 1}`, html: `<pre class="text-[12px] font-mono whitespace-pre-wrap text-zinc-700 bg-zinc-50 border border-zinc-200 rounded p-3">${esc(p.text || "")}</pre>` });
    } else if (p.kind === "tool") {
      const tool = state.toolsById.get(p.toolCallId);
      if (!tool) return;
      const detailsHtml = renderDetails(tool.details ?? extractResult(tool.result));
      sections.push({
        id: `sec-tool-${idx}`,
        label: `🔧 ${tool.name}`,
        html: `<div class="space-y-2">
          <div class="flex items-center gap-2 text-[12px] text-zinc-600">
            <span class="font-mono text-iris-600">${esc(tool.name)}</span>
            <span class="text-zinc-500">${esc(summarizeArgs(tool.args))}</span>
            <span class="ml-auto">${tool.t1 ? fmtMs(tool.t1 - tool.t0) : "running"}</span>
          </div>
          <div class="border border-zinc-200 rounded p-3 bg-white">${detailsHtml}</div>
        </div>`,
      });
    }
  });
  docOutline.innerHTML = sections.length
    ? sections.map((s) => `<a href="#" data-anchor="${s.id}" class="block px-2 py-1 rounded hover:bg-zinc-100 text-zinc-700 text-[12.5px] truncate">${esc(s.label)}</a>`).join("")
    : `<div class="text-zinc-400 text-[12px] px-2 py-1">no parts</div>`;
  docContent.innerHTML = sections.map((sec) => `
    <section id="${sec.id}" class="mb-8 scroll-mt-4">
      <div class="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">${esc(sec.label)}</div>
      ${sec.html}
    </section>`).join("") || `<div class="text-zinc-400 text-[12.5px]">no content</div>`;
  docOutline.querySelectorAll("a[data-anchor]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const tgt = docContent.querySelector(`#${a.getAttribute("data-anchor")}`);
      tgt?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}
docCloseBtn?.addEventListener("click", () => closeDocView());
docCopyBtn?.addEventListener("click", async () => {
  const turn = state.turns.find((t) => t.id === state.docViewTurnId);
  if (!turn) return;
  const md = (turn.parts || []).map((p) => {
    if (p.kind === "text") return p.text || "";
    if (p.kind === "thinking") return `> [thinking]\n> ${(p.text || "").split("\n").join("\n> ")}`;
    if (p.kind === "tool") {
      const tool = state.toolsById.get(p.toolCallId);
      if (!tool) return "";
      const det = tool.details ?? extractResult(tool.result);
      return `\n#### tool · ${tool.name}\n\n\`\`\`json\n${safeStringify(det)}\n\`\`\``;
    }
    return "";
  }).filter(Boolean).join("\n\n");
  try { await navigator.clipboard.writeText(md); docCopyBtn.textContent = "已复制"; setTimeout(() => (docCopyBtn.textContent = "复制"), 1200); } catch {}
});

// ⌘. toggle / Esc close
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === ".") {
    e.preventDefault();
    if (state.docViewTurnId) { closeDocView(); return; }
    const last = [...state.turns].reverse().find((t) => t.kind === "assistant");
    if (last) setDocViewTurn(last.id);
    return;
  }
  if (e.key === "Escape" && state.docViewTurnId) { closeDocView(); }
});

connectSse();
refreshRegistry();
setTimeout(refreshState, 800);
statePollTimer = setInterval(() => {
  if (state.connection.status === "ready") refreshState();
}, 5000);
window.addEventListener("beforeunload", () => clearInterval(statePollTimer));