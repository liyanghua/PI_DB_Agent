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

import "../scripts/ts_loader.mjs";
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

import { getBridge } from "./lib/rpc-bridge.mjs";
import { getSnapshot } from "./lib/registry-snapshot.mjs";
import { callInsight } from "./lib/insight-bridge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 4318);
const HOST = process.env.HOST || "0.0.0.0";

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
function runRebuild({ withIngest = false } = {}) {
  if (rebuildInflight) return rebuildInflight;
  const t0 = Date.now();
  const entry = withIngest ? "scripts/ingest_and_rebuild.ts" : "scripts/rebuild_all.ts";
  const args = ["--import", path.join(SPEC_PACK_ROOT, "scripts/ts_loader.mjs"), path.join(SPEC_PACK_ROOT, entry)];
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
      const withIngest = url.searchParams.get("with_ingest") === "1";
      const result = await runRebuild({ withIngest });
      const snap = await getSnapshot().catch(() => null);
      return sendJson(res, result.ok ? 200 : 500, {
        ok: result.ok,
        with_ingest: withIngest,
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

  if (route === "/api/sessions/list" && req.method === "GET") {
    try {
      const homeDir = os.homedir();
      const escapedCwd = SPEC_PACK_ROOT.replace(/\//g, "-").replace(/^-/, "");
      const sessionsDir = path.join(homeDir, ".pi/agent/sessions", `--${escapedCwd}--`);
      if (!existsSync(sessionsDir)) {
        return sendJson(res, 200, { sessions: [] });
      }
      const files = readdirSync(sessionsDir).filter(f => f.endsWith(".jsonl"));
      const sessions = [];
      for (const f of files) {
        const fullPath = path.join(sessionsDir, f);
        const st = statSync(fullPath);
        const firstLine = readFileSync(fullPath, "utf8").split("\n")[0];
        if (!firstLine.trim()) continue;
        let meta;
        try { meta = JSON.parse(firstLine); } catch { continue; }
        if (meta.type !== "session") continue;
        const lines = readFileSync(fullPath, "utf8").split("\n").filter(l => l.trim());
        const messages = lines.filter(l => {
          try { return JSON.parse(l).type === "message"; } catch { return false; }
        });
        let firstPrompt = "(empty)";
        for (const m of messages) {
          try {
            const parsed = JSON.parse(m);
            if (parsed.message?.role === "user") {
              const text = parsed.message.content?.[0]?.text || "";
              firstPrompt = text.slice(0, 60);
              break;
            }
          } catch {}
        }
        sessions.push({
          id: meta.id,
          timestamp: meta.timestamp,
          filename: f,
          turnCount: Math.floor(messages.length / 2),
          firstPrompt,
          size: st.size,
          mtime: st.mtime,
        });
      }
      sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return sendJson(res, 200, { sessions: sessions.slice(0, 20) });
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
  }

  if (route === "/api/insight/templates" && req.method === "GET") {
    try {
      const r = await callInsight("templates");
      return sendJson(res, 200, r);
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err), extra: err.extra ?? null });
    }
  }

  if (route === "/api/insight/list" && req.method === "GET") {
    try {
      const limit = Number(url.searchParams.get("limit") || 50);
      const r = await callInsight("list", { limit });
      return sendJson(res, 200, r);
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
  }

  if (route === "/api/insight/get" && req.method === "GET") {
    try {
      const planId = url.searchParams.get("plan_id") || "";
      if (!planId) return sendJson(res, 400, { error: "plan_id required" });
      const r = await callInsight("get", { plan_id: planId });
      return sendJson(res, 200, r);
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
  }

  if (route === "/api/keyword/runs" && req.method === "GET") {
    try {
      const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
      const category = url.searchParams.get("category") || "";
      const strategy = url.searchParams.get("strategy") || "";
      const kdsDir = path.join(SPEC_PACK_ROOT, "registry/derived/keyword_demand");
      if (!existsSync(kdsDir)) return sendJson(res, 200, { runs: [] });
      const entries = readdirSync(kdsDir);
      const runs = [];
      for (const entry of entries) {
        if (entry.startsWith("_")) continue;
        const metaPath = path.join(kdsDir, entry, "run.meta.json");
        if (!existsSync(metaPath)) continue;
        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf8"));
          if (category && meta.category !== category) continue;
          if (strategy && meta.strategy !== strategy) continue;
          runs.push({
            run_id: meta.run_id,
            strategy: meta.strategy,
            category: meta.category,
            category_id: meta.category_id,
            started_at: meta.started_at,
            elapsed_ms: meta.elapsed_ms,
            live_probe: meta.live_probe || false,
          });
        } catch {}
      }
      runs.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
      return sendJson(res, 200, { runs: runs.slice(0, limit) });
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
  }

  if (route.startsWith("/api/keyword/run/") && req.method === "GET") {
    try {
      const runId = route.replace("/api/keyword/run/", "");
      if (!runId) return sendJson(res, 400, { error: "run_id required" });
      const runDir = path.join(SPEC_PACK_ROOT, "registry/derived/keyword_demand", runId);
      if (!existsSync(runDir)) return sendJson(res, 404, { error: "run not found" });
      const metaPath = path.join(runDir, "run.meta.json");
      const summaryPath = path.join(runDir, "run_summary.md");
      if (!existsSync(metaPath)) return sendJson(res, 404, { error: "run.meta.json not found" });
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      let summary = "";
      if (existsSync(summaryPath)) summary = readFileSync(summaryPath, "utf8");
      return sendJson(res, 200, { run_id: runId, meta, summary });
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
  }

  if (route === "/api/keyword/compare" && req.method === "GET") {
    try {
      const runA = url.searchParams.get("a") || "";
      const runB = url.searchParams.get("b") || "";
      if (!runA || !runB) return sendJson(res, 400, { error: "a and b required" });
      const compareDir = path.join(SPEC_PACK_ROOT, "registry/derived/keyword_demand/_compare");
      if (!existsSync(compareDir)) return sendJson(res, 404, { error: "compare dir not found" });
      const candidates = [
        `compare_${runA}__${runB}.md`,
        `compare_${runB}__${runA}.md`,
      ];
      let found = null;
      for (const c of candidates) {
        const fp = path.join(compareDir, c);
        if (existsSync(fp)) { found = fp; break; }
      }
      if (!found) return sendJson(res, 404, { error: "compare report not found" });
      const report = readFileSync(found, "utf8");
      return sendJson(res, 200, { run_id_a: runA, run_id_b: runB, report });
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
  }

  if (route === "/api/competition/runs" && req.method === "GET") {
    try {
      const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
      const category = url.searchParams.get("category") || "";
      const strategy = url.searchParams.get("strategy") || "";
      const cpsDir = path.join(SPEC_PACK_ROOT, "registry/derived/keyword_analysis_pack/keyword_competition");
      if (!existsSync(cpsDir)) return sendJson(res, 200, { runs: [] });
      const entries = readdirSync(cpsDir);
      const runs = [];
      for (const entry of entries) {
        if (entry.startsWith("_")) continue;
        const metaPath = path.join(cpsDir, entry, "run.meta.json");
        if (!existsSync(metaPath)) continue;
        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf8"));
          if (category && meta.category !== category) continue;
          if (strategy && meta.strategy !== strategy) continue;
          runs.push({
            run_id: meta.run_id,
            strategy: meta.strategy,
            category: meta.category,
            category_id: meta.category_id,
            started_at: meta.started_at,
            elapsed_ms: meta.elapsed_ms,
            live_probe: meta.live_probe || false,
          });
        } catch {}
      }
      runs.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
      return sendJson(res, 200, { runs: runs.slice(0, limit) });
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
  }

  if (route.startsWith("/api/competition/run/") && req.method === "GET") {
    try {
      const runId = route.replace("/api/competition/run/", "");
      if (!runId) return sendJson(res, 400, { error: "run_id required" });
      const runDir = path.join(SPEC_PACK_ROOT, "registry/derived/keyword_analysis_pack/keyword_competition", runId);
      if (!existsSync(runDir)) return sendJson(res, 404, { error: "run not found" });
      const metaPath = path.join(runDir, "run.meta.json");
      const summaryPath = path.join(runDir, "run_summary.md");
      const reportPath = path.join(runDir, "cps_report.md");
      if (!existsSync(metaPath)) return sendJson(res, 404, { error: "run.meta.json not found" });
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      let summary = "";
      let report = "";
      if (existsSync(summaryPath)) summary = readFileSync(summaryPath, "utf8");
      if (existsSync(reportPath)) report = readFileSync(reportPath, "utf8");
      return sendJson(res, 200, { run_id: runId, meta, summary, report });
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
  }

  if (route === "/api/koif_routes/runs" && req.method === "GET") {
    try {
      const limit = Math.min(Number(url.searchParams.get("limit") || 20), 200);
      const category = url.searchParams.get("category") || "";
      const routesDir = path.join(SPEC_PACK_ROOT, "registry/koif_routes");
      if (!existsSync(routesDir)) return sendJson(res, 200, { runs: [] });
      const entries = readdirSync(routesDir);
      const runs = [];
      for (const entry of entries) {
        if (entry.startsWith("_")) continue;
        const metaPath = path.join(routesDir, entry, "router_meta.json");
        if (!existsSync(metaPath)) continue;
        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf8"));
          if (category && meta.category !== category) continue;
          runs.push({
            router_run_id: meta.router_run_id,
            category: meta.category,
            category_id: meta.category_id,
            router_version: meta.router_version,
            requested_capabilities: meta.requested_capabilities,
            started_at: meta.started_at,
            ended_at: meta.ended_at,
          });
        } catch {}
      }
      runs.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
      return sendJson(res, 200, { runs: runs.slice(0, limit) });
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
  }

  if (route.startsWith("/api/koif_routes/run/") && req.method === "GET") {
    try {
      const routerRunId = route.replace("/api/koif_routes/run/", "");
      if (!routerRunId) return sendJson(res, 400, { error: "router_run_id required" });
      const runDir = path.join(SPEC_PACK_ROOT, "registry/koif_routes", routerRunId);
      if (!existsSync(runDir)) return sendJson(res, 404, { error: "router run not found" });
      const metaPath = path.join(runDir, "router_meta.json");
      const scoreVectorPath = path.join(runDir, "score_vector.json");
      const routesPath = path.join(runDir, "strategy_routes.json");
      const actionsPath = path.join(runDir, "next_actions.json");
      const reportPath = path.join(runDir, "router_report.md");
      if (!existsSync(metaPath)) return sendJson(res, 404, { error: "router_meta.json not found" });
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      const score_vector = existsSync(scoreVectorPath) ? JSON.parse(readFileSync(scoreVectorPath, "utf8")) : [];
      const strategy_routes = existsSync(routesPath) ? JSON.parse(readFileSync(routesPath, "utf8")) : [];
      const next_actions = existsSync(actionsPath) ? JSON.parse(readFileSync(actionsPath, "utf8")) : [];
      const report_md = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "";
      return sendJson(res, 200, {
        router_run_id: routerRunId,
        meta,
        score_vector: score_vector.slice(0, 50),
        strategy_routes,
        next_actions,
        report_md,
      });
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
  }

  if (route.startsWith("/api/koif_routes/run/") && route.endsWith("/report") && req.method === "GET") {
    try {
      const routerRunId = route.replace("/api/koif_routes/run/", "").replace("/report", "");
      if (!routerRunId) return sendJson(res, 400, { error: "router_run_id required" });
      const reportPath = path.join(SPEC_PACK_ROOT, "registry/koif_routes", routerRunId, "router_report.md");
      if (!existsSync(reportPath)) return sendJson(res, 404, { error: "router_report.md not found" });
      const report = readFileSync(reportPath, "utf8");
      return sendJson(res, 200, { router_run_id: routerRunId, report });
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
  }

  if (route.startsWith("/api/koif_routes/run/") && route.endsWith("/actions") && req.method === "GET") {
    try {
      const routerRunId = route.replace("/api/koif_routes/run/", "").replace("/actions", "");
      if (!routerRunId) return sendJson(res, 400, { error: "router_run_id required" });
      const actionsPath = path.join(SPEC_PACK_ROOT, "registry/koif_routes", routerRunId, "next_actions.json");
      if (!existsSync(actionsPath)) return sendJson(res, 404, { error: "next_actions.json not found" });
      const next_actions = JSON.parse(readFileSync(actionsPath, "utf8"));
      return sendJson(res, 200, { router_run_id: routerRunId, next_actions });
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
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
      case "/api/insight/propose": {
        try {
          const topic = String(body.topic || "").trim();
          if (!topic) return sendJson(res, 400, { error: "topic required" });
          const args = {
            topic,
            template_key: body.template_key || undefined,
            candidate_limit: typeof body.candidate_limit === "number" ? body.candidate_limit : undefined,
            scope: body.scope || undefined,
          };
          const plan = await callInsight("propose", args);
          return sendJson(res, 200, plan);
        } catch (err) {
          return sendJson(res, 500, { error: String(err.message || err), extra: err.extra ?? null });
        }
      }
      case "/api/insight/save": {
        try {
          if (!body.plan || !body.plan.plan_id) return sendJson(res, 400, { error: "plan.plan_id required" });
          const r = await callInsight("save", { plan: body.plan });
          return sendJson(res, 200, r);
        } catch (err) {
          return sendJson(res, 500, { error: String(err.message || err) });
        }
      }
      case "/api/keyword/analyze": {
        try {
          const category = String(body.category || "").trim();
          if (!category) return sendJson(res, 400, { error: "category required" });
          const topN = Number(body.top_n ?? 10);
          const perDemandTypeTop = Number(body.per_demand_type_top ?? 5);
          const { analyzeKeywordDemand } = await import("../src/services/keyword_demand/index.js");
          const result = await analyzeKeywordDemand({
            category,
            category_id: body.category_id ? String(body.category_id).trim() : undefined,
            strategy: body.strategy ? String(body.strategy).trim() : "baseline_v1",
            live: !!body.live,
            top_n: Number.isFinite(topN) ? Math.max(1, Math.min(topN, 50)) : 10,
            per_demand_type_top: Number.isFinite(perDemandTypeTop) ? Math.max(1, Math.min(perDemandTypeTop, 20)) : 5,
            date_range: body.date_range && body.date_range.start_date && body.date_range.end_date
              ? { start_date: String(body.date_range.start_date), end_date: String(body.date_range.end_date) }
              : undefined,
          });
          if ("error" in result) return sendJson(res, 422, result);
          return sendJson(res, 200, result);
        } catch (err) {
          return sendJson(res, 500, { error: String(err.message || err) });
        }
      }
      case "/api/competition/analyze": {
        try {
          const category = String(body.category || "").trim();
          if (!category) return sendJson(res, 400, { error: "category required" });
          const topN = Number(body.top_n ?? 10);
          const { analyzeKeywordCompetition } = await import("../src/services/keyword_competition/index.js");
          const result = await analyzeKeywordCompetition({
            category,
            category_id: body.category_id ? String(body.category_id).trim() : undefined,
            strategy: body.strategy ? String(body.strategy).trim() : "baseline_v1",
            live: !!body.live,
            top_n: Number.isFinite(topN) ? Math.max(1, Math.min(topN, 50)) : 10,
            keyword_universe: Array.isArray(body.keyword_universe)
              ? body.keyword_universe.map((s) => String(s)).filter(Boolean)
              : undefined,
            date_range: body.date_range && body.date_range.start_date && body.date_range.end_date
              ? { start_date: String(body.date_range.start_date), end_date: String(body.date_range.end_date) }
              : undefined,
          });
          if ("error" in result) return sendJson(res, 422, result);
          return sendJson(res, 200, result);
        } catch (err) {
          return sendJson(res, 500, { error: String(err.message || err) });
        }
      }
      case "/api/koif_routes/propose": {
        try {
          const category = String(body.category || "").trim();
          if (!category) return sendJson(res, 400, { error: "category required" });
          const { proposeKoifStrategy } = await import("../src/services/koif_router/index.js");
          const result = await proposeKoifStrategy({
            category,
            category_id: body.category_id ? String(body.category_id).trim() : undefined,
            capabilities: body.capabilities || ["kds", "tms"],
            live: !!body.live,
            top_n: Number(body.top_n ?? 10),
          });
          if ("error" in result) return sendJson(res, 422, result);
          return sendJson(res, 200, result);
        } catch (err) {
          return sendJson(res, 500, { error: String(err.message || err) });
        }
      }
      case "/api/sessions/messages": {
        try {
          const sessionId = String(body.sessionId || "");
          if (!sessionId) return sendJson(res, 400, { error: "sessionId required" });
          const homeDir = os.homedir();
          const escapedCwd = SPEC_PACK_ROOT.replace(/\//g, "-").replace(/^-/, "");
          const sessionsDir = path.join(homeDir, ".pi/agent/sessions", `--${escapedCwd}--`);
          if (!existsSync(sessionsDir)) {
            return sendJson(res, 404, { error: "sessions dir not found" });
          }
          const files = readdirSync(sessionsDir).filter(f => f.includes(sessionId) && f.endsWith(".jsonl"));
          if (!files.length) return sendJson(res, 404, { error: "session not found" });
          const fullPath = path.join(sessionsDir, files[0]);
          const lines = readFileSync(fullPath, "utf8").split("\n").filter(l => l.trim());
          const messages = [];
          for (const line of lines) {
            try {
              const evt = JSON.parse(line);
              messages.push(evt);
            } catch {}
          }
          return sendJson(res, 200, { messages });
        } catch (err) {
          return sendJson(res, 500, { error: String(err.message || err) });
        }
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
