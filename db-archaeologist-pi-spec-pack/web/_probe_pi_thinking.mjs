// _probe_pi_thinking.mjs — 在沙箱外验证不同 thinking 级别下 pi 是否会回 text_delta。
//
// 用法（在 macOS Terminal.app / iTerm 内执行，**不**要在 Cursor 内置 shell）：
//   cd /Users/yichen/Desktop/OntologyBrain/PI_AGENT/db-archaeologist-pi-spec-pack
//   PI_CODING_AGENT_DIR="$(pwd)/.pi-home/agent" \
//   PI_THINKING=off \
//   node web/_probe_pi_thinking.mjs
//
// 也可以试 PI_THINKING=low / medium / high。脚本会：
//  1. spawn pi --mode rpc --model <PI_MODEL or aicodemirror/gpt-5.5> [--thinking <level>]
//  2. 发一个 prompt: "用一句话回答：1+1 等于多少？只输出数字。"
//  3. 在 25s 内统计 text_delta / thinking_delta / tool_use 数量
//  4. 退出码 0 表示拿到至少 1 个可见 text，1 表示没有

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadDotenv(file) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotenv(path.join(ROOT, ".env"));

const PI = process.env.PI_BIN || "pi";
const MODEL = process.env.PI_MODEL || "aicodemirror/gpt-5.5";
const THINKING = process.env.PI_THINKING || "off";
const PROMPT = process.env.PI_PROBE_PROMPT || "用一句话回答：1+1 等于多少？只输出数字。";
const TIMEOUT_MS = Number(process.env.PI_PROBE_TIMEOUT_MS || 25000);

const args = ["--mode", "rpc", "--model", MODEL];
if (THINKING) args.push("--thinking", THINKING);

console.log(`[probe] spawn ${PI} ${args.join(" ")}  cwd=${ROOT}`);
const child = spawn(PI, args, { cwd: ROOT, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
console.log(`[probe] pid ${child.pid}  thinking=${THINKING}  model=${MODEL}`);

const stats = {
  text_delta: 0,
  text_chars: 0,
  thinking_delta: 0,
  toolcall_start: 0,
  upstream_error: 0,
  retries: 0,
};
let textBuf = "";
let stdoutBuf = "";
const startedAt = Date.now();

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");

child.stdout.on("data", (chunk) => {
  stdoutBuf += chunk;
  let nl;
  while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
    const line = stdoutBuf.slice(0, nl);
    stdoutBuf = stdoutBuf.slice(nl + 1);
    if (!line.trim()) continue;
    let parsed = null;
    try { parsed = JSON.parse(line); } catch {}
    if (!parsed) continue;
    const dt = Date.now() - startedAt;
    if (parsed.type === "message_update" && parsed.assistantMessageEvent) {
      const ame = parsed.assistantMessageEvent;
      switch (ame.type) {
        case "text_delta":
          stats.text_delta++;
          stats.text_chars += (ame.delta || "").length;
          textBuf += ame.delta || "";
          break;
        case "thinking_delta":
          stats.thinking_delta++;
          break;
        case "toolcall_start":
          stats.toolcall_start++;
          console.log(`[+${dt}ms] toolcall_start name=${ame.name || ame.toolName || "?"}`);
          break;
      }
    } else if (parsed.type === "auto_retry_start") {
      stats.retries++;
      console.log(`[+${dt}ms] auto_retry_start attempt=${parsed.attempt}/${parsed.maxAttempts} delay=${parsed.delayMs}ms err="${parsed.errorMessage || ""}"`);
    } else if (parsed.type === "agent_end" && parsed.willRetry === false) {
      const errMsg = pickErr(parsed.messages);
      if (errMsg) {
        stats.upstream_error++;
        console.log(`[+${dt}ms] agent_end final-error err="${errMsg}"`);
      }
    } else if (parsed.type === "turn_end") {
      console.log(`[+${dt}ms] turn_end`);
    }
  }
});

function pickErr(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.errorMessage) return String(m.errorMessage);
  }
  return "";
}

child.stderr.on("data", (chunk) => process.stderr.write(`[stderr] ${chunk}`));
child.on("exit", (code, signal) => {
  console.log(`\n[probe] child exit code=${code} signal=${signal} after=${Date.now() - startedAt}ms`);
  finishAndExit();
});

setTimeout(() => {
  const cmd = { id: "p1", type: "prompt", message: PROMPT };
  console.log(`[probe] >>> prompt ${JSON.stringify(PROMPT)}`);
  child.stdin.write(JSON.stringify(cmd) + "\n");
}, 1500);

setTimeout(() => {
  console.log("[probe] timeout, killing child");
  try { child.kill("SIGTERM"); } catch {}
  setTimeout(finishAndExit, 500);
}, TIMEOUT_MS);

function finishAndExit() {
  console.log("\n[probe] summary");
  console.log("  thinking         =", THINKING);
  console.log("  text_delta count =", stats.text_delta);
  console.log("  text_chars       =", stats.text_chars);
  console.log("  thinking_delta   =", stats.thinking_delta);
  console.log("  toolcall_start   =", stats.toolcall_start);
  console.log("  retries          =", stats.retries);
  console.log("  upstream_error   =", stats.upstream_error);
  console.log("  text preview     =", JSON.stringify(textBuf.slice(0, 120)));
  if (stats.text_delta > 0) {
    console.log("[probe] PASS — saw visible text from upstream");
    process.exit(0);
  } else if (stats.upstream_error > 0) {
    console.log("[probe] FAIL — upstream error, no text");
    process.exit(2);
  } else {
    console.log("[probe] FAIL — no text_delta within budget; codex/proxy 可能只回了 reasoning channel");
    process.exit(1);
  }
}