// build_cards pipeline:
//   1. read api_index_seed.json (159) + api_details.raw.json (160)
//   2. join by source_seq (markdown sequence number)
//   3. canonicalize path → derive api_id
//   4. domain inference v2 → entity/metric mapping
//   5. quality scoring v2 → lifecycle
//   6. apply locked overrides → write derived/api_asset_cards.json + report

import path from "node:path";
import { readJson, readYaml, writeJson, writeText } from "../lib/io.js";
import { canonicalizePath, pathToApiId } from "../normalizers/path_canon.js";
import { inferDomainV2, applyLockedOverrides } from "../normalizers/domain_mapper.js";
import { scoreCard } from "../normalizers/quality_scorer.js";
import { decideLifecycle } from "../normalizers/lifecycle.js";
import { buildAliasIndex, classifyMetrics, inferEntities } from "../normalizers/field_semantic_classifier.js";
import type { ApiAssetCard, Issue } from "../lib/types.js";
import type { DetailParseResult } from "../extractors/markdown_detail_extractor.js";
import type { MetricDict } from "../normalizers/field_semantic_classifier.js";

type IndexRow = {
  seq: number;
  module: string;
  name: string;
  method: string;
  path: string;
  issue_marker?: string;
  domain?: string;
  lifecycle_status?: string;
  quality_score_seed?: number;
  api_id: string;
};

type IndexFile = { source: string; count: number; apis: IndexRow[] };
type DetailFile = { count: number; details: DetailParseResult[] };
type LockedFile = { overrides: Record<string, { domain?: string; capability?: string }> };

const ROOT = process.cwd();

function loadInputs() {
  const index = readJson<IndexFile>(path.join(ROOT, "registry/seed/api_index_seed.json"));
  const detail = readJson<DetailFile>(path.join(ROOT, "registry/derived/api_details.raw.json"));
  const dict = readYaml<MetricDict>(path.join(ROOT, "registry/metric_dictionary.seed.yaml"));
  const locked = readYaml<LockedFile>(path.join(ROOT, "registry/domain_mapping.locked.yaml"));
  return { index, detail, dict, locked: locked?.overrides ?? {} };
}

function detectDuplicatePaths(rows: IndexRow[]): Set<string> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const c = canonicalizePath(r.path).path;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const dups = new Set<string>();
  for (const [p, c] of counts) {
    if (c > 1) dups.add(p);
  }
  return dups;
}

function buildIssues(card: ApiAssetCard, detail: DetailParseResult | undefined, dupPath: boolean): Issue[] {
  const issues: Issue[] = [];
  if (!detail) issues.push({ type: "no_detail_section", severity: "medium" });
  if (detail?.parse_failure) issues.push({ type: "parse_failure", severity: "high" });
  for (const w of detail?.parse_warnings ?? []) {
    issues.push({ type: w, severity: w.includes("invalid") ? "high" : "medium" });
  }
  if (/\{[^}]+\}/.test(card.path)) {
    issues.push({ type: "path_placeholder", severity: "high", message: card.path });
  }
  if (dupPath) issues.push({ type: "duplicate_path", severity: "medium" });
  if ((card.response_schema?.fields ?? []).length === 0) {
    issues.push({ type: "missing_response_fields", severity: "medium" });
  }
  if (!card.response_schema?.example) {
    issues.push({ type: "empty_response_example", severity: "medium" });
  }
  return issues;
}

export function buildCards(): ApiAssetCard[] {
  const { index, detail, dict, locked } = loadInputs();
  const aliasIdx = buildAliasIndex(dict);
  const dupPaths = detectDuplicatePaths(index.apis);
  const detailMap = new Map<number, DetailParseResult>();
  for (const d of detail.details) detailMap.set(d.source_seq, d);

  const cards: ApiAssetCard[] = [];

  for (const row of index.apis) {
    const det = detailMap.get(row.seq);
    const canon = canonicalizePath(det?.path ?? row.path);
    const api_id = row.api_id || pathToApiId(canon.path);

    const card: ApiAssetCard = {
      api_id,
      source_seq: row.seq,
      name: row.name,
      module: row.module,
      method: (row.method as ApiAssetCard["method"]) ?? "POST",
      path: canon.path,
      path_raw: canon.raw,
      domain: row.domain ?? "未分类域",
      lifecycle_status: "raw",
      quality_score: 0,
      issue_marker: row.issue_marker || undefined,
      source_line_no: det?.source_line_no,
      request_schema: det?.request_schema,
      response_schema: det?.response_schema,
      parse_failure: det?.parse_failure ?? !det,
    };

    const dm = inferDomainV2({
      name: card.name,
      module: card.module,
      path: card.path,
      response_schema: card.response_schema,
    });
    card.domain = dm.domain;
    card.capability = dm.capability;
    card.domain_mapping = dm;

    card.metric_mapping = classifyMetrics(card.response_schema?.fields ?? [], aliasIdx);
    card.entity_mapping = inferEntities(card);

    const qs = scoreCard(card);
    card.quality_score = qs.score;
    card.quality_breakdown = qs.breakdown;

    const lf = decideLifecycle(card, {
      parse_failure: card.parse_failure,
      duplicate_path: dupPaths.has(card.path),
    });
    card.lifecycle_status = lf.status;
    card.notes = lf.reasons.join(",");

    card.issues = buildIssues(card, det, dupPaths.has(card.path));
    card.tool_candidate =
      (card.lifecycle_status === "verified" || card.lifecycle_status === "agent_ready") &&
      card.quality_score >= 0.7 &&
      !/\{[^}]+\}/.test(card.path);

    cards.push(card);
  }

  applyLockedOverrides(cards, locked);
  return cards;
}

function summarize(cards: ApiAssetCard[]) {
  const byStatus: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  let mappedCount = 0;
  let toolCandidates = 0;
  for (const c of cards) {
    byStatus[c.lifecycle_status] = (byStatus[c.lifecycle_status] ?? 0) + 1;
    byDomain[c.domain] = (byDomain[c.domain] ?? 0) + 1;
    if (c.domain !== "未分类域" && (c.entity_mapping?.length ?? 0) + (c.metric_mapping?.length ?? 0) > 0) {
      mappedCount++;
    }
    if (c.tool_candidate) toolCandidates++;
  }
  return { byStatus, byDomain, mappedCount, toolCandidates, total: cards.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cards = buildCards();
  const out = path.join(ROOT, "registry/derived/api_asset_cards.json");
  writeJson(out, { count: cards.length, cards });

  const stats = summarize(cards);
  const lines: string[] = [];
  lines.push("# Cards Build Report");
  lines.push("");
  lines.push(`Total: ${stats.total}`);
  lines.push(`Tool candidates: ${stats.toolCandidates}`);
  lines.push(`With entity+metric mapping: ${stats.mappedCount}`);
  lines.push("");
  lines.push("## By lifecycle_status");
  for (const [k, v] of Object.entries(stats.byStatus).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  lines.push("## By domain");
  for (const [k, v] of Object.entries(stats.byDomain).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${k}: ${v}`);
  }
  writeText(path.join(ROOT, "registry/derived/cards_build_report.md"), lines.join("\n") + "\n");
  console.log(`Built ${cards.length} cards -> ${out}`);
  console.log(JSON.stringify(stats, null, 2));
}