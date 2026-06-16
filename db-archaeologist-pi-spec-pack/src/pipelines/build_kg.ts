// kg_builder: emit nodes + edges JSONL according to docs/07_KNOWLEDGE_GRAPH_SPEC.md.
// Node types: BusinessQuestion, Domain, Capability, Tool, API, Entity, Metric, Field, Issue
// Edge types: QUESTION_NEEDS_CAPABILITY, CAPABILITY_USES_TOOL, TOOL_WRAPS_API,
//             API_BELONGS_TO_DOMAIN, API_RETURNS_FIELD, FIELD_MAPS_TO_METRIC,
//             FIELD_DESCRIBES_ENTITY, API_HAS_ISSUE, TOOL_REQUIRES_PARAM,
//             TOOL_FALLBACK_TO_TOOL

import path from "node:path";
import { readJson, readJsonl, readYaml, writeJsonl, writeText } from "../lib/io.js";
import type { ApiAssetCard, KgEdge, KgNode, ToolRegistryEntry } from "../lib/types.js";

type CardsFile = { count: number; cards: ApiAssetCard[] };
type ToolFile = { tools: ToolRegistryEntry[] };
type SeedRow = Record<string, unknown>;

const ROOT = process.cwd();

function nodeId(type: string, key: string): string {
  return `${type.toLowerCase()}.${key}`;
}

export function buildKg(): { nodes: KgNode[]; edges: KgEdge[] } {
  const cardsFile = readJson<CardsFile>(path.join(ROOT, "registry/derived/api_asset_cards.json"));
  const toolsFile = readYaml<ToolFile>(path.join(ROOT, "registry/derived/tool_registry.yaml"));
  const seedRows = readJsonl<SeedRow>(path.join(ROOT, "registry/knowledge_graph.seed.jsonl"));

  const nodes = new Map<string, KgNode>();
  const edges: KgEdge[] = [];

  const addNode = (n: KgNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  const addEdge = (source: string, target: string, type: string, extra: Record<string, unknown> = {}) => {
    edges.push({ source, target, type, ...extra });
  };

  for (const row of seedRows) {
    if ("id" in row && "type" in row) {
      addNode(row as KgNode);
    } else if ("source" in row && "target" in row && "type" in row) {
      edges.push(row as KgEdge);
    }
  }

  const domains = new Set<string>();
  const capabilities = new Set<string>();

  for (const c of cardsFile.cards) {
    const apiNodeId = nodeId("api", c.api_id);
    addNode({
      id: apiNodeId,
      type: "API",
      api_id: c.api_id,
      method: c.method,
      path: c.path,
      name: c.name,
      lifecycle_status: c.lifecycle_status,
      quality_score: c.quality_score,
      domain: c.domain,
      capability: c.capability,
    });

    domains.add(c.domain);
    const domainNodeId = nodeId("domain", c.domain);
    addEdge(apiNodeId, domainNodeId, "API_BELONGS_TO_DOMAIN");

    if (c.capability) {
      const capId = `${c.domain}__${c.capability}`;
      capabilities.add(capId);
      const capNodeId = nodeId("capability", capId);
      addNode({ id: capNodeId, type: "Capability", name: c.capability, domain: c.domain });
    }

    for (const f of c.response_schema?.fields ?? []) {
      const fid = nodeId("field", `${c.api_id}::${f.path}`);
      addNode({
        id: fid,
        type: "Field",
        api_id: c.api_id,
        field_path: f.path,
        name: f.name,
        ftype: f.type,
        desc: f.desc,
      });
      addEdge(apiNodeId, fid, "API_RETURNS_FIELD");
    }

    for (const m of c.metric_mapping ?? []) {
      const mid = nodeId("metric", m.metric);
      addNode({ id: mid, type: "Metric", metric_id: m.metric });
      const fid = nodeId("field", `${c.api_id}::${m.field_path}`);
      addEdge(fid, mid, "FIELD_MAPS_TO_METRIC", { via: m.via });
    }

    for (const e of c.entity_mapping ?? []) {
      const eid = nodeId("entity", e.entity);
      addNode({ id: eid, type: "Entity", entity_id: e.entity });
      addEdge(apiNodeId, eid, "FIELD_DESCRIBES_ENTITY", { evidence: e.evidence });
    }

    for (const issue of c.issues ?? []) {
      const iid = nodeId("issue", `${c.api_id}::${issue.type}`);
      addNode({ id: iid, type: "Issue", issue_type: issue.type, severity: issue.severity, api_id: c.api_id });
      addEdge(apiNodeId, iid, "API_HAS_ISSUE");
    }
  }

  for (const d of domains) {
    addNode({ id: nodeId("domain", d), type: "Domain", name: d });
  }

  for (const t of toolsFile.tools ?? []) {
    const tid = nodeId("tool", t.tool_id);
    addNode({
      id: tid,
      type: "Tool",
      tool_id: t.tool_id,
      name: t.tool_name,
      domain: t.domain,
      capability: t.capability,
      origin: t.origin,
    });
    if (t.capability) {
      const capNodeId = nodeId("capability", `${t.domain}__${t.capability}`);
      addNode({ id: capNodeId, type: "Capability", name: t.capability, domain: t.domain });
      addEdge(capNodeId, tid, "CAPABILITY_USES_TOOL");
    }
    for (const apiId of t.source_apis ?? []) {
      addEdge(tid, nodeId("api", apiId), "TOOL_WRAPS_API", { role: "primary" });
    }
    for (const apiId of t.fallback_apis ?? []) {
      addEdge(tid, nodeId("api", apiId), "TOOL_WRAPS_API", { role: "fallback" });
    }
    const props = (t.input_schema as { properties?: Record<string, unknown>; required?: string[] }) ?? {};
    for (const name of Object.keys(props.properties ?? {})) {
      const required = (props.required ?? []).includes(name);
      addEdge(tid, nodeId("param", `${t.tool_id}::${name}`), "TOOL_REQUIRES_PARAM", { required });
      addNode({ id: nodeId("param", `${t.tool_id}::${name}`), type: "Param", tool_id: t.tool_id, name });
    }
  }

  return { nodes: [...nodes.values()], edges };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { nodes, edges } = buildKg();
  writeJsonl(path.join(ROOT, "registry/derived/kg_nodes.jsonl"), nodes);
  writeJsonl(path.join(ROOT, "registry/derived/kg_edges.jsonl"), edges);

  const counts: Record<string, number> = {};
  for (const n of nodes) counts[n.type] = (counts[n.type] ?? 0) + 1;
  const edgeCounts: Record<string, number> = {};
  for (const e of edges) edgeCounts[e.type] = (edgeCounts[e.type] ?? 0) + 1;

  const lines: string[] = [];
  lines.push("# KG Build Report");
  lines.push("");
  lines.push(`Nodes: ${nodes.length}`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) lines.push(`- ${k}: ${v}`);
  lines.push("");
  lines.push(`Edges: ${edges.length}`);
  for (const [k, v] of Object.entries(edgeCounts).sort((a, b) => b[1] - a[1])) lines.push(`- ${k}: ${v}`);
  writeText(path.join(ROOT, "registry/derived/kg_build_report.md"), lines.join("\n") + "\n");
  console.log(`KG: nodes=${nodes.length}, edges=${edges.length}`);
}