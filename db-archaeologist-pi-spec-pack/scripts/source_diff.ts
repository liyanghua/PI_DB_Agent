// scripts/source_diff.ts —— 比对源文档变更前后的 cards 集合。
//
// 输入：
//   registry/derived/api_asset_cards.prev.json  (rebuild S0 拷贝的快照)
//   registry/derived/api_asset_cards.json       (S3 build_cards 当前产出)
//   registry/derived/tool_registry.yaml         (用来检查 removed 是否被工具引用)
//
// 输出：
//   registry/derived/source_diff.json
//   registry/derived/source_diff_report.md
//
// 不阻塞 rebuild；只有 WARN 没有 FAIL。

import path from "node:path";
import { readJson, readYaml, writeJson, writeText, exists } from "../src/lib/io.js";
import type { ApiAssetCard } from "../src/lib/types.js";

type CardsFile = { count?: number; cards: ApiAssetCard[] } | ApiAssetCard[];
type ToolEntry = { tool_id: string; source_apis?: string[]; fallback_apis?: string[] };
type ToolRegistry = { tools: ToolEntry[] };

const ROOT = process.cwd();
const PREV = path.join(ROOT, "registry/derived/api_asset_cards.prev.json");
const CURR = path.join(ROOT, "registry/derived/api_asset_cards.json");
const TOOLS = path.join(ROOT, "registry/derived/tool_registry.yaml");
const OUT_JSON = path.join(ROOT, "registry/derived/source_diff.json");
const OUT_MD = path.join(ROOT, "registry/derived/source_diff_report.md");

function readCards(p: string): ApiAssetCard[] {
  const raw = readJson<CardsFile>(p);
  return Array.isArray(raw) ? raw : raw.cards;
}

type DiffRow = {
  api_id: string;
  method?: string;
  path?: string;
  domain?: string;
  prev_domain?: string;
  prev_path?: string;
};

type Diff = {
  prev_total: number;
  curr_total: number;
  added: DiffRow[];
  removed: DiffRow[];
  renamed_path: DiffRow[];          // api_id 一致但 path 变了
  domain_changed: DiffRow[];
  removed_used_by_tools: { api_id: string; tool_ids: string[] }[];
};

function diffCards(prev: ApiAssetCard[], curr: ApiAssetCard[]): Diff {
  const prevById = new Map(prev.map((c) => [c.api_id, c]));
  const currById = new Map(curr.map((c) => [c.api_id, c]));

  const added: DiffRow[] = [];
  const removed: DiffRow[] = [];
  const renamedPath: DiffRow[] = [];
  const domainChanged: DiffRow[] = [];

  for (const c of curr) {
    if (!prevById.has(c.api_id)) {
      added.push({ api_id: c.api_id, method: c.method, path: c.path, domain: c.domain });
    }
  }
  for (const c of prev) {
    if (!currById.has(c.api_id)) {
      removed.push({ api_id: c.api_id, method: c.method, path: c.path, domain: c.domain });
    }
  }
  for (const [id, c] of currById) {
    const p = prevById.get(id);
    if (!p) continue;
    if (p.path !== c.path) {
      renamedPath.push({ api_id: id, method: c.method, path: c.path, prev_path: p.path });
    }
    if (p.domain !== c.domain) {
      domainChanged.push({ api_id: id, path: c.path, prev_domain: p.domain, domain: c.domain });
    }
  }

  return {
    prev_total: prev.length,
    curr_total: curr.length,
    added,
    removed,
    renamed_path: renamedPath,
    domain_changed: domainChanged,
    removed_used_by_tools: [],
  };
}

function loadToolRegistry(): ToolRegistry | null {
  if (!exists(TOOLS)) return null;
  try { return readYaml<ToolRegistry>(TOOLS); } catch { return null; }
}

function findToolUsage(removedIds: string[], reg: ToolRegistry | null): Diff["removed_used_by_tools"] {
  if (!reg || removedIds.length === 0) return [];
  const out: Diff["removed_used_by_tools"] = [];
  const removedSet = new Set(removedIds);
  const ref = new Map<string, Set<string>>();
  for (const t of reg.tools ?? []) {
    for (const a of [...(t.source_apis ?? []), ...(t.fallback_apis ?? [])]) {
      if (!removedSet.has(a)) continue;
      if (!ref.has(a)) ref.set(a, new Set());
      ref.get(a)!.add(t.tool_id);
    }
  }
  for (const [api_id, tools] of ref) {
    out.push({ api_id, tool_ids: [...tools].sort() });
  }
  return out;
}

