// Insight planner CLI bridge (used by web/server.mjs via spawn).
// Reads JSON from stdin: { cmd: "propose"|"templates"|"list"|"get"|"save", args: {...} }
// Writes one JSON line to stdout (single object).

import path from "node:path";
import fs from "node:fs";
import { proposeInsightPlan, listInsightTemplates } from "../src/tools/propose_insight_plan.js";

const ROOT = process.env.SPEC_PACK_ROOT || process.cwd();
const PLANS_DIR = path.join(ROOT, "registry/derived/insight_plans");

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { buf += c; });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

function writeOk(payload: unknown): void {
  process.stdout.write(JSON.stringify({ ok: true, payload }) + "\n");
}
function writeErr(msg: string, extra?: unknown): void {
  process.stdout.write(JSON.stringify({ ok: false, error: msg, extra }) + "\n");
}

function ensureDir(): void {
  fs.mkdirSync(PLANS_DIR, { recursive: true });
}

function listPlans(limit = 50): unknown[] {
  if (!fs.existsSync(PLANS_DIR)) return [];
  const files = fs.readdirSync(PLANS_DIR).filter(f => f.endsWith(".json"));
  const items = files.map(f => {
    const fp = path.join(PLANS_DIR, f);
    const st = fs.statSync(fp);
    let plan: { plan_id?: string; topic?: string; template_key?: string; template_cn_name?: string; created_at?: string; coverage_report?: { coverage_pct?: number } } = {};
    try { plan = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { /* corrupt */ }
    return {
      filename: f,
      plan_id: plan.plan_id,
      topic: plan.topic,
      template_key: plan.template_key,
      template_cn_name: plan.template_cn_name,
      created_at: plan.created_at,
      coverage_pct: plan.coverage_report?.coverage_pct,
      mtime: st.mtimeMs,
      size: st.size,
    };
  });
  items.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  return items.slice(0, limit);
}

function getPlan(planId: string): unknown {
  if (!fs.existsSync(PLANS_DIR)) throw new Error("plans dir not found");
  const files = fs.readdirSync(PLANS_DIR).filter(f => f.includes(planId) && f.endsWith(".json"));
  if (files.length === 0) throw new Error(`plan_id not found: ${planId}`);
  return JSON.parse(fs.readFileSync(path.join(PLANS_DIR, files[0]), "utf8"));
}

function savePlan(plan: { plan_id?: string }): { path: string; plan_id: string } {
  if (!plan || typeof plan !== "object" || !plan.plan_id) {
    throw new Error("save: plan.plan_id is required");
  }
  ensureDir();
  const fp = path.join(PLANS_DIR, `${plan.plan_id}.json`);
  fs.writeFileSync(fp, JSON.stringify(plan, null, 2));
  return { path: fp, plan_id: plan.plan_id };
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let req: { cmd?: string; args?: Record<string, unknown> } = {};
  try {
    req = raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    writeErr(`bad stdin json: ${(e as Error).message}`);
    process.exit(2);
    return;
  }
  const cmd = req.cmd ?? "propose";
  const args = (req.args ?? {}) as Record<string, unknown>;

  try {
    switch (cmd) {
      case "templates":
        writeOk({ templates: listInsightTemplates() });
        return;
      case "propose": {
        const plan = proposeInsightPlan(args as Parameters<typeof proposeInsightPlan>[0]);
        writeOk(plan);
        return;
      }
      case "list":
        writeOk({ plans: listPlans(typeof args.limit === "number" ? args.limit : 50) });
        return;
      case "get":
        writeOk(getPlan(String(args.plan_id ?? "")));
        return;
      case "save":
        writeOk(savePlan(args.plan as { plan_id?: string }));
        return;
      default:
        writeErr(`unknown cmd: ${cmd}`);
        process.exit(2);
    }
  } catch (e) {
    writeErr(String((e as Error)?.message ?? e), { available_templates: listInsightTemplates() });
    process.exit(1);
  }
}

await main();