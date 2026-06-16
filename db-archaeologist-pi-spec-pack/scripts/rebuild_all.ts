// rebuild_all.ts — 一键重建派生产物。
//
// pipeline 顺序：
//   S0  snapshot:prev    cp api_asset_cards.json → api_asset_cards.prev.json（首次为空跳过）
//   S1  extract:detail   sources/api_docs → registry/derived/api_details.raw.json
//   S2  extract:index    sources/api_docs → registry/seed/api_index_seed.json
//   S3  build:cards      → registry/derived/api_asset_cards.json + cards_build_report.md
//   S4  source:diff      cards.prev vs cards → registry/derived/source_diff_report.md（不阻塞）
//   S5  build:tools      → tool_registry.yaml + tool_blocked.yaml + tool_build_report.md
//   S6  build:kg         → kg_nodes.jsonl + kg_edges.jsonl + kg_build_report.md
//   S7  promote:plan     → promotion_plan.{json,md}
//   S8  test:golden      失败即 exit 1（除非 SKIP_GOLDEN=1）
//
// 任意阶段失败立即终止；最终写 registry/derived/rebuild_report.md。
//
// 调用方式：node --import ./scripts/ts_loader.mjs scripts/rebuild_all.ts
// 环境变量：
//   SKIP_GOLDEN=1     跳过 golden 回归
//   SKIP_EXTRACT=1    跳过 extract:detail
//   SKIP_INDEX=1      跳过 extract:index（沿用现有 api_index_seed.json）
//   SKIP_DIFF=1       跳过 source:diff
//   SKIP_PROMOTION=1  跳过 promote:plan

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { writeText } from "../src/lib/io.js";

type StageStatus = "ok" | "failed" | "skipped";
type StageResult = {
  name: string;
  cmd: string[];
  status: StageStatus;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutTail: string;
  stderrTail: string;
};

const ROOT = process.cwd();

const NODE_BIN = process.execPath;
const TS_LOADER = path.join(ROOT, "scripts/ts_loader.mjs");

type Stage = {
  name: string;
  args?: string[]; // child-process stage：传给 ts_loader 的参数
  inline?: () => Promise<{ note?: string }>; // in-process stage（如 cp 快照）
  skipEnv?: string;
  optional?: boolean; // 失败仅 WARN 不终止
};

const STAGES: Stage[] = [
  { name: "snapshot:prev",  inline: snapshotPrev },
  { name: "extract:detail", args: ["src/extractors/markdown_detail_extractor.ts"], skipEnv: "SKIP_EXTRACT" },
  { name: "extract:index",  args: ["src/extractors/markdown_api_extractor.ts"],    skipEnv: "SKIP_INDEX" },
  { name: "build:cards",    args: ["src/pipelines/build_cards.ts"] },
  { name: "source:diff",    args: ["scripts/source_diff.ts"], skipEnv: "SKIP_DIFF", optional: true },
  { name: "build:tools",    args: ["src/pipelines/build_tools.ts"] },
  { name: "build:kg",       args: ["src/pipelines/build_kg.ts"] },
  { name: "promote:plan",   args: ["scripts/build_promotion_plan.ts"], skipEnv: "SKIP_PROMOTION" },
  { name: "test:golden",    args: ["--test", "tests/golden.test.ts"], skipEnv: "SKIP_GOLDEN" },
];

async function snapshotPrev(): Promise<{ note?: string }> {
  const curr = path.join(ROOT, "registry/derived/api_asset_cards.json");
  const prev = path.join(ROOT, "registry/derived/api_asset_cards.prev.json");
  if (!fs.existsSync(curr)) {
    return { note: "no current cards; skip" };
  }
  fs.copyFileSync(curr, prev);
  const size = fs.statSync(prev).size;
  return { note: `${prev} (${size}B)` };
}

function runChildStage(stage: Stage): Promise<StageResult> {
  const cmd = [NODE_BIN, "--import", TS_LOADER, ...(stage.args ?? [])];
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd[0]!, cmd.slice(1), {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => { out += c; process.stdout.write(c); });
    child.stderr.on("data", (c) => { err += c; process.stderr.write(c); });
    child.on("exit", (code, signal) => {
      const ok = code === 0 && !signal;
      resolve({
        name: stage.name,
        cmd: stage.args ?? [],
        status: ok ? "ok" : "failed",
        durationMs: Date.now() - t0,
        exitCode: code,
        signal,
        stdoutTail: tail(out, 800),
        stderrTail: tail(err, 800),
      });
    });
    child.on("error", (e) => {
      resolve({
        name: stage.name,
        cmd: stage.args ?? [],
        status: "failed",
        durationMs: Date.now() - t0,
        exitCode: null,
        signal: null,
        stdoutTail: "",
        stderrTail: String(e?.message ?? e),
      });
    });
  });
}

