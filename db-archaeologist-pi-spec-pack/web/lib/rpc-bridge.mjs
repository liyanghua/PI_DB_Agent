// rpc-bridge.mjs
// 单 pi --mode rpc 子进程 + stdin 互斥写入 + stdout JSONL 解析 + Pub/Sub 广播。
// Pure Node builtins. No external deps.

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

const PI_BIN = process.env.PI_BIN || "pi";
const DEFAULT_MODEL = process.env.PI_DEFAULT_MODEL || ""; // e.g. aicodemirror/gpt-5.5
const DEFAULT_THINKING = process.env.PI_DEFAULT_THINKING || ""; // off|minimal|low|medium|high
const SPEC_PACK_ROOT = process.env.SPEC_PACK_ROOT || process.cwd();

class RpcBridge extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    this.child = null;
    this.pid = null;
    this.startedAt = null;
    this.exited = false;
    this.exitInfo = null;
    this.stdoutBuf = "";
    this.stderrBuf = "";
    this.pending = new Map(); // id -> {resolve, reject, command, t0}
    this.writeChain = Promise.resolve();
    this.spawnError = null;
    this.lastReady = null;
  }

  ensureSpawned() {
    if (this.child && !this.exited) return;
    this.exited = false;
    this.exitInfo = null;
    this.spawnError = null;
    this.stdoutBuf = "";
    this.stderrBuf = "";
    this.pending.clear();

    const args = ["--mode", "rpc"];
    if (DEFAULT_MODEL) args.push("--model", DEFAULT_MODEL);
    if (DEFAULT_THINKING) args.push("--thinking", DEFAULT_THINKING);

    let child;
    try {
      child = spawn(PI_BIN, args, {
        cwd: SPEC_PACK_ROOT,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      this.spawnError = err;
      this.emit("event", {
        kind: "ready",
        ok: false,
        error: String(err && err.message ? err.message : err),
      });
      return;
    }

    this.child = child;
    this.pid = child.pid;
    this.startedAt = Date.now();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => this.#onStdout(chunk));
    child.stderr.on("data", (chunk) => {
      this.stderrBuf += chunk;
      if (this.stderrBuf.length > 16 * 1024) {
        this.stderrBuf = this.stderrBuf.slice(-16 * 1024);
      }
      this.emit("event", { kind: "stderr", text: chunk });
    });
    child.on("exit", (code, signal) => {
      this.exited = true;
      this.exitInfo = { code, signal, at: Date.now() };
      for (const p of this.pending.values()) {
        p.reject(new Error(`pi rpc exited (code=${code} signal=${signal})`));
      }
      this.pending.clear();
      this.emit("event", { kind: "exit", code, signal });
      this.child = null;
    });
    child.on("error", (err) => {
      this.spawnError = err;
      this.emit("event", {
        kind: "ready",
        ok: false,
        error: String(err && err.message ? err.message : err),
      });
    });

    const ready = {
      kind: "ready",
      ok: true,
      pid: child.pid,
      cwd: SPEC_PACK_ROOT,
      model: DEFAULT_MODEL || null,
      thinking: DEFAULT_THINKING || null,
      bin: PI_BIN,
      startedAt: this.startedAt,
    };
    this.lastReady = ready;
    this.emit("event", ready);
  }

  #onStdout(chunk) {
    this.stdoutBuf += chunk;
    let nl;
    while ((nl = this.stdoutBuf.indexOf("\n")) >= 0) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      this.#dispatchLine(line);
    }
  }

  #dispatchLine(line) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      this.emit("event", { kind: "raw_garbage", line });
      return;
    }
    if (obj && obj.type === "response") {
      const id = obj.id;
      if (id && this.pending.has(id)) {
        const slot = this.pending.get(id);
        this.pending.delete(id);
        const elapsedMs = Date.now() - slot.t0;
        if (obj.success) slot.resolve({ ...obj, elapsedMs });
        else slot.reject(Object.assign(new Error(obj.error || "rpc error"), { rpc: obj, elapsedMs }));
      }
      this.emit("event", { kind: "rpc_response", payload: obj });
      return;
    }
    if (obj && obj.type === "extension_ui_request") {
      this.emit("event", { kind: "ext_ui_request", payload: obj });
      return;
    }
    this.emit("event", { kind: "agent_event", payload: obj });
    this.#deriveUpstreamError(obj);
  }

  /**
   * 把 pi RPC 的"上游 LLM 出错"信号提前冒泡，避免前端只能等到 60s timeout 才看到失败。
   * 触发点：
   *   - auto_retry_start：进入退避重试（信息提示）
   *   - agent_end + willRetry:false + 任一 message.stopReason=="error"：所有重试用尽，本回合失败
   *   - message_end + message.stopReason=="error" 且未在重试链中：单次连接失败（不会再有 text）
   */
  #deriveUpstreamError(obj) {
    if (!obj || typeof obj !== "object") return;
    const t = obj.type;
    if (t === "auto_retry_start") {
      this.emit("event", {
        kind: "upstream_error",
        phase: "retry",
        attempt: obj.attempt ?? null,
        maxAttempts: obj.maxAttempts ?? null,
        delayMs: obj.delayMs ?? null,
        errorMessage: obj.errorMessage || "",
      });
      return;
    }
    if (t === "agent_end" && obj.willRetry === false) {
      const errMsg = pickErrorMessage(obj.messages);
      if (errMsg) {
        this.emit("event", {
          kind: "upstream_error",
          phase: "final",
          errorMessage: errMsg,
          hint: classifyUpstreamError(errMsg),
        });
      }
    }
  }

  status() {
    return {
      running: !!this.child && !this.exited,
      pid: this.pid,
      startedAt: this.startedAt,
      exited: this.exited,
      exitInfo: this.exitInfo,
      lastReady: this.lastReady,
      spawnError: this.spawnError ? String(this.spawnError.message || this.spawnError) : null,
      defaultModel: DEFAULT_MODEL || null,
      defaultThinking: DEFAULT_THINKING || null,
      cwd: SPEC_PACK_ROOT,
      pendingCount: this.pending.size,
    };
  }

  /**
   * Send a JSONL command. Returns a Promise resolved with the matching response,
   * or rejected on rpc error / process exit.
   */
  send(command, opts = {}) {
    this.ensureSpawned();
    if (!this.child || this.exited) {
      return Promise.reject(new Error("pi rpc not running"));
    }
    const id = command.id || randomUUID();
    const payload = { ...command, id };
    const line = JSON.stringify(payload) + "\n";
    const t0 = Date.now();
    const timeoutMs = opts.timeoutMs ?? 60_000;

    const p = new Promise((resolve, reject) => {
      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            reject(new Error(`rpc timeout after ${timeoutMs}ms (command=${command.type})`));
          }
        }, timeoutMs);
        timer.unref?.();
      }
      this.pending.set(id, {
        t0,
        command: command.type,
        resolve: (v) => {
          if (timer) clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          if (timer) clearTimeout(timer);
          reject(e);
        },
      });
    });

    this.writeChain = this.writeChain.then(
      () =>
        new Promise((res) => {
          if (!this.child || !this.child.stdin.writable) {
            const slot = this.pending.get(id);
            if (slot) {
              this.pending.delete(id);
              slot.reject(new Error("pi stdin not writable"));
            }
            res();
            return;
          }
          this.child.stdin.write(line, (err) => {
            if (err) {
              const slot = this.pending.get(id);
              if (slot) {
                this.pending.delete(id);
                slot.reject(err);
              }
            }
            res();
          });
        }),
    );

    return p;
  }

  /** Fire-and-forget JSONL line (e.g. extension_ui_response which has no `id` ack). */
  writeRaw(obj) {
    this.ensureSpawned();
    if (!this.child || this.exited) return Promise.reject(new Error("pi rpc not running"));
    const line = JSON.stringify(obj) + "\n";
    this.writeChain = this.writeChain.then(
      () =>
        new Promise((res) => {
          if (!this.child || !this.child.stdin.writable) return res();
          this.child.stdin.write(line, () => res());
        }),
    );
    return this.writeChain;
  }

  shutdown() {
    if (!this.child || this.exited) return;
    try {
      this.child.stdin.end();
    } catch {}
    try {
      this.child.kill("SIGTERM");
    } catch {}
  }
}

let singleton = null;
export function getBridge() {
  if (!singleton) singleton = new RpcBridge();
  return singleton;
}

function pickErrorMessage(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.errorMessage) return String(m.errorMessage);
  }
  return "";
}

function classifyUpstreamError(text) {
  const s = String(text || "").toLowerCase();
  if (!s) return null;
  if (s.includes("connection error") || s.includes("getaddrinfo") || s.includes("enotfound") || s.includes("econnrefused")) {
    return "network_unreachable";
  }
  if (s.includes("401") || s.includes("unauthorized") || s.includes("invalid api key") || s.includes("invalid_api_key")) {
    return "auth_invalid";
  }
  if (s.includes("403") || s.includes("forbidden")) return "auth_forbidden";
  if (s.includes("429") || s.includes("rate limit")) return "rate_limited";
  if (s.includes("timeout") || s.includes("etimedout")) return "upstream_timeout";
  return "upstream_unknown";
}