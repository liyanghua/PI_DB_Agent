import { getCards, getBlocked } from "../services/registry.js";

export type ListIssuesInput = { issue_type?: string; severity?: "low" | "medium" | "high"; limit?: number };

export function listApiQualityIssues(args: ListIssuesInput = {}) {
  const limit = args.limit ?? 100;
  const cards = getCards();
  const out: Array<{
    api_id: string;
    method: string;
    path: string;
    domain: string;
    lifecycle_status: string;
    issue_type: string;
    severity: string;
    message?: string;
  }> = [];
  for (const c of cards) {
    for (const issue of c.issues ?? []) {
      if (args.issue_type && issue.type !== args.issue_type) continue;
      if (args.severity && issue.severity !== args.severity) continue;
      out.push({
        api_id: c.api_id,
        method: c.method,
        path: c.path,
        domain: c.domain,
        lifecycle_status: c.lifecycle_status,
        issue_type: issue.type,
        severity: issue.severity,
        message: issue.message,
      });
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
  }
  return {
    count: out.length,
    issues: out,
    blocked_apis: getBlocked().blocked.slice(0, 20),
  };
}