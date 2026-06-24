// workspace.mjs
// 业务策略 Workspace 只读 loader + 闭环 lint + cross_node_ref 语法校验。
// 所有函数纯只读，零 fs 写；缺文件一律返 null + lints[]，不抛异常。
// docs 锚点：docs/22 / docs/23 §3-§10 / docs/24 §6。

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseYaml } from "../../src/lib/yaml_lite.ts";

const ROOT = process.env.SPEC_PACK_ROOT || process.cwd();
const WS_BASE = "registry/derived/scenario_workspace";

const PATHS = {
  scenarioIndex: `${WS_BASE}/scenario_index.json`,
  scenarioDir: (sid) => `${WS_BASE}/scenarios/${sid}`,
  manifest: (sid) => `${WS_BASE}/scenarios/${sid}/scenario_manifest.json`,
  playbook: (sid) => `${WS_BASE}/scenarios/${sid}/playbook/playbook.json`,
  schemaTags: (sid) => `${WS_BASE}/scenarios/${sid}/schema/schema_tags.json`,
  kbManifest: (sid) => `${WS_BASE}/scenarios/${sid}/kb/kb_manifest.json`,
  gatePolicy: (sid) => `${WS_BASE}/scenarios/${sid}/playbook/gate_policy.json`,
  artifactDir: (sid) => `${WS_BASE}/scenarios/${sid}/playbook/artifact_templates`,
  artifactTemplate: (sid, aid) => `${WS_BASE}/scenarios/${sid}/playbook/artifact_templates/${aid}.json`,
  mission: (mid) => `${WS_BASE}/missions/${mid}/mission.json`,
  capabilityMap: "registry/koif_capability_map.yaml",
};

async function readJsonSafe(rel) {
  try {
    return JSON.parse(await readFile(path.join(ROOT, rel), "utf8"));
  } catch {
    return null;
  }
}

async function readYamlSafe(rel) {
  try {
    return parseYaml(await readFile(path.join(ROOT, rel), "utf8"));
  } catch {
    return null;
  }
}

export async function getScenarioIndex() {
  return readJsonSafe(PATHS.scenarioIndex);
}

export async function getPlaybook(scenario_id) {
  return readJsonSafe(PATHS.playbook(scenario_id));
}

export async function getSchemaTags(scenario_id) {
  return readJsonSafe(PATHS.schemaTags(scenario_id));
}

export async function getMission(mission_id) {
  return readJsonSafe(PATHS.mission(mission_id));
}

export async function getCapabilityMap() {
  return readYamlSafe(PATHS.capabilityMap);
}

export async function getArtifactTemplate(scenario_id, artifact_id) {
  return readJsonSafe(PATHS.artifactTemplate(scenario_id, artifact_id));
}

async function listArtifactTemplates(sid) {
  try {
    const dir = path.join(ROOT, PATHS.artifactDir(sid));
    const files = await readdir(dir);
    const out = [];
    for (const f of files.filter((x) => x.endsWith(".json"))) {
      const j = await readJsonSafe(path.join(PATHS.artifactDir(sid), f));
      if (j) out.push(j);
    }
    return out;
  } catch {
    return [];
  }
}

export async function getScenario(scenario_id) {
  const manifest = await readJsonSafe(PATHS.manifest(scenario_id));
  if (!manifest) return null;
  const playbook = await readJsonSafe(PATHS.playbook(scenario_id));
  const schema_tags = await readJsonSafe(PATHS.schemaTags(scenario_id));
  const kb_manifest = await readJsonSafe(PATHS.kbManifest(scenario_id));
  const gate_policy = await readJsonSafe(PATHS.gatePolicy(scenario_id));
  const artifact_templates = await listArtifactTemplates(scenario_id);
  return {
    scenario_id,
    manifest,
    playbook,
    schema_tags,
    kb_manifest,
    gate_policy,
    artifact_templates,
  };
}

