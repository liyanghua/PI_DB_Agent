// _probe_rpc.mjs — 复现 web 后端的 spawn 行为，看 prompt ack 多久回，以及是否有别的输出
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

console.log("[probe] spawn", PI, "--mode rpc --model", MODEL, "cwd=", ROOT);
const child = spawn(PI, ["--mode", "rpc", "--model", MODEL], { cwd: ROOT, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
console.log("[probe] pid", child.pid);

let stdoutBuf = "";
let lineCount = 0;
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
    lineCount++;
    const dt = Date.now() - startedAt;
    let parsed = null;
    try { parsed = JSON.parse(line); } catch {}
    if (parsed) {
      const tag = parsed.type || "(no type)";
      const sub = parsed.event || parsed.command || parsed.method || "";
      const interesting = ["agent_end", "auto_retry_start", "message_end", "response", "error", "tool_execution_end"].includes(tag);
      const tail = interesting ? " · " + JSON.stringify(parsed).slice(0, 600) : "";
      console.log(`[+${String(dt).padStart(5,' ')}ms #${lineCount}] ${tag} ${sub}${tail}`);
    } else {
      console.log(`[+${String(dt).padStart(5,' ')}ms #${lineCount}] RAW`, line.slice(0, 200));
    }
  }
});
child.stderr.on("data", (chunk) => {
  const dt = Date.now() - startedAt;
  process.stdout.write(`[+${String(dt).padStart(5,' ')}ms STDERR] ${chunk}`);
});
child.on("exit", (code, signal) => {
  console.log(`[probe] child exit code=${code} signal=${signal} after=${Date.now()-startedAt}ms`);
});
child.on("error", (err) => console.log("[probe] spawn error", err.message));

// 给 pi 几秒钟启动，然后发 prompt
setTimeout(() => {
  const cmd = { id: "p1", type: "get_state" };
  console.log("[probe] >>> send get_state");
  child.stdin.write(JSON.stringify(cmd) + "\n");
}, 1500);

setTimeout(() => {
  const cmd = { id: "p2", type: "prompt", message: "1+1=?" };
  console.log("[probe] >>> send prompt 1+1=?");
  child.stdin.write(JSON.stringify(cmd) + "\n");
}, 4000);

setTimeout(() => {
  console.log("[probe] timeout, killing child");
  try { child.kill("SIGTERM"); } catch {}
  setTimeout(() => process.exit(0), 500);
}, 25000);