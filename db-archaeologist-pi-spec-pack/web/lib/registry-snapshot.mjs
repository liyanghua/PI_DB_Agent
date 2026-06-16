// registry-snapshot.mjs
// 读取 spec-pack 派生产物，给前端 Inspector 用。

import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.env.SPEC_PACK_ROOT || process.cwd();

async function readJsonSafe(rel) {
  try {
    const txt = await readFile(path.join(ROOT, rel), "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function readTextSafe(rel) {
  try {
    return await readFile(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

function countYamlTopList(yamlText, key) {
  if (!yamlText) return 0;
  const lines = yamlText.split(/\r?\n/);
  let inBlock = false;
  let count = 0;
  for (const ln of lines) {
    if (!inBlock) {
      if (new RegExp(`^${key}\\s*:\\s*$`).test(ln)) {
        inBlock = true;
        continue;
      }
    } else {
      if (/^[A-Za-z_]/.test(ln)) break; // next top-level key
      if (/^\s{2}-\s/.test(ln) || /^\s{2}- /.test(ln)) count++;
    }
  }
  return count;
}

export async function getSnapshot() {
  const cardsFile = await readJsonSafe("registry/derived/api_asset_cards.json");
  const toolsYaml = await readTextSafe("registry/derived/tool_registry.yaml");
  const blockedYaml = await readTextSafe("registry/derived/tool_blocked.yaml");
  const cardsReport = await readTextSafe("registry/derived/cards_build_report.md");
  const parseReport = await readTextSafe("registry/derived/api_parse_report.md");
  const toolReport = await readTextSafe("registry/derived/tool_build_report.md");
  const kgReport = await readTextSafe("registry/derived/kg_build_report.md");

  const cards = cardsFile?.cards ?? [];
  const byStatus = {};
  const byDomain = {};
  for (const c of cards) {
    const s = c.lifecycle_status || "unknown";
    byStatus[s] = (byStatus[s] || 0) + 1;
    const d = c.domain || "未分类";
    byDomain[d] = (byDomain[d] || 0) + 1;
  }
  return {
    cwd: ROOT,
    cards: {
      total: cards.length,
      byStatus,
      byDomain,
    },
    tools: {
      total: countYamlTopList(toolsYaml || "", "tools"),
      blocked: countYamlTopList(blockedYaml || "", "blocked"),
    },
    reports: {
      cards: cardsReport ? cardsReport.slice(0, 4000) : null,
      parse: parseReport ? parseReport.slice(0, 4000) : null,
      tools: toolReport ? toolReport.slice(0, 4000) : null,
      kg: kgReport ? kgReport.slice(0, 4000) : null,
    },
  };
}