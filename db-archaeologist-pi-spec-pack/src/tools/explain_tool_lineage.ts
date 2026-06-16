import { lineageOfTool, lineageOfMetric } from "../services/lineage.js";

export type ExplainLineageInput = { tool_id?: string; metric?: string };

export function explainToolLineage(args: ExplainLineageInput) {
  if (args.tool_id) {
    const r = lineageOfTool(args.tool_id);
    if (!r) return { found: false, tool_id: args.tool_id };
    return { found: true, root: r.root, steps: r.steps, text: r.text };
  }
  if (args.metric) {
    const r = lineageOfMetric(args.metric);
    return { found: true, root: r.root, steps: r.steps, text: r.text };
  }
  throw new Error("explain_tool_lineage: tool_id or metric is required");
}