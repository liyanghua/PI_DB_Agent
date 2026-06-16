// store.mjs
// 极简事件总线 + 全局状态。
// state shape:
//   connection: { status, pid, model, thinking, cwd, error }
//   turns: ordered array
//     turn = { id, kind:'user'|'assistant', text, parts:[{kind:'text'|'thinking'|'tool', ...}], status, t0, t1 }
//   tools: Map<toolCallId, { id, name, args, status, result, isError, t0, t1 }>
//   metrics: { input, output, cacheRead, cacheWrite, cost, toolCalls }
//   sessionState: latest get_state response data
//   extPending: extension UI pending request

const listeners = new Set();

export const state = {
  connection: { status: "connecting", pid: null, model: null, thinking: null, cwd: null, error: null },
  turns: [],
  toolsById: new Map(),
  toolsOrder: [],
  metrics: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, toolCalls: 0 },
  sessionState: null,
  registry: null,
  extPending: null,
  streaming: false,
  diagnostics: [], // last 30 stderr / exit / spawn lines
  raw: [], // last 200 events, for debug
  upstreamErrors: [], // last 20 upstream model errors / retries (bridge → SSE)
  docViewTurnId: null, // 当不为 null 时显示全屏文档视图
  followBottom: true,  // 中间区是否自动追随到底
  inspectorTab: "trace", // trace | registry | upstream | raw
  rawFilter: "",  // 子串过滤 raw events
};

