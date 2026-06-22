// invoke.ts: S2 — 并行 fan-out 调用 capabilities
// Phase 3 支持 kds (analyze_keyword_demand) + tms (analyze_keyword_trend) + cps (analyze_keyword_competition)

import { analyzeKeywordDemand } from "../keyword_demand/index.js";
import { analyzeKeywordTrend } from "../keyword_trend/index.js";
import { analyzeKeywordCompetition } from "../keyword_competition/index.js";
import type { CapabilityCode, CapabilityRunRef } from "./types.js";

export interface InvokeCapabilitiesInput {
  category: string;
  category_id?: string;
  capabilities: CapabilityCode[];
  live: boolean;
  top_n?: number;
}

export interface InvokeCapabilitiesOutput {
  capability_runs: CapabilityRunRef[];
}

export async function invokeCapabilities(input: InvokeCapabilitiesInput): Promise<InvokeCapabilitiesOutput> {
  const tasks = input.capabilities.map(async (cap): Promise<CapabilityRunRef> => {
    try {
      if (cap === "kds") {
        const result = await analyzeKeywordDemand({
          category: input.category,
          category_id: input.category_id,
          live: input.live,
          top_n: input.top_n ?? 50,
        });
        if ("error" in result) {
          return {
            capability: "kds",
            run_id: "",
            run_dir: "",
            status: "unavailable",
            reason: `analyze_keyword_demand failed: ${result.error}${result.details ? " — " + result.details : ""}`,
          };
        }
        return {
          capability: "kds",
          run_id: result.run_id,
          run_dir: result.run_dir,
          status: "ok",
        };
      }

      if (cap === "tms") {
        const result = await analyzeKeywordTrend({
          category: input.category,
          category_id: input.category_id,
          live: input.live,
          top_n: input.top_n ?? 50,
        });
        if ("error" in result) {
          return {
            capability: "tms",
            run_id: "",
            run_dir: "",
            status: "unavailable",
            reason: `analyze_keyword_trend failed: ${result.error}${result.details ? " — " + result.details : ""}`,
          };
        }
        return {
          capability: "tms",
          run_id: result.meta.run_id,
          run_dir: result.run_dir,
          status: "ok",
        };
      }

      if (cap === "cps") {
        const result = await analyzeKeywordCompetition({
          category: input.category,
          category_id: input.category_id,
          live: input.live,
          top_n: input.top_n ?? 50,
        });
        if ("error" in result) {
          return {
            capability: "cps",
            run_id: "",
            run_dir: "",
            status: "unavailable",
            reason: `analyze_keyword_competition failed: ${result.error}${result.details ? " — " + result.details : ""}`,
          };
        }
        return {
          capability: "cps",
          run_id: result.run_id,
          run_dir: result.run_dir,
          status: "ok",
        };
      }

      return {
        capability: cap,
        run_id: "",
        run_dir: "",
        status: "unavailable",
        reason: `capability_not_supported_in_phase3: ${cap}`,
      };
    } catch (err) {
      return {
        capability: cap,
        run_id: "",
        run_dir: "",
        status: "unavailable",
        reason: `capability_invoke_throw: ${(err as Error)?.message ?? String(err)}`,
      };
    }
  });

  const capability_runs = await Promise.all(tasks);
  return { capability_runs };
}