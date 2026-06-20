// list_koif_routes tool — 列举 router runs

import { listRouterRuns } from "../services/koif_router/write.js";

export interface ListKoifRoutesInput {
  category?: string;
  limit?: number;
}

export interface ListKoifRoutesOutput {
  runs: Array<{
    router_run_id: string;
    category: string;
    category_id: string;
    router_version: string;
    requested_capabilities: string[];
    started_at: string;
    ended_at?: string;
  }>;
}

export function listKoifRoutesTool(input: ListKoifRoutesInput = {}): ListKoifRoutesOutput {
  const runs = listRouterRuns({ category: input.category, limit: input.limit ?? 20 });
  return {
    runs: runs.map((m) => ({
      router_run_id: m.router_run_id,
      category: m.category,
      category_id: m.category_id,
      router_version: m.router_version,
      requested_capabilities: m.requested_capabilities,
      started_at: m.started_at,
      ended_at: m.ended_at,
    })),
  };
}