function renderMd(d: Diff): string {
  const ln: string[] = [];
  ln.push("# Source Diff Report");
  ln.push("");
  ln.push(`Prev cards: ${d.prev_total}`);
  ln.push(`Curr cards: ${d.curr_total}`);
  ln.push(`Added: ${d.added.length} | Removed: ${d.removed.length} | Path renamed: ${d.renamed_path.length} | Domain changed: ${d.domain_changed.length}`);
  ln.push("");

  if (d.removed_used_by_tools.length > 0) {
    ln.push("## ⚠ Removed APIs still referenced by tool_registry");
    ln.push("");
    ln.push("| api_id | referenced by |");
    ln.push("| --- | --- |");
    for (const r of d.removed_used_by_tools) {
      ln.push(`| \`${r.api_id}\` | ${r.tool_ids.map((t) => "`" + t + "`").join(", ")} |`);
    }
    ln.push("");
  }

  function table(title: string, rows: DiffRow[], cols: { key: keyof DiffRow; head: string }[]) {
    ln.push(`## ${title} (${rows.length})`);
    ln.push("");
    if (rows.length === 0) { ln.push("(none)"); ln.push(""); return; }
    ln.push("| " + cols.map((c) => c.head).join(" | ") + " |");
    ln.push("| " + cols.map(() => "---").join(" | ") + " |");
    for (const r of rows.slice(0, 200)) {
      const cells = cols.map((c) => {
        const v = r[c.key];
        return v == null ? "" : (typeof v === "string" && v.startsWith("/") ? "`" + v + "`" : String(v));
      });
      ln.push("| " + cells.join(" | ") + " |");
    }
    if (rows.length > 200) ln.push(`...and ${rows.length - 200} more`);
    ln.push("");
  }

  table("Added", d.added, [
    { key: "api_id", head: "api_id" },
    { key: "method", head: "method" },
    { key: "path", head: "path" },
    { key: "domain", head: "domain" },
  ]);
  table("Removed", d.removed, [
    { key: "api_id", head: "api_id" },
    { key: "method", head: "method" },
    { key: "path", head: "path" },
    { key: "domain", head: "domain" },
  ]);
  table("Path renamed", d.renamed_path, [
    { key: "api_id", head: "api_id" },
    { key: "prev_path", head: "prev_path" },
    { key: "path", head: "new_path" },
  ]);
  table("Domain changed", d.domain_changed, [
    { key: "api_id", head: "api_id" },
    { key: "prev_domain", head: "prev" },
    { key: "domain", head: "curr" },
    { key: "path", head: "path" },
  ]);

  return ln.join("\n") + "\n";
}

if (!exists(CURR)) {
  console.error(`[source:diff] missing ${CURR}; run build:cards first`);
  process.exit(0);
}

if (!exists(PREV)) {
  const stub: Diff = {
    prev_total: 0,
    curr_total: readCards(CURR).length,
    added: [],
    removed: [],
    renamed_path: [],
    domain_changed: [],
    removed_used_by_tools: [],
  };
  writeJson(OUT_JSON, stub);
  writeText(OUT_MD, "# Source Diff Report\n\n(no prev snapshot; first build)\n");
  console.log("[source:diff] no prev snapshot; emitted empty report");
  process.exit(0);
}

const prev = readCards(PREV);
const curr = readCards(CURR);
const diff = diffCards(prev, curr);
const reg = loadToolRegistry();
diff.removed_used_by_tools = findToolUsage(diff.removed.map((r) => r.api_id), reg);

writeJson(OUT_JSON, diff);
writeText(OUT_MD, renderMd(diff));

const warn = diff.removed_used_by_tools.length;
console.log(JSON.stringify({
  prev: diff.prev_total, curr: diff.curr_total,
  added: diff.added.length, removed: diff.removed.length,
  renamed: diff.renamed_path.length, domain_changed: diff.domain_changed.length,
  removed_referenced_by_tools: warn,
  out: { json: OUT_JSON, md: OUT_MD },
}, null, 2));

if (warn > 0) console.warn(`[source:diff] WARN ${warn} removed APIs still referenced by tool_registry`);