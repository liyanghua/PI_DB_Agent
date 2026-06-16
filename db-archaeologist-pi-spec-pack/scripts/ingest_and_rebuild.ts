// scripts/ingest_and_rebuild.ts — 套壳：先 ingest_source 再 rebuild_all。
//
// 用法：
//   node --import ./scripts/ts_loader.mjs scripts/ingest_and_rebuild.ts [<file.md>]
//
// 行为：把 ingest_source.ts 当作 stage S-1，跑完后再 spawn rebuild_all.ts。
// 任一阶段非 0 退出立即终止。

import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const NODE = process.execPath;
const LOADER = path.join(ROOT, "scripts/ts_loader.mjs");

function run(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(NODE, ["--import", LOADER, ...args], {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (e) => { console.error(String(e)); resolve(1); });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  console.log("[ingest+rebuild] ▶ ingest_source");
  const c1 = await run(["scripts/ingest_source.ts", ...argv]);
  if (c1 !== 0) {
    console.error(`[ingest+rebuild] ingest_source failed (exit=${c1})`);
    process.exit(c1);
  }
  console.log("\n[ingest+rebuild] ▶ rebuild_all");
  const c2 = await run(["scripts/rebuild_all.ts"]);
  if (c2 !== 0) process.exit(c2);
  console.log("\n[ingest+rebuild] OK");
}

main();