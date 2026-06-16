// server.mjs
// 单进程 Node http BFF：
//   - 静态托管 web/public
//   - GET  /api/stream            SSE 长连，广播 pi rpc 事件
//   - POST /api/prompt            { message } -> RPC prompt
//   - POST /api/abort             RPC abort
//   - POST /api/new_session       RPC new_session
//   - POST /api/switch_session    RPC switch_session { sessionPath }
//   - POST /api/set_model         RPC set_model { provider, modelId }
//   - POST /api/set_thinking      RPC set_thinking_level { level }
//   - POST /api/ext_ui_response   raw stdin write，回 extension UI 请求
//   - POST /api/get_state         RPC get_state
//   - POST /api/get_session_stats RPC get_session_stats
//   - GET  /api/registry          spec-pack 派生产物快照
//   - GET  /api/health            进程状态
//
// 零外部依赖，仅 Node builtins。

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getBridge } from "./lib/rpc-bridge.mjs";
import { getSnapshot } from "./lib/registry-snapshot.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || "127.0.0.1";

// 自动 source spec-pack/.env（如果存在）。这样 AICODEMIRROR_API_KEY 等无需手动 export。
const SPEC_PACK_ROOT = process.env.SPEC_PACK_ROOT || path.resolve(__dirname, "..");
process.env.SPEC_PACK_ROOT = SPEC_PACK_ROOT;
loadDotenv(path.join(SPEC_PACK_ROOT, ".env"));
loadDotenv(path.join(__dirname, ".env"));

