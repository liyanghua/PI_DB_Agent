// scripts/build_promotion_plan.ts
//
// 输入：registry/derived/api_asset_cards.json
// 输出：registry/derived/promotion_plan.json
//       registry/derived/promotion_plan.md

import path from "node:path";
import { readJson, writeJson, writeText } from "../src/lib/io.js";
import type { ApiAssetCard } from "../src/lib/types.js";
import { analyzePromotion, renderPromotionMd } from "../src/services/promotion.js";

const ROOT = path.resolve(process.cwd());
const cardsPath = path.join(ROOT, "registry/derived/api_asset_cards.json");
const outJson = path.join(ROOT, "registry/derived/promotion_plan.json");
const outMd = path.join(ROOT, "registry/derived/promotion_plan.md");

const raw = readJson<{ count?: number; cards: ApiAssetCard[] } | ApiAssetCard[]>(cardsPath);
const cards: ApiAssetCard[] = Array.isArray(raw) ? raw : raw.cards;
const report = analyzePromotion(cards);
writeJson(outJson, report);
writeText(outMd, renderPromotionMd(report));

console.log(JSON.stringify({
  total: report.total,
  byGap: report.byGap,
  byFix: report.byFix,
  byPromote: report.byPromote,
  out: { json: outJson, md: outMd },
}, null, 2));