async function runInlineStage(stage: Stage): Promise<StageResult> {
  const t0 = Date.now();
  try {
    const r = await stage.inline!();
    if (r.note) console.log(`[rebuild] ${stage.name}: ${r.note}`);
    return {
      name: stage.name,
      cmd: ["<inline>"],
      status: "ok",
      durationMs: Date.now() - t0,
      exitCode: 0,
      signal: null,
      stdoutTail: r.note ?? "",
      stderrTail: "",
    };
  } catch (e: any) {
    return {
      name: stage.name,
      cmd: ["<inline>"],
      status: "failed",
      durationMs: Date.now() - t0,
      exitCode: null,
      signal: null,
      stdoutTail: "",
      stderrTail: String(e?.stack ?? e?.message ?? e),
    };
  }
}

function tail(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : "…" + s.slice(-n);
}

function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function readSummaryFile(rel: string): string | null {
  try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { return null; }
}

function extractTopLines(content: string | null, n = 6): string {
  if (!content) return "(missing)";
  return content.split(/\r?\n/).filter((l) => l.trim()).slice(0, n).map((l) => `  ${l}`).join("\n");
}

async function main() {
  const startedAt = new Date();
  const results: StageResult[] = [];
  let stoppedAt: string | null = null;

  for (const stage of STAGES) {
    if (stage.skipEnv && process.env[stage.skipEnv] === "1") {
      results.push({
        name: stage.name,
        cmd: stage.args ?? ["<inline>"],
        status: "skipped",
        durationMs: 0,
        exitCode: 0,
        signal: null,
        stdoutTail: "",
        stderrTail: "",
      });
      console.log(`\n[rebuild] skip ${stage.name} (env ${stage.skipEnv}=1)`);
      continue;
    }
    console.log(`\n[rebuild] ▶ ${stage.name}`);
    const r = stage.inline ? await runInlineStage(stage) : await runChildStage(stage);
    results.push(r);
    console.log(`[rebuild] ${r.status === "ok" ? "✓" : "✗"} ${stage.name}  ${fmtMs(r.durationMs)}`);
    if (r.status === "failed") {
      if (stage.optional) {
        console.warn(`[rebuild] ${stage.name} failed but is optional; continuing`);
        continue;
      }
      stoppedAt = stage.name;
      break;
    }
  }

  const finishedAt = new Date();
  const totalMs = finishedAt.getTime() - startedAt.getTime();
  const ok = !stoppedAt;

  const cardsReport = readSummaryFile("registry/derived/cards_build_report.md");
  const toolsReport = readSummaryFile("registry/derived/tool_build_report.md");
  const kgReport    = readSummaryFile("registry/derived/kg_build_report.md");
  const diffReport  = readSummaryFile("registry/derived/source_diff_report.md");

  const lines: string[] = [];
  lines.push("# Rebuild Report");
  lines.push("");
  lines.push(`Started: ${startedAt.toISOString()}`);
  lines.push(`Finished: ${finishedAt.toISOString()}`);
  lines.push(`Total: ${fmtMs(totalMs)}`);
  lines.push(`Result: ${ok ? "OK" : `FAILED at ${stoppedAt}`}`);
  lines.push("");
  lines.push("## Stages");
  for (const r of results) {
    const tag = r.status === "ok" ? "✓" : r.status === "skipped" ? "○" : "✗";
    lines.push(`- ${tag} ${r.name} · ${fmtMs(r.durationMs)}${r.exitCode !== 0 && r.status !== "skipped" ? ` (exit=${r.exitCode}${r.signal ? `, signal=${r.signal}` : ""})` : ""}`);
  }
  if (!ok) {
    const failed = results.find((r) => r.status === "failed");
    if (failed) {
      lines.push("");
      lines.push(`## Failure · ${failed.name}`);
      if (failed.stderrTail) {
        lines.push("");
        lines.push("### stderr (tail)");
        lines.push("```");
        lines.push(failed.stderrTail);
        lines.push("```");
      }
      if (failed.stdoutTail) {
        lines.push("");
        lines.push("### stdout (tail)");
        lines.push("```");
        lines.push(failed.stdoutTail);
        lines.push("```");
      }
    }
  } else {
    lines.push("");
    lines.push("## Summaries");
    lines.push("");
    lines.push("### cards");
    lines.push(extractTopLines(cardsReport));
    lines.push("");
    lines.push("### tools");
    lines.push(extractTopLines(toolsReport));
    lines.push("");
    lines.push("### kg");
    lines.push(extractTopLines(kgReport));
    if (diffReport) {
      lines.push("");
      lines.push("### source diff");
      lines.push(extractTopLines(diffReport, 8));
    }
  }

  writeText(path.join(ROOT, "registry/derived/rebuild_report.md"), lines.join("\n") + "\n");

  console.log("");
  console.log("=".repeat(60));
  console.log(`[rebuild] ${ok ? "OK" : "FAILED"} in ${fmtMs(totalMs)}  →  registry/derived/rebuild_report.md`);
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error("[rebuild] fatal:", err?.stack || err);
  process.exit(1);
});