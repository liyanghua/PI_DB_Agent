import { probeApiSample } from "../services/api_runtime.js";
import type { ProbeApiSampleInput, ApiProbeResult } from "../services/api_runtime.js";

export type { ProbeApiSampleInput, ApiProbeResult };

export async function probeApiSampleTool(args: ProbeApiSampleInput): Promise<ApiProbeResult> {
  return probeApiSample(args);
}