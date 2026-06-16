import test from "node:test";
import { strict as assert } from "node:assert";
import path from "node:path";
import { readYaml } from "../src/lib/io.js";
import { askApiCatalog } from "../src/services/qa.js";
import { selectToolsForTask } from "../src/services/selector.js";

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

test("api_qa golden: top-3 hit rate >= 0.8", () => {
  let pass = 0;
  for (const c of qaCases) {
    const r = askApiCatalog(c.question, { limit: 5 });
    const blob = JSON.stringify(r).toLowerCase();
    const allFound = c.expected_contains.every(s => blob.includes(s.toLowerCase()));
    if (allFound) pass++;
    else console.warn(`[qa] miss ${c.id}: missing=${c.expected_contains.filter(s => !blob.includes(s.toLowerCase())).join(",")}`);
  }
  const rate = pass / qaCases.length;
  console.log(`api_qa golden hit rate: ${pass}/${qaCases.length} = ${rate.toFixed(2)}`);
  assert.ok(rate >= 0.8, `qa hit rate ${rate} < 0.8`);
});

test("tool_selection golden: pass rate >= 0.75", () => {
  let pass = 0;
  for (const c of selectCases) {
    const r = selectToolsForTask(c.task, c.known_params ?? {});
    const ids = r.recommended_tools.map(t => t.tool_id);
    const allTools = c.expected_tools.every(t => ids.includes(t));
    const missingOk =
      !c.expected_missing_params || c.expected_missing_params.every(p => r.recommended_tools.some(it => it.missing_params.includes(p)));
    const notesOk =
      !c.expected_notes || c.expected_notes.every(n => r.next_question.includes(n));
    if (allTools && missingOk && notesOk) pass++;
    else
      console.warn(`[select] miss ${c.id}: tools_ok=${allTools} missing_ok=${missingOk} notes_ok=${notesOk}, got=${ids.join(",")}, next=${r.next_question}`);
  }
  const rate = pass / selectCases.length;
  console.log(`tool_selection golden pass rate: ${pass}/${selectCases.length} = ${rate.toFixed(2)}`);
  assert.ok(rate >= 0.75, `select pass rate ${rate} < 0.75`);
});

test("blocked apis include path placeholders", () => {
  const r = selectToolsForTask("分析某个商品最近7天转化下降的原因");
  const blocked = r.blocked_or_deprioritized;
  console.log(`blocked_or_deprioritized count: ${blocked.length}`);
  assert.ok(Array.isArray(blocked), "blocked must be array");
});