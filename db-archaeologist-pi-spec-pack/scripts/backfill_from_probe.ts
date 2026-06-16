// scripts/backfill_from_probe.ts
//
// 用法：
//   node --import ./scripts/ts_loader.mjs scripts/backfill_from_probe.ts \
//     [--samples registry/probe_samples.json] [--write]
//
// --samples 指向一个 ProbeBundle JSON（{ samples: [{api_id, response:{payload,http}}, ...] }）。
//   缺省时仅基于已有 example 反推字段。
// --write    直接覆盖 registry/derived/api_asset_cards.json；
//   缺省 dry-run，仅写报告 registry/derived/backfill_report.{json,md}。

import path from "node:path";
import fs from "node:fs";
import { readJson, writeJson, writeText } from "../src/lib/io.js";
import type { ApiAssetCard } from "../src/lib/types.js";
import { applyBackfill, renderBackfillMd } from "../src/services/backfill.js";
import type { ProbeBundle } from "../src/services/backfill.js";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
function arg(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}
const samplesPath = arg("--samples");
const write = argv.includes("--write");

const cardsPath = path.join(ROOT, "registry/derived/api_asset_cards.json");
const raw = readJson<{ count?: number; cards: ApiAssetCard[] } | ApiAssetCard[]>(cardsPath);
const cards: ApiAssetCard[] = Array.isArray(raw) ? raw : raw.cards;

let bundle: ProbeBundle | null = null;
if (samplesPath) {
  if (!fs.existsSync(samplesPath)) {
    console.error(`samples file not found: ${samplesPath}`);
    process.exit(2);
  }
  bundle = readJson<ProbeBundle>(samplesPath);
}

const { cards: nextCards, report } = applyBackfill(cards, bundle);
writeJson(path.join(ROOT, "registry/derived/backfill_report.json"), report);
writeText(path.join(ROOT, "registry/derived/backfill_report.md"), renderBackfillMd(report));

if (write) {
  const out = Array.isArray(raw) ? nextCards : { count: nextCards.length, cards: nextCards };
  writeJson(cardsPath, out);
  console.log(`wrote ${cardsPath}`);
} else {
  console.log("dry-run; pass --write to persist cards");
}

const promoted = report.changed.filter((c) => c.before.lifecycle !== c.after.lifecycle).length;
console.log(JSON.stringify({
  changed: report.changed.length,
  promoted,
  skipped: report.skipped.length,
  samples: bundle?.samples.length ?? 0,
}, null, 2));