// Thin wrapper: validates input, delegates to qa service.
import { askApiCatalog as qa } from "../services/qa.js";

export type AskApiCatalogInput = { question: string; domain?: string; limit?: number };

export function askApiCatalog(args: AskApiCatalogInput) {
  if (!args || typeof args.question !== "string" || args.question.trim() === "") {
    throw new Error("ask_api_catalog: question is required");
  }
  const limit = args.limit ?? 8;
  if (typeof limit !== "number" || limit < 1 || limit > 50) {
    throw new Error("ask_api_catalog: limit out of range");
  }
  return qa(args.question, { domain: args.domain, limit });
}