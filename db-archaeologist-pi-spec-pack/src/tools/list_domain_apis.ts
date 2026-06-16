import { getCards } from "../services/registry.js";

export type ListDomainApisInput = { domain: string; status?: string; limit?: number };

export function listDomainApis(args: ListDomainApisInput) {
  if (!args || typeof args.domain !== "string" || args.domain.trim() === "") {
    throw new Error("list_domain_apis: domain is required");
  }
  const limit = args.limit ?? 50;
  const cards = getCards()
    .filter(c => c.domain === args.domain)
    .filter(c => !args.status || c.lifecycle_status === args.status)
    .sort((a, b) => b.quality_score - a.quality_score)
    .slice(0, limit);
  return {
    domain: args.domain,
    count: cards.length,
    apis: cards.map(c => ({
      api_id: c.api_id,
      method: c.method,
      path: c.path,
      name: c.name,
      lifecycle_status: c.lifecycle_status,
      quality_score: c.quality_score,
      capability: c.capability,
      issues: (c.issues ?? []).map(i => i.type),
    })),
  };
}