let pendingNotify = false;
function notify() {
  if (pendingNotify) return;
  pendingNotify = true;
  queueMicrotask(() => {
    pendingNotify = false;
    for (const fn of listeners) {
      try {
        fn(state);
      } catch (err) {
        console.error("listener error", err);
      }
    }
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function nextId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function pushRaw(evt) {
  state.raw.push({ at: Date.now(), evt });
  if (state.raw.length > 200) state.raw.splice(0, state.raw.length - 200);
}

function pushDiag(level, text) {
  if (!text) return;
  state.diagnostics.push({ at: Date.now(), level, text: String(text).slice(0, 2000) });
  if (state.diagnostics.length > 30) state.diagnostics.splice(0, state.diagnostics.length - 30);
}

function lastAssistantTurn() {
  for (let i = state.turns.length - 1; i >= 0; i--) {
    const t = state.turns[i];
    if (t.kind === "assistant") return t;
  }
  return null;
}

function ensureAssistantTurn() {
  let t = lastAssistantTurn();
  if (!t || t.status === "done" || t.status === "error" || t.status === "aborted") {
    t = {
      id: nextId("a"),
      kind: "assistant",
      parts: [],
      status: "running",
      t0: Date.now(),
      t1: null,
    };
    state.turns.push(t);
    state.streaming = true;
  }
  return t;
}

function getOrAppendPart(turn, kind, contentIndex) {
  let p = turn.parts.find((x) => x.kind === kind && x.contentIndex === contentIndex);
  if (!p) {
    p = { kind, contentIndex, text: "", id: nextId(kind), createdAt: Date.now() };
    turn.parts.push(p);
  }
  return p;
}

export function pushUserMessage(text) {
  state.turns.push({
    id: nextId("u"),
    kind: "user",
    text,
    status: "done",
    t0: Date.now(),
    t1: Date.now(),
    parts: [],
  });
  notify();
}

export function applyBridgeEvent(evt) {
  pushRaw(evt);
  switch (evt.kind) {
    case "ready": {
      state.connection.status = evt.ok ? "ready" : "error";
      state.connection.pid = evt.pid ?? null;
      state.connection.model = evt.model ?? state.connection.model;
      state.connection.thinking = evt.thinking ?? state.connection.thinking;
      state.connection.cwd = evt.cwd ?? state.connection.cwd;
      state.connection.error = evt.ok ? null : evt.error || "spawn failed";
      break;
    }
    case "hello": {
      const b = evt.bridge;
      if (b) {
        state.connection.pid = b.pid ?? state.connection.pid;
        state.connection.cwd = b.cwd ?? state.connection.cwd;
        state.connection.model = b.defaultModel ?? state.connection.model;
        state.connection.thinking = b.defaultThinking ?? state.connection.thinking;
        if (b.running && state.connection.status === "connecting") state.connection.status = "ready";
      }
      break;
    }
    case "exit": {
      state.connection.status = "exited";
      state.connection.pid = null;
      state.streaming = false;
      const t = lastAssistantTurn();
      if (t && t.status === "running") {
        t.status = "error";
        t.t1 = Date.now();
        t.error = `pi exited (code=${evt.code} signal=${evt.signal})`;
      }
      break;
    }
    case "stderr": {
      // shown only in raw debug
      break;
    }
    case "rpc_response": {
      // useful for surfacing failures of model/state probes
      break;
    }
    case "ext_ui_request": {
      state.extPending = evt.payload;
      break;
    }
    case "upstream_error": {
      const entry = {
        at: Date.now(),
        phase: evt.phase || "final",
        attempt: evt.attempt ?? null,
        maxAttempts: evt.maxAttempts ?? null,
        delayMs: evt.delayMs ?? null,
        errorMessage: evt.errorMessage || "",
        hint: evt.hint || null,
      };
      state.upstreamErrors.push(entry);
      if (state.upstreamErrors.length > 20) {
        state.upstreamErrors.splice(0, state.upstreamErrors.length - 20);
      }
      if (entry.phase === "final") {
        state.streaming = false;
        const t = lastAssistantTurn();
        if (t && t.status === "running") {
          t.status = "error";
          t.t1 = Date.now();
          t.error = entry.errorMessage;
          t.errorHint = entry.hint;
        }
      }
      break;
    }
    case "agent_event": {
      handleAgentEvent(evt.payload);
      break;
    }
    default:
      break;
  }
  notify();
}

function handleAgentEvent(ev) {
  if (!ev || !ev.type) return;
  switch (ev.type) {
    case "turn_start": {
      ensureAssistantTurn();
      break;
    }
    case "turn_end": {
      const t = lastAssistantTurn();
      if (t) {
        t.status = "done";
        t.t1 = Date.now();
      }
      state.streaming = false;
      break;
    }
    case "agent_end": {
      state.streaming = false;
      const t = lastAssistantTurn();
      if (t && t.status === "running") {
        t.status = "done";
        t.t1 = Date.now();
      }
      break;
    }
    case "message_start":
    case "message_end": {
      break;
    }
    case "message_update": {
      const ame = ev.assistantMessageEvent;
      if (!ame) return;
      const turn = ensureAssistantTurn();
      const idx = ame.contentIndex ?? 0;
      switch (ame.type) {
        case "text_start":
          getOrAppendPart(turn, "text", idx);
          break;
        case "text_delta": {
          const p = getOrAppendPart(turn, "text", idx);
          p.text += ame.delta || "";
          break;
        }
        case "text_end": {
          const p = getOrAppendPart(turn, "text", idx);
          p.text = ame.content || p.text;
          p.done = true;
          break;
        }
        case "thinking_start":
          getOrAppendPart(turn, "thinking", idx);
          break;
        case "thinking_delta": {
          const p = getOrAppendPart(turn, "thinking", idx);
          p.text += ame.delta || "";
          break;
        }
        case "thinking_end": {
          const p = getOrAppendPart(turn, "thinking", idx);
          p.text = ame.content || p.text;
          p.done = true;
          break;
        }
        case "toolcall_start":
        case "toolcall_delta":
        case "toolcall_end":
          // tool 真正的执行靠 tool_execution_*；这里只在 turn 上保留位次占位
          break;
        case "done":
        case "error":
          break;
        default:
          break;
      }
      break;
    }
    case "tool_execution_start": {
      const turn = ensureAssistantTurn();
      const tool = {
        id: ev.toolCallId,
        name: ev.toolName,
        args: ev.args,
        status: "running",
        t0: Date.now(),
        t1: null,
        result: null,
        isError: false,
      };
      state.toolsById.set(tool.id, tool);
      state.toolsOrder.push(tool.id);
      state.metrics.toolCalls++;
      turn.parts.push({ kind: "tool", id: tool.id, toolCallId: tool.id });
      break;
    }
    case "tool_execution_update": {
      const tool = state.toolsById.get(ev.toolCallId);
      if (tool) tool.partialResult = ev.partialResult;
      break;
    }
    case "tool_execution_end": {
      const tool = state.toolsById.get(ev.toolCallId);
      if (tool) {
        tool.status = ev.isError ? "error" : "ok";
        tool.isError = !!ev.isError;
        tool.result = ev.result;
        tool.t1 = Date.now();
        tool.details = extractDetailsFromResult(ev.result);
      }
      break;
    }
    case "session_info_changed": {
      if (state.sessionState) state.sessionState.sessionName = ev.name;
      break;
    }
    case "thinking_level_changed": {
      state.connection.thinking = ev.level;
      break;
    }
    case "compaction_start":
    case "compaction_end":
    case "auto_retry_start":
    case "auto_retry_end":
    case "queue_update":
      break;
    default:
      // unknown event types are kept in raw[]; UI may render them as RawEvent
      break;
  }
}

export function clearExtPending() {
  state.extPending = null;
  notify();
}

export function setSessionState(data) {
  state.sessionState = data;
  if (data?.model?.provider) {
    state.connection.model = `${data.model.provider}/${data.model.id || data.model.modelId || data.model.name || ""}`;
  } else if (data?.model) {
    state.connection.model = data.model.id || data.model.name || state.connection.model;
  }
  if (data?.thinkingLevel) state.connection.thinking = data.thinkingLevel;
  notify();
}

export function setRegistry(r) {
  state.registry = r;
  notify();
}

export function applySessionStats(stats) {
  if (!stats) return;
  state.metrics.input = stats.tokens?.input ?? state.metrics.input;
  state.metrics.output = stats.tokens?.output ?? state.metrics.output;
  state.metrics.cacheRead = stats.tokens?.cacheRead ?? state.metrics.cacheRead;
  state.metrics.cacheWrite = stats.tokens?.cacheWrite ?? state.metrics.cacheWrite;
  state.metrics.cost = stats.cost ?? state.metrics.cost;
  notify();
}

export function setStreaming(v) {
  state.streaming = v;
  notify();
}

export function setConnectionStatus(s, extra = {}) {
  state.connection.status = s;
  Object.assign(state.connection, extra);
  notify();
}

export function setDocViewTurn(id) {
  state.docViewTurnId = id;
  notify();
}

export function closeDocView() {
  state.docViewTurnId = null;
  notify();
}

export function setFollowBottom(v) {
  state.followBottom = !!v;
  // followBottom 不需要触发全量 render；调用方按需 notify
}

export function setInspectorTab(tab) {
  state.inspectorTab = tab;
  notify();
}

export function setRawFilter(q) {
  state.rawFilter = String(q || "");
  notify();
}

function extractDetailsFromResult(r) {
  if (!r) return null;
  if (typeof r === "object" && "details" in r) return r.details;
  if (typeof r === "object" && Array.isArray(r.content)) {
    const txt = r.content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
    try { return JSON.parse(txt); } catch { return txt; }
  }
  return r;
}