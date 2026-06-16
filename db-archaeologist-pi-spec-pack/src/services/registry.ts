// Registry service: single load point for derived cards / tools / KG.
// Also exposes seed dictionaries (metric, taxonomy, golden cases).
// All readers are synchronous and lazy (loaded once per process).

import path from "node:path";
import { readJson, readJsonl, readYaml, exists } from "../lib/io.js";
import type { ApiAssetCard, KgEdge, KgNode, ToolRegistryEntry } from "../lib/types.js";

type CardsFile = { count: number; cards: ApiAssetCard[] };
type ToolFile = { tools: ToolRegistryEntry[] };
type BlockedFile = { blocked: Array<{ api_id: string; reasons: string[] }> };
type MetricDictFile = {
  metrics: Record<string, { cn_name: string; type: string; aliases?: string[] }>;
};
type DomainTaxonomyFile = { domains: Array<{ name: string; seed_api_count?: number }> };

const ROOT = process.env.REGISTRY_ROOT ?? process.cwd();

function p(rel: string): string {
  return path.join(ROOT, rel);
}

let cards: ApiAssetCard[] | null = null;
let cardById: Map<string, ApiAssetCard> | null = null;
let cardByPath: Map<string, ApiAssetCard> | null = null;

let tools: ToolRegistryEntry[] | null = null;
let toolById: Map<string, ToolRegistryEntry> | null = null;

let kgNodes: KgNode[] | null = null;
let kgEdges: KgEdge[] | null = null;
let kgOut: Map<string, KgEdge[]> | null = null;
let kgIn: Map<string, KgEdge[]> | null = null;

let metricDict: MetricDictFile | null = null;
let taxonomy: DomainTaxonomyFile | null = null;
let blocked: BlockedFile | null = null;

export function getCards(): ApiAssetCard[] {
  if (cards) return cards;
  const file = readJson<CardsFile>(p("registry/derived/api_asset_cards.json"));
  cards = file.cards;
  cardById = new Map(cards.map(c => [c.api_id, c]));
  cardByPath = new Map(cards.map(c => [c.path, c]));
  return cards;
}

export function getCard(idOrPath: string): ApiAssetCard | undefined {
  getCards();
  return cardById!.get(idOrPath) ?? cardByPath!.get(idOrPath);
}

export function getTools(): ToolRegistryEntry[] {
  if (tools) return tools;
  const derived = p("registry/derived/tool_registry.yaml");
  const file = exists(derived)
    ? readYaml<ToolFile>(derived)
    : readYaml<ToolFile>(p("registry/tool_registry.seed.yaml"));
  tools = file.tools ?? [];
  toolById = new Map(tools.map(t => [t.tool_id, t]));
  return tools;
}

export function getTool(toolId: string): ToolRegistryEntry | undefined {
  getTools();
  return toolById!.get(toolId);
}

export function getBlocked(): BlockedFile {
  if (blocked) return blocked;
  const file = p("registry/derived/tool_blocked.yaml");
  blocked = exists(file) ? readYaml<BlockedFile>(file) : { blocked: [] };
  return blocked;
}

export function getKg(): { nodes: KgNode[]; edges: KgEdge[] } {
  if (kgNodes && kgEdges) return { nodes: kgNodes, edges: kgEdges };
  const nodesPath = p("registry/derived/kg_nodes.jsonl");
  const edgesPath = p("registry/derived/kg_edges.jsonl");
  if (!exists(nodesPath) || !exists(edgesPath)) {
    kgNodes = readJsonl<KgNode>(p("registry/knowledge_graph.seed.jsonl")).filter(
      n => "id" in n && "type" in n
    );
    kgEdges = readJsonl<KgEdge>(p("registry/knowledge_graph.seed.jsonl")).filter(
      e => "source" in e && "target" in e
    );
  } else {
    kgNodes = readJsonl<KgNode>(nodesPath);
    kgEdges = readJsonl<KgEdge>(edgesPath);
  }
  kgOut = new Map();
  kgIn = new Map();
  for (const e of kgEdges) {
    (kgOut.get(e.source) ?? kgOut.set(e.source, []).get(e.source)!).push(e);
    (kgIn.get(e.target) ?? kgIn.set(e.target, []).get(e.target)!).push(e);
  }
  return { nodes: kgNodes, edges: kgEdges };
}

export function kgOutbound(nodeId: string): KgEdge[] {
  getKg();
  return kgOut!.get(nodeId) ?? [];
}

export function kgInbound(nodeId: string): KgEdge[] {
  getKg();
  return kgIn!.get(nodeId) ?? [];
}

export function getMetricDict(): MetricDictFile {
  if (metricDict) return metricDict;
  metricDict = readYaml<MetricDictFile>(p("registry/metric_dictionary.seed.yaml"));
  return metricDict;
}

export function getTaxonomy(): DomainTaxonomyFile {
  if (taxonomy) return taxonomy;
  taxonomy = readYaml<DomainTaxonomyFile>(p("registry/domain_taxonomy.yaml"));
  return taxonomy;
}

export function reset(): void {
  cards = null;
  cardById = null;
  cardByPath = null;
  tools = null;
  toolById = null;
  kgNodes = null;
  kgEdges = null;
  kgOut = null;
  kgIn = null;
  metricDict = null;
  taxonomy = null;
  blocked = null;
}