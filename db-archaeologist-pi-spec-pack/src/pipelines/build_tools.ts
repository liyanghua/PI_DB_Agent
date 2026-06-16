// tool_registry_builder:
//   1. seed tools (registry/tool_registry.seed.yaml) treated as locked manual wrappers.
//   2. group remaining cards by (domain, capability); each group → tool_candidate.
//   3. quality_gate: min_score 0.75, status in [verified, agent_ready], no path placeholder.
//   4. fallback chain ordered by quality_score desc; blocked APIs go to tool_blocked.yaml.
//   5. write derived/tool_registry.yaml + derived/tool_blocked.yaml + report.

import path from "node:path";
import { readJson, readYaml, writeYaml, writeText } from "../lib/io.js";
import type { ApiAssetCard, ToolRegistryEntry } from "../lib/types.js";

type SeedFile = { tools: ToolRegistryEntry[] };
type CardsFile = { count: number; cards: ApiAssetCard[] };

const ROOT = process.cwd();
const QUALITY_GATE = {
  min_quality_score: 0.75,
  required_status: ["verified", "agent_ready"] as const,
};

function tokenizeForToolId(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function unionParams(cards: ApiAssetCard[]) {
  const seen = new Map<string, { type?: string; required: boolean; desc?: string }>();
  const isClean = (n: string) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n);
  for (const c of cards) {
    for (const p of c.request_schema?.query ?? []) {
      if (!isClean(p.name)) continue;
      const cur = seen.get(p.name);
      if (!cur) {
        seen.set(p.name, { type: p.type, required: !!p.required, desc: p.desc });
      } else if (p.required) {
        cur.required = true;
      }
    }
    for (const p of c.request_schema?.body ?? []) {
      if (!isClean(p.name)) continue;
      const cur = seen.get(p.name);
      if (!cur) {
        seen.set(p.name, { type: p.type, required: !!p.required, desc: p.desc });
      } else if (p.required) {
        cur.required = true;
      }
    }
  }
  const required: string[] = [];
  const properties: Record<string, { type: string; description?: string }> = {};
  for (const [name, meta] of seen) {
    properties[name] = { type: meta.type ?? "string", description: meta.desc };
    if (meta.required) required.push(name);
  }
  return { type: "object", required, properties };
}

function unionResponseFields(cards: ApiAssetCard[]) {
  const set = new Set<string>();
  for (const c of cards) {
    for (const f of c.response_schema?.fields ?? []) set.add(f.path);
  }
  return { type: "object", properties: { fields: { type: "array", items: { type: "string" }, examples: [[...set].slice(0, 12)] } } };
}

export function buildTools(): {
  tools: ToolRegistryEntry[];
  blocked: Array<{ api_id: string; reasons: string[] }>;
  candidatesGenerated: number;
} {
  const seed = readYaml<SeedFile>(path.join(ROOT, "registry/tool_registry.seed.yaml"));
  const cardsFile = readJson<CardsFile>(path.join(ROOT, "registry/derived/api_asset_cards.json"));
  const cards = cardsFile.cards;

  const cardById = new Map(cards.map(c => [c.api_id, c] as const));
  const cardByPath = new Map(cards.map(c => [c.path, c] as const));

  const seedTools: ToolRegistryEntry[] = (seed.tools ?? []).map(t => {
    const sourceCards = (t.source_apis ?? [])
      .map(p => cardByPath.get(p) ?? cardById.get(p))
      .filter((c): c is ApiAssetCard => Boolean(c));
    return {
      ...t,
      origin: "manual",
      source_apis: sourceCards.length ? sourceCards.map(c => c.api_id) : (t.source_apis ?? []),
    };
  });
  const seedTaken = new Set<string>();
  for (const t of seedTools) for (const id of t.source_apis ?? []) seedTaken.add(id);

  const blocked: Array<{ api_id: string; reasons: string[] }> = [];
  const groups = new Map<string, ApiAssetCard[]>();

  for (const c of cards) {
    const reasons: string[] = [];
    if (/\{[^}]+\}/.test(c.path)) reasons.push("path_placeholder");
    if (c.quality_score < QUALITY_GATE.min_quality_score) reasons.push(`quality_below_${QUALITY_GATE.min_quality_score}`);
    if (!QUALITY_GATE.required_status.includes(c.lifecycle_status as "verified" | "agent_ready")) {
      reasons.push(`status_${c.lifecycle_status}`);
    }
    if (reasons.length > 0) {
      blocked.push({ api_id: c.api_id, reasons });
      continue;
    }
    if (seedTaken.has(c.api_id)) continue;
    if (!c.capability) continue;
    const key = `${c.domain}::${c.capability}`;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  const auto: ToolRegistryEntry[] = [];
  for (const [key, members] of groups) {
    if (members.length === 0) continue;
    members.sort((a, b) => b.quality_score - a.quality_score);
    const [primary, ...rest] = members;
    const [domain, capability] = key.split("::");
    const tool_id = `auto_${tokenizeForToolId(`${domain}_${capability}`)}`;
    auto.push({
      tool_id,
      tool_name: `${domain} · ${capability}`,
      description: `自动派生工具：聚合 ${members.length} 个 ${domain}/${capability} 接口；首选 ${primary.name}。`,
      domain,
      capability,
      input_schema: unionParams(members),
      output_schema: unionResponseFields(members),
      source_apis: [primary.api_id],
      fallback_apis: rest.map(c => c.api_id),
      quality_gate: { ...QUALITY_GATE, required_status: [...QUALITY_GATE.required_status] },
      runtime: { enabled_in_pi: false, pi_tool_name: tool_id },
      origin: "auto",
    });
  }

  return { tools: [...seedTools, ...auto], blocked, candidatesGenerated: auto.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { tools, blocked, candidatesGenerated } = buildTools();

  writeYaml(path.join(ROOT, "registry/derived/tool_registry.yaml"), { tools });
  writeYaml(path.join(ROOT, "registry/derived/tool_blocked.yaml"), { blocked });

  const lines: string[] = [];
  lines.push("# Tool Registry Build Report");
  lines.push("");
  lines.push(`Total tools: ${tools.length}`);
  lines.push(`Manual: ${tools.filter(t => t.origin === "manual").length}`);
  lines.push(`Auto: ${candidatesGenerated}`);
  lines.push(`Blocked APIs: ${blocked.length}`);
  lines.push("");
  lines.push("## Tools");
  for (const t of tools) {
    lines.push(`- \`${t.tool_id}\` (${t.origin ?? "manual"}, ${t.domain}/${t.capability ?? ""}) -> primary=${t.source_apis?.[0]}, fallbacks=${(t.fallback_apis ?? []).length}`);
  }
  lines.push("");
  lines.push("## Blocked (top 50)");
  for (const b of blocked.slice(0, 50)) {
    lines.push(`- ${b.api_id} :: ${b.reasons.join(", ")}`);
  }
  writeText(path.join(ROOT, "registry/derived/tool_build_report.md"), lines.join("\n") + "\n");
  console.log(`Tools: ${tools.length} (manual=${tools.filter(t => t.origin === "manual").length} auto=${candidatesGenerated}), blocked=${blocked.length}`);
}