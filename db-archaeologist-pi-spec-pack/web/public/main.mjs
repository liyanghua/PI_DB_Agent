// main.mjs — entry point
import { state, subscribe, applyBridgeEvent, pushUserMessage, setSessionState, setRegistry, applySessionStats, clearExtPending, setStreaming, setConnectionStatus, setDocViewTurn, closeDocView, setFollowBottom, setInspectorTab, setRawFilter, setKeywordRuns, setKeywordSummary, clearKeywordSummary, toggleKeywordCompareSel, setKeywordCompare, clearKeywordCompare, startKeywordAnalysis, finishKeywordAnalysis, failKeywordAnalysis } from "./store.mjs";
import { renderMarkdown, renderDetails, escapeHtml as esc } from "./render.mjs";
import { renderKeywordSourceAudit } from "./components.mjs";

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
  es.onopen = () => { 
    backoffMs = 500; 
    loadSessions();
  };
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
    await loadSessions();
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
    <div class="w-[420px] bg-white border border-zinc-200 card-shadow rounded-lg overflow-hidden" id="pickerCard">
      <div class="px-4 py-2.5 border-b border-zinc-200 text-[13px] text-zinc-700 font-medium">${escapeHtml(title)}</div>
      <div class="max-h-80 overflow-y-auto scroll-thin">
        ${options.map((o, i) => `<button data-i="${i}" class="w-full text-left px-4 py-2.5 hover:bg-zinc-100 text-[13px] text-zinc-800 border-b border-zinc-200 last:border-0">${escapeHtml(o.label)}</button>`).join("")}
      </div>
      <div class="px-4 py-2 text-right border-t border-zinc-200"><button class="chip" id="pmCancel">取消</button></div>
    </div>`;
  
  // 阻止模态框内滚动事件冒泡，防止页面滚动
  const card = $("#pickerCard");
  card.addEventListener("wheel", (e) => e.stopPropagation());
  card.addEventListener("touchmove", (e) => e.stopPropagation());
  
  // 点击遮罩层关闭
  const closeModal = () => extModal.classList.add("hidden");
  extModal.addEventListener("click", (e) => {
    if (e.target === extModal) closeModal();
  });
  
  extModal.querySelectorAll("button[data-i]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = +btn.dataset.i;
      btn.disabled = true;
      btn.classList.add("opacity-50", "cursor-wait");
      btn.innerHTML = `${escapeHtml(options[i].label)} <span class="text-zinc-400">...</span>`;
      try { 
        await options[i].onPick(); 
        extModal.classList.add("hidden");
      } catch (err) { 
        alert(err.message); 
        btn.disabled = false;
        btn.classList.remove("opacity-50", "cursor-wait");
        btn.innerHTML = escapeHtml(options[i].label);
      }
    });
  });
  $("#pmCancel").addEventListener("click", closeModal);
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
  const keywordCount = (s.keywordRuns || []).length;
  const tabs = `<div class="flex items-center gap-1 px-1 py-1 rounded border border-zinc-200 bg-white">${tabBtn("trace", "Trace")}${tabBtn("registry", "Registry")}${tabBtn("keyword", "Keyword", keywordCount || null)}${tabBtn("upstream", "Upstream", errCount || null)}${tabBtn("raw", "Raw", rawCount || null)}</div>`;

  let body = "";
  if (tab === "trace") body = renderInspectorTrace(s);
  else if (tab === "registry") body = renderInspectorRegistry(s);
  else if (tab === "keyword") body = renderInspectorKeyword(s);
  else if (tab === "upstream") body = renderInspectorUpstream(s);
  else body = renderInspectorRaw(s);

  inspector.innerHTML = `${tabs}<div class="space-y-3">${body}</div>`;

  inspector.querySelectorAll("[data-insp-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-insp-tab");
      setInspectorTab(tabId);
      if (tabId === "keyword") loadKeywordRuns();
    });
  });
  
  // Keyword tab 专属事件
  if (tab === "keyword") {
    const analyzeForm = inspector.querySelector("#kwAnalyzeForm");
    if (analyzeForm) {
      analyzeForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(analyzeForm);
        const input = {
          category: String(fd.get("category") || "").trim(),
          strategy: String(fd.get("strategy") || "baseline_v1").trim(),
          live: fd.get("live") === "on",
          top_n: 10,
          per_demand_type_top: 5,
        };
        if (!input.category) return alert("请输入品类名称");
        startKeywordAnalysis(input);
        try {
          const r = await api("/api/keyword/analyze", input);
          finishKeywordAnalysis(r);
          await loadKeywordRuns();
        } catch (err) {
          const msg = err?.json?.details || err?.json?.error || err.message || String(err);
          failKeywordAnalysis(msg);
        }
      });
    }
    const refreshKwBtn = inspector.querySelector("#kwRefreshBtn");
    if (refreshKwBtn) refreshKwBtn.addEventListener("click", () => loadKeywordRuns());
    inspector.querySelectorAll("[data-kw-run-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const runId = btn.getAttribute("data-kw-run-id");
        if (!runId) return;
        btn.disabled = true;
        btn.textContent = "加载中…";
        try {
          const r = await getJson(`/api/keyword/run/${runId}`);
          setKeywordSummary(runId, r);
        } catch (err) {
          alert(`加载失败: ${err.message}`);
        } finally {
          btn.disabled = false;
          btn.textContent = "查看";
        }
      });
    });
    inspector.querySelectorAll("[data-kw-compare-check]").forEach((cb) => {
      cb.addEventListener("change", () => {
        toggleKeywordCompareSel(cb.getAttribute("data-kw-compare-check"));
      });
    });
    const compareBtn = inspector.querySelector("#kwCompareBtn");
    if (compareBtn) {
      compareBtn.addEventListener("click", async () => {
        const sel = state.keywordCompareSel;
        if (sel.length !== 2) return alert("请勾选两个 run 进行对比");
        compareBtn.disabled = true;
        compareBtn.textContent = "对比中…";
        try {
          const r = await getJson(`/api/keyword/compare?a=${sel[0]}&b=${sel[1]}`);
          setKeywordCompare(r);
        } catch (err) {
          alert(`对比失败: ${err.message}`);
        } finally {
          compareBtn.disabled = false;
          compareBtn.textContent = "对比";
        }
      });
    }
    const closeSummaryBtn = inspector.querySelector("#kwCloseSummary");
    if (closeSummaryBtn) {
      closeSummaryBtn.addEventListener("click", () => clearKeywordSummary());
    }
    const closeCompareBtn = inspector.querySelector("#kwCloseCompare");
    if (closeCompareBtn) {
      closeCompareBtn.addEventListener("click", () => clearKeywordCompare());
    }
  }
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

// ─────────────────────────────────────────────
// Keyword runs tab
// ─────────────────────────────────────────────
let kwRunsLoading = false;
async function loadKeywordRuns() {
  if (kwRunsLoading) return;
  kwRunsLoading = true;
  try {
    const r = await getJson("/api/keyword/runs?limit=80");
    setKeywordRuns(r.runs || []);
  } catch (err) {
    console.warn("loadKeywordRuns failed", err);
  } finally {
    kwRunsLoading = false;
  }
}

function fmtRunTs(iso) {
  if (!iso) return "–";
  try { return new Date(iso).toLocaleString("zh-CN", { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit" }); }
  catch { return iso; }
}

function renderInspectorKeyword(s) {
  const runs = s.keywordRuns || [];
  const sel = s.keywordCompareSel || [];
  const selectedId = s.keywordSelectedId;
  const summary = selectedId ? (s.keywordSummaries || {})[selectedId] : null;
  const compare = s.keywordCompare;
  const analysis = s.keywordAnalysis || {};
  const lastInput = analysis.lastInput || {};

  const rowsHtml = runs.length ? runs.map((r) => {
    const checked = sel.includes(r.run_id) ? "checked" : "";
    const live = r.live_probe ? `<span class="badge badge-warn">live</span>` : `<span class="badge badge-mute">mock</span>`;
    return `<div class="px-2 py-1.5 border-b border-zinc-200 text-[12px] flex items-center gap-2 hover:bg-zinc-50">
      <input type="checkbox" data-kw-compare-check="${escapeHtml(r.run_id)}" ${checked} class="cursor-pointer"/>
      <span class="font-mono text-iris-600 truncate" title="${escapeHtml(r.run_id)}">${escapeHtml(r.strategy || "?")}</span>
      <span class="text-zinc-700 truncate flex-1">${escapeHtml(r.category || "?")}</span>
      ${live}
      <span class="text-zinc-500 font-mono text-[11px]">${fmtRunTs(r.started_at)}</span>
      <span class="text-zinc-500 font-mono text-[11px]">${fmtMs(r.elapsed_ms)}</span>
      <button data-kw-run-id="${escapeHtml(r.run_id)}" class="chip">查看</button>
    </div>`;
  }).join("") : `<div class="text-zinc-400 text-[12px] px-2 py-3">尚无 keyword run（跑 npm run keyword:demo 入户地垫 即可生成）</div>`;

  const compareDisabled = sel.length !== 2 ? "disabled" : "";
  const compareTip = sel.length === 0 ? "勾选两个 run" : sel.length === 1 ? "再勾选 1 个" : `${sel[0]} ⇄ ${sel[1]}`;
  const analyzeDisabled = analysis.loading ? "disabled" : "";
  const analyzeBtnText = analysis.loading ? "分析中..." : "运行分析";
  const liveChecked = lastInput.live ? "checked" : "";

  const analysisHtml = analysis.result ? renderKeywordAnalysisResult(analysis.result) : "";
  const analysisErrorHtml = analysis.error ? `
    <div class="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
      ${escapeHtml(analysis.error)}
    </div>` : "";

  const summaryHtml = summary && summary.meta ? `
    <div class="rounded border border-zinc-200 bg-white card-shadow">
      <div class="px-3 py-2 border-b border-zinc-200 flex items-center gap-2">
        <span class="text-[11px] uppercase tracking-wider text-zinc-500">Run summary</span>
        <span class="font-mono text-[11px] text-iris-600 truncate">${escapeHtml(selectedId)}</span>
        <button id="kwCloseSummary" class="ml-auto chip">关闭</button>
      </div>
      <div class="px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] border-b border-zinc-200">
        <div class="text-zinc-500">strategy</div><div class="font-mono text-zinc-900">${escapeHtml(summary.meta.strategy || "?")}</div>
        <div class="text-zinc-500">category</div><div class="font-mono text-zinc-900">${escapeHtml(summary.meta.category || "?")} <span class="text-zinc-400">(${escapeHtml(summary.meta.category_id || "?")})</span></div>
        <div class="text-zinc-500">elapsed</div><div class="font-mono text-zinc-900">${fmtMs(summary.meta.elapsed_ms)}</div>
        <div class="text-zinc-500">config_hash</div><div class="font-mono text-zinc-900 truncate" title="${escapeHtml(summary.meta.config_hash || "")}">${escapeHtml((summary.meta.config_hash || "").slice(0,12))}</div>
        <div class="text-zinc-500">live_probe</div><div class="font-mono text-zinc-900">${summary.meta.live_probe ? "true" : "false"}</div>
        <div class="text-zinc-500">stage_timings</div><div class="font-mono text-[11px] text-zinc-700">${escapeHtml(JSON.stringify(summary.meta.stage_timings || {}))}</div>
      </div>
      <div class="markdown px-3 py-3 max-h-[420px] overflow-y-auto scroll-thin">${summary.summary ? renderMarkdown(summary.summary) : `<div class="text-zinc-400">empty run_summary.md</div>`}</div>
    </div>` : "";

  const compareHtml = compare ? `
    <div class="rounded border border-zinc-200 bg-white card-shadow">
      <div class="px-3 py-2 border-b border-zinc-200 flex items-center gap-2">
        <span class="text-[11px] uppercase tracking-wider text-zinc-500">Compare</span>
        <span class="font-mono text-[11px] text-iris-600 truncate">${escapeHtml(compare.run_id_a || "")} ⇄ ${escapeHtml(compare.run_id_b || "")}</span>
        <button id="kwCloseCompare" class="ml-auto chip">关闭</button>
      </div>
      <div class="markdown px-3 py-3 max-h-[420px] overflow-y-auto scroll-thin">${compare.report ? renderMarkdown(compare.report) : `<div class="text-zinc-400">empty compare report</div>`}</div>
    </div>` : "";

  return `
    <div class="rounded border border-zinc-200 bg-white card-shadow">
      <div class="px-3 py-2 border-b border-zinc-200">
        <div class="text-[11px] uppercase tracking-wider text-zinc-500">Keyword demand baseline</div>
      </div>
      <form id="kwAnalyzeForm" class="p-3 space-y-2">
        <label class="block text-[11px] text-zinc-500">品类名称</label>
        <input name="category" value="${escapeHtml(lastInput.category || "厨房地垫")}" placeholder="输入任意品类，例如：客厅地毯 / 桌布 / 户外折叠椅"
          class="w-full px-2.5 py-2 text-[12.5px] border border-zinc-300 rounded outline-none focus:border-iris-500 focus:ring-2 focus:ring-iris-100" />
        <div class="flex items-center gap-2">
          <select name="strategy" class="flex-1 px-2 py-1.5 text-[12px] border border-zinc-300 rounded bg-white outline-none focus:border-iris-500">
            <option value="baseline_v1" ${lastInput.strategy === "baseline_v1" ? "selected" : ""}>baseline_v1</option>
          </select>
          <label class="chip cursor-pointer select-none">
            <input type="checkbox" name="live" ${liveChecked} class="mr-1 align-[-1px]" />
            live
          </label>
          <button ${analyzeDisabled} class="px-3 py-1.5 rounded bg-iris-500 hover:bg-iris-600 text-white text-[12px] disabled:opacity-50 disabled:cursor-wait">${analyzeBtnText}</button>
        </div>
        <div class="text-[11px] text-zinc-500">mock 模式用于本地验收；未命中 fixture 会回落到最相近类目并保留原始输入。</div>
      </form>
    </div>
    ${analysisErrorHtml}
    ${analysisHtml}
    <div class="rounded border border-zinc-200 bg-white card-shadow">
      <div class="px-3 py-2 border-b border-zinc-200 flex items-center gap-2">
        <span class="text-[11px] uppercase tracking-wider text-zinc-500">Keyword runs · ${runs.length}</span>
        <span class="ml-auto text-[11px] text-zinc-500">${escapeHtml(compareTip)}</span>
        <button id="kwCompareBtn" class="chip ${compareDisabled ? "opacity-50 cursor-not-allowed" : ""}" ${compareDisabled}>对比</button>
        <button id="kwRefreshBtn" class="chip">刷新</button>
      </div>
      <div class="max-h-[360px] overflow-y-auto scroll-thin">${rowsHtml}</div>
    </div>
    ${summaryHtml}
    ${compareHtml}
  `;
}

function renderKeywordAnalysisResult(result) {
  const topOverall = Array.isArray(result.top_overall) ? result.top_overall : [];
  const topByType = result.top_by_type || {};
  const blue = Array.isArray(result.top_by_blue_ocean) ? result.top_by_blue_ocean : [];
  const resolutionBadge = result.resolution === "mock_fixture_fallback"
    ? `<span class="badge badge-warn">fixture fallback</span>`
    : `<span class="badge badge-ok">${escapeHtml(result.resolution || "resolved")}</span>`;
  return `
    <div class="rounded border border-zinc-200 bg-white card-shadow">
      <div class="px-3 py-2 border-b border-zinc-200 flex items-center gap-2">
        <span class="text-[11px] uppercase tracking-wider text-zinc-500">Analysis result</span>
        ${resolutionBadge}
        <span class="ml-auto font-mono text-[11px] text-iris-600 truncate" title="${escapeHtml(result.run_id || "")}">${escapeHtml(result.run_id || "")}</span>
      </div>
      <div class="px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] border-b border-zinc-200">
        <div class="text-zinc-500">category</div><div class="font-mono text-zinc-900">${escapeHtml(result.category || "?")}</div>
        <div class="text-zinc-500">category_id</div><div class="font-mono text-zinc-900">${escapeHtml(result.category_id || "?")}</div>
        <div class="text-zinc-500">top_overall</div><div class="font-mono text-zinc-900">${topOverall.length}</div>
        <div class="text-zinc-500">type buckets</div><div class="font-mono text-zinc-900">${Object.keys(topByType).length}</div>
      </div>
      <div class="p-3 space-y-3">
        ${result.source_audit ? `
          <div>
            <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">候选接口审计</div>
            ${renderKeywordSourceAudit(result.source_audit)}
          </div>` : ""}
        <div>
          <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">KDS TOP 总榜</div>
          ${renderKeywordTopTable(topOverall)}
        </div>
        <div>
          <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">按需求类型 TOP</div>
          ${renderKeywordTypeBuckets(topByType)}
        </div>
        ${blue.length ? `
          <div>
            <div class="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">蓝海辅助榜</div>
            ${renderKeywordTopTable(blue, { compact: true })}
          </div>` : ""}
      </div>
    </div>`;
}

function renderKeywordTopTable(rows, opts = {}) {
  if (!rows.length) return `<div class="text-zinc-400 text-[12px] px-2 py-2 border border-zinc-200 rounded">暂无结果</div>`;
  const maxRows = opts.compact ? 5 : 10;
  return `<div class="overflow-x-auto border border-zinc-200 rounded">
    <table class="data-table">
      <thead><tr><th>#</th><th>关键词</th><th>KDS</th><th>需求类型</th><th>归因</th></tr></thead>
      <tbody>
        ${rows.slice(0, maxRows).map((r, i) => {
          const score = r.scores?.kds;
          const labels = (r.labels || []).filter((x) => !["category", "unknown"].includes(x)).join(", ") || "-";
          return `<tr>
            <td class="num">${i + 1}</td>
            <td>${escapeHtml(r.keyword || "")}</td>
            <td class="num">${typeof score === "number" ? score.toFixed(1) : "-"}</td>
            <td>${escapeHtml(labels)}</td>
            <td>${escapeHtml(r.explanation?.rank_reason || "")}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>`;
}

function renderKeywordTypeBuckets(topByType) {
  const entries = Object.entries(topByType || {}).filter(([, rows]) => Array.isArray(rows) && rows.length);
  if (!entries.length) return `<div class="text-zinc-400 text-[12px] px-2 py-2 border border-zinc-200 rounded">暂无分类型结果</div>`;
  return `<div class="space-y-2">
    ${entries.map(([type, rows]) => `
      <details class="rounded border border-zinc-200 bg-zinc-50" open>
        <summary class="px-2 py-1.5 flex items-center gap-2 text-[12px]">
          <span class="font-mono text-iris-600">${escapeHtml(type)}</span>
          <span class="ml-auto text-zinc-500">${rows.length}</span>
        </summary>
        <div class="border-t border-zinc-200 bg-white">${renderKeywordTopTable(rows, { compact: true })}</div>
      </details>`).join("")}
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
  // Session list is now rendered by loadSessions(), this function kept for compatibility
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
// Session history
// ─────────────────────────────────────────────
async function loadSessions() {
  try {
    const r = await getJson("/api/sessions/list");
    const list = $("#sessionList");
    if (!list) return;
    const currentId = state.sessionState?.sessionId;
    list.innerHTML = r.sessions.map(s => {
      const isActive = s.id === currentId;
      const activeClass = isActive ? "bg-iris-50 border-iris-200" : "border-transparent hover:bg-zinc-100";
      return `
        <div class="session-item p-2 rounded cursor-pointer border ${activeClass}"
             data-session-id="${s.id}"
             data-filename="${s.filename}">
          <div class="text-xs text-zinc-500">${new Date(s.timestamp).toLocaleString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>
          <div class="text-sm text-zinc-800 truncate">${escapeHtml(s.firstPrompt)}</div>
          <div class="text-xs text-zinc-400">${s.turnCount} turns · ${(s.size/1024).toFixed(1)} KB</div>
        </div>`;
    }).join("");
    list.querySelectorAll(".session-item").forEach(item => {
      item.addEventListener("click", async () => {
        const sessionId = item.dataset.sessionId;
        const filename = item.dataset.filename;
        try {
          await api("/api/switch_session", { sessionPath: filename });
          const msgs = await api("/api/sessions/messages", { sessionId });
          rebuildTurnsFromMessages(msgs.messages);
          await loadSessions();
          await refreshState();
        } catch (err) {
          console.error("switch session failed", err);
        }
      });
    });
  } catch (err) {
    console.error("load sessions failed", err);
  }
}

function rebuildTurnsFromMessages(messages) {
  state.turns.length = 0;
  state.toolsById.clear();
  state.toolsOrder.length = 0;
  for (const evt of messages) {
    if (evt.type === "message" && evt.message) {
      const role = evt.message.role;
      const content = evt.message.content || [];
      const text = content.map(c => c.text || "").join("");
      state.turns.push({
        id: evt.id,
        kind: role,
        parts: [{ kind: "text", text, id: evt.id }],
        status: "done",
        t0: new Date(evt.timestamp).getTime(),
        t1: new Date(evt.timestamp).getTime(),
      });
    }
  }
  state.metrics = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, toolCalls: 0 };
  renderAll();
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