function loadDotenv(file) {
  if (!existsSync(file)) return;
  const txt = readFileSync(file, "utf8");
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

const bridge = getBridge();
const sseClients = new Set();

bridge.on("event", (evt) => {
  for (const client of sseClients) sendSse(client, evt);
});

function sendSse(res, evt) {
  if (res.writableEnded) return;
  const name = evt.kind || "message";
  let payload;
  try {
    payload = JSON.stringify(evt);
  } catch {
    payload = JSON.stringify({ kind: "raw_garbage", error: "unserializable" });
  }
  res.write(`event: ${name}\n`);
  res.write(`data: ${payload}\n\n`);
}

setInterval(() => {
  for (const c of sseClients) {
    if (!c.writableEnded) {
      c.write(`event: heartbeat\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);
    }
  }
}, 15_000).unref();

async function readJsonBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (chunk) => {
      buf += chunk;
      if (buf.length > limit) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!buf) return resolve({});
      try {
        resolve(JSON.parse(buf));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

let rebuildInflight = null;
function runRebuild() {
  if (rebuildInflight) return rebuildInflight;
  const t0 = Date.now();
  const args = ["--import", path.join(SPEC_PACK_ROOT, "scripts/ts_loader.mjs"), path.join(SPEC_PACK_ROOT, "scripts/rebuild_all.ts")];
  rebuildInflight = new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: SPEC_PACK_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      out += c;
      if (out.length > 16 * 1024) out = out.slice(-16 * 1024);
      process.stdout.write(`[rebuild] ${c}`);
    });
    child.stderr.on("data", (c) => {
      err += c;
      if (err.length > 16 * 1024) err = err.slice(-16 * 1024);
      process.stderr.write(`[rebuild] ${c}`);
    });
    child.on("exit", (code, signal) => {
      const ok = code === 0 && !signal;
      const elapsedMs = Date.now() - t0;
      const tail = (ok ? out : (err || out)).split(/\r?\n/).filter(Boolean).slice(-30).join("\n");
      resolve({ ok, elapsedMs, tail, code, signal });
    });
    child.on("error", (e) => {
      const elapsedMs = Date.now() - t0;
      resolve({ ok: false, elapsedMs, tail: String(e?.message ?? e), code: null, signal: null });
    });
  });
  rebuildInflight.finally(() => { rebuildInflight = null; });
  return rebuildInflight;
}

async function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/" || rel === "") rel = "/index.html";
  const fp = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!fp.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const st = await stat(fp);
    if (st.isDirectory()) {
      const idx = path.join(fp, "index.html");
      const buf = await readFile(idx);
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(buf);
      return;
    }
    const ext = path.extname(fp).toLowerCase();
    const buf = await readFile(fp);
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

async function handleApi(req, res, url) {
  const route = url.pathname;

  if (route === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, bridge: bridge.status() });
  }

  if (route === "/api/registry" && req.method === "GET") {
    try {
      const snap = await getSnapshot();
      return sendJson(res, 200, snap);
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
  }

  if (route === "/api/registry/refresh" && (req.method === "POST" || req.method === "GET")) {
    try {
      const result = await runRebuild();
      const snap = await getSnapshot().catch(() => null);
      return sendJson(res, result.ok ? 200 : 500, {
        ok: result.ok,
        elapsed_ms: result.elapsedMs,
        report: result.tail,
        snapshot: snap,
      });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String(err.message || err) });
    }
  }

  if (route === "/api/stream" && req.method === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    });
    res.write(":\n\n");
    bridge.ensureSpawned();
    sendSse(res, { kind: "hello", t: Date.now(), bridge: bridge.status() });
    if (bridge.lastReady) sendSse(res, bridge.lastReady);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "method not allowed" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: `bad json: ${err.message}` });
  }

  try {
    switch (route) {
      case "/api/prompt": {
        const message = String(body.message || "").trim();
        if (!message) return sendJson(res, 400, { error: "message required" });
        const r = await bridge.send({
          type: "prompt",
          message,
          streamingBehavior: body.streamingBehavior || "followUp",
        });
        return sendJson(res, 200, r);
      }
      case "/api/steer": {
        const message = String(body.message || "").trim();
        if (!message) return sendJson(res, 400, { error: "message required" });
        const r = await bridge.send({ type: "steer", message });
        return sendJson(res, 200, r);
      }
      case "/api/abort": {
        const r = await bridge.send({ type: "abort" });
        return sendJson(res, 200, r);
      }
      case "/api/new_session": {
        const r = await bridge.send({ type: "new_session" });
        return sendJson(res, 200, r);
      }
      case "/api/switch_session": {
        const sessionPath = String(body.sessionPath || "");
        if (!sessionPath) return sendJson(res, 400, { error: "sessionPath required" });
        const r = await bridge.send({ type: "switch_session", sessionPath });
        return sendJson(res, 200, r);
      }
      case "/api/get_state": {
        const r = await bridge.send({ type: "get_state" });
        return sendJson(res, 200, r);
      }
      case "/api/get_session_stats": {
        const r = await bridge.send({ type: "get_session_stats" });
        return sendJson(res, 200, r);
      }
      case "/api/get_messages": {
        const r = await bridge.send({ type: "get_messages" });
        return sendJson(res, 200, r);
      }
      case "/api/get_commands": {
        const r = await bridge.send({ type: "get_commands" });
        return sendJson(res, 200, r);
      }
      case "/api/get_available_models": {
        const r = await bridge.send({ type: "get_available_models" });
        return sendJson(res, 200, r);
      }
      case "/api/set_model": {
        const provider = String(body.provider || "");
        const modelId = String(body.modelId || "");
        if (!provider || !modelId) return sendJson(res, 400, { error: "provider/modelId required" });
        const r = await bridge.send({ type: "set_model", provider, modelId });
        return sendJson(res, 200, r);
      }
      case "/api/set_thinking": {
        const level = String(body.level || "");
        if (!level) return sendJson(res, 400, { error: "level required" });
        const r = await bridge.send({ type: "set_thinking_level", level });
        return sendJson(res, 200, r);
      }
      case "/api/ext_ui_response": {
        await bridge.writeRaw({ type: "extension_ui_response", ...body });
        return sendJson(res, 200, { ok: true });
      }
      default:
        return sendJson(res, 404, { error: "no such api" });
    }
  } catch (err) {
    return sendJson(res, 500, { error: String(err.message || err), rpc: err.rpc });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((err) => {
      sendJson(res, 500, { error: String(err.message || err) });
    });
    return;
  }
  serveStatic(req, res).catch((err) => {
    res.writeHead(500);
    res.end(String(err.message || err));
  });
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[db-arch-web] listening on http://${HOST}:${PORT}  cwd=${SPEC_PACK_ROOT}`);
  bridge.ensureSpawned();
});

function shutdown() {
  bridge.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);