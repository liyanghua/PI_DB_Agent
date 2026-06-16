// scripts/ingest_source.ts — 把新版源文档纳入主入口。
//
// 用法：
//   node --import ./scripts/ts_loader.mjs scripts/ingest_source.ts [<file.md>]
//
// 行为：
//   1. 选定 source：CLI 显式传入 OR 从 sources/api_docs/_inbox/*.md 选 mtime 最新
//   2. 校验：size > 100KB、首行含 "# 智能体数仓完整接口文档"
//   3. 若主入口存在 → mv 到 sources/api_docs/_archive/<YYYYMMDD-HHmm>.md（用主入口 mtime）
//   4. 复制新文件到主入口路径（_inbox 原文件保留）
//   5. 追加 _archive/INDEX.md 一条记录
//
// 不写 derived；这是 rebuild 的 step 0。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "sources/api_docs");
const MAIN_NAME = "智能体数仓完整接口文档_整理版.md";
const MAIN_PATH = path.join(SRC_DIR, MAIN_NAME);
const INBOX_DIR = path.join(SRC_DIR, "_inbox");
const ARCHIVE_DIR = path.join(SRC_DIR, "_archive");
const ARCHIVE_INDEX = path.join(ARCHIVE_DIR, "INDEX.md");
const HEADER_MARK = "# 智能体数仓完整接口文档";
const MIN_SIZE = 100 * 1024;

type IngestResult = {
  picked: string;
  archived: string | null;
  archived_size: number | null;
  archived_sha256: string | null;
  installed: string;
  installed_size: number;
  installed_sha256: string;
  ingested_at: string;
};

function pickFromInbox(): string {
  if (!fs.existsSync(INBOX_DIR)) {
    throw new Error(`inbox not found: ${INBOX_DIR}; create it and drop new doc in, or pass file as argv[2]`);
  }
  const candidates = fs.readdirSync(INBOX_DIR)
    .filter((n) => n.endsWith(".md") && !n.startsWith("."))
    .map((n) => {
      const full = path.join(INBOX_DIR, n);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (candidates.length === 0) {
    throw new Error(`no *.md found in ${INBOX_DIR}`);
  }
  return candidates[0]!.full;
}

function validateSource(p: string) {
  if (!fs.existsSync(p)) throw new Error(`source not found: ${p}`);
  const st = fs.statSync(p);
  if (!st.isFile()) throw new Error(`source not a file: ${p}`);
  if (st.size < MIN_SIZE) throw new Error(`source too small (${st.size}B < ${MIN_SIZE}B): ${p}`);
  const fd = fs.openSync(p, "r");
  try {
    const buf = Buffer.alloc(512);
    fs.readSync(fd, buf, 0, 512, 0);
    const head = buf.toString("utf8");
    if (!head.includes(HEADER_MARK)) {
      throw new Error(`source header missing "${HEADER_MARK}": ${p}`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function sha256(p: string): string {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function archiveStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function appendArchiveIndex(line: string) {
  ensureDir(ARCHIVE_DIR);
  if (!fs.existsSync(ARCHIVE_INDEX)) {
    fs.writeFileSync(ARCHIVE_INDEX, "# Source archive index\n\n");
  }
  fs.appendFileSync(ARCHIVE_INDEX, line + "\n");
}

function main(): IngestResult {
  const argv = process.argv.slice(2);
  const picked = argv[0] ? path.resolve(argv[0]) : pickFromInbox();
  validateSource(picked);

  let archived: string | null = null;
  let archivedSize: number | null = null;
  let archivedSha: string | null = null;

  if (fs.existsSync(MAIN_PATH)) {
    ensureDir(ARCHIVE_DIR);
    const oldStat = fs.statSync(MAIN_PATH);
    const stamp = archiveStamp(new Date(oldStat.mtimeMs));
    let archiveName = `${stamp}.md`;
    let archivePath = path.join(ARCHIVE_DIR, archiveName);
    let n = 1;
    while (fs.existsSync(archivePath)) {
      archiveName = `${stamp}-${n}.md`;
      archivePath = path.join(ARCHIVE_DIR, archiveName);
      n += 1;
    }
    fs.renameSync(MAIN_PATH, archivePath);
    archived = archivePath;
    archivedSize = oldStat.size;
    archivedSha = sha256(archivePath);
  }

  fs.copyFileSync(picked, MAIN_PATH);
  const newStat = fs.statSync(MAIN_PATH);
  const newSha = sha256(MAIN_PATH);
  const ingestedAt = new Date().toISOString();

  if (archived) {
    appendArchiveIndex(
      `- ${path.basename(archived)} | size=${archivedSize} | sha256=${archivedSha} | replaced_at=${ingestedAt} | replaced_by=${path.basename(picked)}`,
    );
  }

  return {
    picked,
    archived,
    archived_size: archivedSize,
    archived_sha256: archivedSha,
    installed: MAIN_PATH,
    installed_size: newStat.size,
    installed_sha256: newSha,
    ingested_at: ingestedAt,
  };
}

const result = main();
console.log(JSON.stringify(result, null, 2));