// Lineage service: tool/metric/api → human-readable trace + structured chain.

import { getCard, getTool, getMetricDict, getCards, kgInbound, kgOutbound } from "./registry.js";
import type { ApiAssetCard, ToolRegistryEntry } from "../lib/types.js";

export type LineageNode = {
  type: "Tool" | "API" | "Field" | "Metric" | "Entity" | "Domain";
  id: string;
  label: string;
  meta?: Record<string, unknown>;
};

export type LineageChain = {
  root: LineageNode;
  steps: Array<{ from: string; to: string; via: string }>;
  text: string;
};

function toolNode(t: ToolRegistryEntry): LineageNode {
  return { type: "Tool", id: t.tool_id, label: t.tool_name, meta: { domain: t.domain, capability: t.capability } };
}
function apiNode(c: ApiAssetCard): LineageNode {
  return { type: "API", id: c.api_id, label: `${c.method} ${c.path}`, meta: { name: c.name, status: c.lifecycle_status, quality: c.quality_score } };
}

export function lineageOfTool(toolId: string): LineageChain | undefined {
  const t = getTool(toolId);
  if (!t) return undefined;
  const root = toolNode(t);
  const steps: LineageChain["steps"] = [];
  const lines: string[] = [];
  lines.push(`# Tool ${t.tool_name} (${t.tool_id})`);
  lines.push(`Domain: ${t.domain} | Capability: ${t.capability ?? "-"} | Origin: ${t.origin ?? "manual"}`);
  lines.push("");
  lines.push("## Source APIs");

  for (const apiId of t.source_apis ?? []) {
    const c = getCard(apiId);
    if (!c) {
      steps.push({ from: t.tool_id, to: apiId, via: "TOOL_WRAPS_API" });
      lines.push(`- ${apiId} (not found)`);
      continue;
    }
    steps.push({ from: t.tool_id, to: c.api_id, via: "TOOL_WRAPS_API" });
    lines.push(`- ${c.method} ${c.path} (status=${c.lifecycle_status}, q=${c.quality_score})`);
    for (const m of c.metric_mapping ?? []) {
      steps.push({ from: c.api_id, to: `metric.${m.metric}`, via: "FIELD_MAPS_TO_METRIC" });
      lines.push(`  - field ${m.field_path} → metric ${m.metric} (${m.via})`);
    }
    for (const e of c.entity_mapping ?? []) {
      steps.push({ from: c.api_id, to: `entity.${e.entity}`, via: "FIELD_DESCRIBES_ENTITY" });
      lines.push(`  - entity ${e.entity} (${e.evidence.join(",")})`);
    }
  }

  if ((t.fallback_apis ?? []).length) {
    lines.push("");
    lines.push("## Fallback APIs");
    for (const apiId of t.fallback_apis ?? []) {
      const c = getCard(apiId);
      lines.push(`- ${c ? `${c.method} ${c.path}` : apiId}`);
    }
  }

  return { root, steps, text: lines.join("\n") };
}

export function lineageOfMetric(metric: string): LineageChain {
  const dict = getMetricDict();
  const entry = dict.metrics?.[metric.toLowerCase()];
  const cards = getCards();
  const lines: string[] = [];
  lines.push(`# Metric ${metric}${entry ? ` (${entry.cn_name})` : ""}`);
  if (entry?.aliases?.length) lines.push(`Aliases: ${entry.aliases.join(", ")}`);
  lines.push("");
  lines.push("## APIs producing this metric");
  const steps: LineageChain["steps"] = [];
  let count = 0;
  for (const c of cards) {
    const hits = (c.metric_mapping ?? []).filter(m => m.metric.toLowerCase() === metric.toLowerCase());
    for (const h of hits) {
      steps.push({ from: `metric.${metric}`, to: c.api_id, via: "PRODUCED_BY" });
      lines.push(`- ${c.method} ${c.path} (field=${h.field_path}, status=${c.lifecycle_status})`);
      count++;
    }
  }
  if (count === 0) lines.push("- (no matching API)");
  return {
    root: { type: "Metric", id: `metric.${metric}`, label: entry?.cn_name ?? metric },
    steps,
    text: lines.join("\n"),
  };
}

export function lineageOfApi(apiId: string): LineageChain | undefined {
  const c = getCard(apiId);
  if (!c) return undefined;
  const root = apiNode(c);
  const steps: LineageChain["steps"] = [];
  const lines: string[] = [];
  lines.push(`# API ${c.method} ${c.path} (${c.api_id})`);
  lines.push(`Domain: ${c.domain} | Capability: ${c.capability ?? "-"}`);
  lines.push(`Status: ${c.lifecycle_status} | Quality: ${c.quality_score}`);
  if (c.issues?.length) lines.push(`Issues: ${c.issues.map(i => i.type).join(", ")}`);
  lines.push("");
  lines.push("## Wrapped by tools");
  for (const e of kgInbound(`api.${c.api_id}`)) {
    if (e.type === "TOOL_WRAPS_API") {
      lines.push(`- ${e.source} (role=${(e as { role?: string }).role ?? "primary"})`);
      steps.push({ from: e.source, to: `api.${c.api_id}`, via: "TOOL_WRAPS_API" });
    }
  }
  lines.push("");
  lines.push("## Metrics");
  for (const m of c.metric_mapping ?? []) {
    lines.push(`- ${m.field_path} → ${m.metric}`);
    steps.push({ from: c.api_id, to: `metric.${m.metric}`, via: "FIELD_MAPS_TO_METRIC" });
  }
  lines.push("");
  lines.push("## Entities");
  for (const e of c.entity_mapping ?? []) {
    lines.push(`- ${e.entity} (${e.evidence.join(",")})`);
  }
  void kgOutbound;
  return { root, steps, text: lines.join("\n") };
}