function stableHash(parts) {
  // FNV-1a 32bit；仅供 lint 闭环识别 instance 变化，不参与安全
  let h = 0x811c9dc5;
  const s = JSON.stringify(parts);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

export async function resolvePlaybookForCategory(scenario_id, category_id) {
  const playbook = await getPlaybook(scenario_id);
  if (!playbook) {
    return { instance: null, lints: [{ level: "error", code: "playbook_not_found" }] };
  }
  const lints = [];
  // Phase 1 不做实质 merge：直接深拷返回 playbook（docs/23 §10.5 决议）
  const instance = JSON.parse(JSON.stringify(playbook));
  if (!category_id) {
    lints.push({
      level: "info",
      code: "category_default_universal",
      message: "未提供 category_id，按通用品类解析",
    });
  }
  const cmap = await getCapabilityMap();
  if (cmap?.capabilities) {
    for (const node of instance.nodes || []) {
      const cap_name = node.runtime_request?.capability;
      if (!cap_name) continue;
      const cap = cmap.capabilities[cap_name];
      const overrides = cap?.strategy_card?.["品类_overrides"];
      if (overrides && Object.keys(overrides).length > 0 && !category_id) {
        lints.push({
          level: "warn",
          code: "category_params_required",
          node_id: node.node_id,
          capability: cap_name,
          message: "strategy_card 含 品类_overrides，但未提供 category_id",
        });
      }
    }
  }
  instance.__resolution = {
    scenario_id,
    category_id: category_id ?? null,
    instance_hash: stableHash([scenario_id, category_id ?? "__universal__"]),
  };
  return { instance, lints };
}

export async function lintCapabilityMapAgainstPlaybook(scenario_id) {
  const playbook = await getPlaybook(scenario_id);
  const cmap = await getCapabilityMap();
  if (!playbook) return { lints: [{ level: "error", code: "playbook_not_found" }] };
  if (!cmap) return { lints: [{ level: "error", code: "capability_map_not_found" }] };
  const lints = [];
  const cap_table = cmap.capabilities || {};
  const sk_table = cmap.subject_kinds || {};
  for (const node of playbook.nodes || []) {
    const cap_name = node.runtime_request?.capability;
    if (!cap_name) continue;
    const cap = cap_table[cap_name];
    if (!cap) {
      lints.push({
        level: "error",
        code: "unknown_capability",
        node_id: node.node_id,
        capability: cap_name,
      });
      continue;
    }
    const sk_status = sk_table[cap.subject_kind]?.status;
    if (sk_status === "planned") {
      lints.push({
        level: "info",
        code: "subject_planned",
        node_id: node.node_id,
        subject_kind: cap.subject_kind,
      });
    }
    if (cap.router_owned === true && !(cap.candidates || []).includes("propose_koif_strategy")) {
      lints.push({
        level: "error",
        code: "router_integrity_violation",
        node_id: node.node_id,
        capability: cap_name,
      });
    }
    if (!(cap.candidates && cap.candidates.length > 0)) {
      lints.push({
        level: "warn",
        code: "unresolved_capability",
        node_id: node.node_id,
        capability: cap_name,
      });
    }
  }
  return { lints };
}

const CROSS_NODE_REF_RE = /^@([a-z_][a-z0-9_]*)\.artifact\.([a-z_][a-z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_.\[\]]*)$/;

function walkValues(node, visit, prefix = "") {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkValues(v, visit, `${prefix}[${i}]`));
  } else if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      walkValues(v, visit, prefix ? `${prefix}.${k}` : k);
    }
  } else {
    visit(node, prefix);
  }
}

export async function lintCrossNodeRefs(scenario_id) {
  const sc = await getScenario(scenario_id);
  if (!sc?.playbook) return { lints: [{ level: "error", code: "playbook_not_found" }] };
  const node_ids = new Set((sc.playbook.nodes || []).map((n) => n.node_id));
  const node_arts = new Map();
  for (const n of sc.playbook.nodes || []) {
    node_arts.set(n.node_id, new Set(n.artifact_templates || []));
  }
  const lints = [];
  for (const tmpl of sc.artifact_templates || []) {
    const schema = tmpl.output_schema;
    if (!schema) {
      lints.push({
        level: "info",
        code: "output_schema_absent",
        artifact_id: tmpl.artifact_id,
      });
      continue;
    }
    walkValues(schema, (val, p) => {
      if (typeof val !== "string" || !val.startsWith("@")) return;
      const m = val.match(CROSS_NODE_REF_RE);
      if (!m) {
        lints.push({
          level: "error",
          code: "cross_node_ref_syntax",
          artifact_id: tmpl.artifact_id,
          path: p,
          raw: val,
        });
        return;
      }
      const [, refNode, refArt] = m;
      if (!node_ids.has(refNode)) {
        lints.push({
          level: "error",
          code: "cross_node_ref_unknown_node",
          artifact_id: tmpl.artifact_id,
          path: p,
          ref_node: refNode,
        });
      } else if (!node_arts.get(refNode)?.has(refArt)) {
        lints.push({
          level: "error",
          code: "cross_node_ref_unknown_artifact",
          artifact_id: tmpl.artifact_id,
          path: p,
          ref_node: refNode,
          ref_artifact: refArt,
        });
      }
    });
  }
  return { lints };
}