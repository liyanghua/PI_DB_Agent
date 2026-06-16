// Demo runner: print golden case outcomes to stdout for `npm run demo`.
// Real assertions live in tests/golden.test.ts (run via `npm test`).

import path from "node:path";
import { readYaml } from "../lib/io.js";
import { askApiCatalog } from "../services/qa.js";
import { selectToolsForTask } from "../services/selector.js";

type QaCase = { id: string; question: string; expected_contains: string[] };
type SelectCase = {
  id: string;
  task: string;
  known_params?: Record<string, unknown>;
  expected_tools: string[];
  expected_missing_params?: string[];
  expected_notes?: string[];
};

const ROOT = process.cwd();
const qaCases = readYaml<{ cases: QaCase[] }>(path.join(ROOT, "tests/golden_cases/api_qa_cases.yaml")).cases;
const selectCases = readYaml<{ cases: SelectCase[] }>(path.join(ROOT, "tests/golden_cases/tool_selection_cases.yaml")).cases;

console.log("=== API QA Golden Cases ===");
let qaPass = 0;
for (const c of qaCases) {
  const r = askApiCatalog(c.question, { limit: 5 });
  const blob = JSON.stringify(r).toLowerCase();
  const missing = c.expected_contains.filter(s => !blob.includes(s.toLowerCase()));
  const ok = missing.length === 0;
  if (ok) qaPass++;
  console.log(`- ${c.id}: ${ok ? "PASS" : "FAIL"}${missing.length ? ` missing=${missing.join(",")}` : ""}`);
  if (!ok) {
    for (const cand of r.candidates.slice(0, 3)) {
      console.log(`    candidate: ${cand.method} ${cand.path} (${cand.domain}, ${cand.lifecycle_status})`);
    }
  }
}
console.log(`Total QA: ${qaPass}/${qaCases.length}`);

console.log("\n=== Tool Selection Golden Cases ===");
let selPass = 0;
for (const c of selectCases) {
  const r = selectToolsForTask(c.task, c.known_params ?? {});
  const ids = r.recommended_tools.map(t => t.tool_id);
  const allTools = c.expected_tools.every(t => ids.includes(t));
  const missingOk = !c.expected_missing_params || c.expected_missing_params.every(p => r.recommended_tools.some(it => it.missing_params.includes(p)));
  const notesOk = !c.expected_notes || c.expected_notes.every(n => r.next_question.includes(n));
  const ok = allTools && missingOk && notesOk;
  if (ok) selPass++;
  console.log(`- ${c.id}: ${ok ? "PASS" : "FAIL"} tools=${ids.join("|")} next=${r.next_question}`);
}
console.log(`Total Select: ${selPass}/${selectCases.length}`);

if (qaPass / qaCases.length < 0.8 || selPass / selectCases.length < 0.75) {
  console.error("Golden case thresholds not met.");
  process.exit(1);
}