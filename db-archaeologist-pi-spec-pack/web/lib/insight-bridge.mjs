// insight-bridge.mjs
// 通过 spawn 跑 scripts/insight_cli.ts，把 stdin/stdout 当作单次 RPC。
// 与 rebuild 流水线一致的进程模型：避免 mjs 直接 import .ts。

import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = process.env.SPEC_PACK_ROOT || process.cwd();
const ENTRY = path.join(ROOT, "scripts/insight_cli.ts");
const LOADER = path.join(ROOT, "scripts/ts_loader.mjs");
const TIMEOUT_MS = 30_000;

export async function callInsight(cmd, args = {}) {
  const reqJson = JSON.stringify({ cmd, args });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", LOADER, ENTRY], {
      cwd: ROOT,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error(`insight cli timeout after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const lastLine = out.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      if (!lastLine) {
        return reject(new Error(`insight cli no output (exit=${code}); stderr=${err.slice(-500)}`));
      }
      try {
        const parsed = JSON.parse(lastLine);
        if (parsed.ok) return resolve(parsed.payload);
        return reject(Object.assign(new Error(parsed.error || "insight cli failed"), { extra: parsed.extra, stderr: err.slice(-500) }));
      } catch (e) {
        reject(new Error(`insight cli bad json: ${e.message}; raw=${lastLine.slice(0, 500)}`));
      }
    });
    child.stdin.end(reqJson);
  });
}