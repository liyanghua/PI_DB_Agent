import { getCard } from "../services/registry.js";
import { lineageOfApi } from "../services/lineage.js";

export type GetCardInput = { api_id: string };

export function getApiAssetCard(args: GetCardInput) {
  if (!args || typeof args.api_id !== "string" || args.api_id.trim() === "") {
    throw new Error("get_api_asset_card: api_id is required");
  }
  const card = getCard(args.api_id);
  if (!card) {
    return { found: false, api_id: args.api_id };
  }
  const lineage = lineageOfApi(card.api_id);
  return {
    found: true,
    card,
    lineage_text: lineage?.text,
  };
}