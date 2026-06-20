# PI Memory Upgrade Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable PI memory layer that preserves session history as evidence, stores ranked experience memory, and measurably improves KOIF-driven keyword analysis outcomes.

**Architecture:** Keep PI's session system intact and add a hybrid memory layer on top. The first pass should capture PI events into normalized memory records, persist them with provenance, recall them before turns, and inject only a compact ranked bundle. The second pass adds feedback, decay, and KOIF benchmark evaluation so the system can prove improvement on both retrieval quality and keyword-analysis decision quality.

**Tech Stack:** TypeScript, PI coding-agent hooks, existing session JSONL, local SQLite or JSONL + text index, KOIF keyword-analysis artifacts, node:test.

---

## Chunk 1: Memory model and capture spine

**Files:**
- Create: `db-archaeologist-pi-spec-pack/src/memory/types.ts`
- Create: `db-archaeologist-pi-spec-pack/src/memory/events.ts`
- Create: `db-archaeologist-pi-spec-pack/src/memory/normalize.ts`
- Create: `db-archaeologist-pi-spec-pack/tests/memory/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Cover:
- event-to-memory normalization for `tool_call`, `tool_result`, `agent_end`
- provenance fields preserved on normalized records
- memory type assignment for episodic / semantic / procedural / preference / failure / domain

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/memory/normalize.test.ts`
Expected: fail because the module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement:
- `MemoryType`, `MemoryRecord`, `MemoryEvent`
- normalize helpers that convert session/tool events into memory candidates
- provenance and confidence defaults

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/memory/normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit only the new memory model files and test.

## Chunk 2: Memory store and recall

**Files:**
- Create: `db-archaeologist-pi-spec-pack/src/memory/store.ts`
- Create: `db-archaeologist-pi-spec-pack/src/memory/index.ts`
- Create: `db-archaeologist-pi-spec-pack/tests/memory/store.test.ts`

- [ ] **Step 1: Write the failing test**

Cover:
- record insert and lookup
- scope filtering (`session` / `project` / `global`)
- ranking by relevance + recency + confidence
- suppression / expired record exclusion

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/memory/store.test.ts`
Expected: fail because store APIs are missing.

- [ ] **Step 3: Write minimal implementation**

Implement a local store first:
- in-memory or JSONL-backed persistence
- deterministic scoring
- JSON serialization with provenance

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/memory/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit only the store and tests.

## Chunk 3: PI hook integration

**Files:**
- Modify: `db-archaeologist-pi-spec-pack/.pi/extensions/db_archaeologist.extension.ts`
- Create: `db-archaeologist-pi-spec-pack/src/memory/pi_bridge.ts`
- Create: `db-archaeologist-pi-spec-pack/tests/memory/pi_bridge.test.ts`

- [ ] **Step 1: Write the failing test**

Cover:
- memory observe on tool call / result
- recall before agent start
- small injection bundle
- no duplicate injection for the same turn

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/memory/pi_bridge.test.ts`
Expected: fail because integration code does not exist.

- [ ] **Step 3: Write minimal implementation**

Implement:
- hook registration
- `observe -> store`
- `recall -> inject`
- safe defaults when memory is empty

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/memory/pi_bridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit only bridge and extension wiring.

## Chunk 4: Feedback, decay, and conflict handling

**Files:**
- Create: `db-archaeologist-pi-spec-pack/src/memory/feedback.ts`
- Modify: `db-archaeologist-pi-spec-pack/src/memory/store.ts`
- Create: `db-archaeologist-pi-spec-pack/tests/memory/feedback.test.ts`

- [ ] **Step 1: Write the failing test**

Cover:
- confidence decay on unused memory
- promotion on repeated success
- conflict suppression inside a conflict group
- stale memory not selected after stronger evidence appears

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/memory/feedback.test.ts`
Expected: fail because feedback logic is missing.

- [ ] **Step 3: Write minimal implementation**

Implement:
- feedback updates
- decay logic
- conflict group resolution

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/memory/feedback.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit feedback logic and tests.

## Chunk 5: KOIF benchmark and evaluation

**Files:**
- Create: `db-archaeologist-pi-spec-pack/src/memory/metrics.ts`
- Create: `db-archaeologist-pi-spec-pack/src/memory/koif_benchmark.ts`
- Create: `db-archaeologist-pi-spec-pack/tests/memory/koif_benchmark.test.ts`
- Modify: `db-archaeologist-pi-spec-pack/docs/keyword_operating_intelligence_framework_koif.md` if metric labels need a short appendix

- [ ] **Step 1: Write the failing test**

Cover:
- system metric aggregation
- KOIF business metric aggregation
- high KDS low PFS route repair check
- high TMS low KDS rejected from new product
- repeated-run stability for the same category

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/memory/koif_benchmark.test.ts`
Expected: fail because benchmark functions are missing.

- [ ] **Step 3: Write minimal implementation**

Implement:
- offline evaluation helpers
- route accuracy and stability metrics
- report summary for system and business layers

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/memory/koif_benchmark.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit benchmark and metric helpers.

## Chunk 6: Documentation and release checklist

**Files:**
- Modify: `db-archaeologist-pi-spec-pack/docs/superpowers/specs/2026-06-20-pi-memory-upgrade-design.md` if implementation details change
- Create: `db-archaeologist-pi-spec-pack/docs/superpowers/plans/2026-06-20-pi-memory-upgrade-validation.md` if a runbook is needed

- [ ] **Step 1: Verify all tests pass**

Run:
- `node --test tests/memory/normalize.test.ts`
- `node --test tests/memory/store.test.ts`
- `node --test tests/memory/pi_bridge.test.ts`
- `node --test tests/memory/feedback.test.ts`
- `node --test tests/memory/koif_benchmark.test.ts`

Expected: all PASS.

- [ ] **Step 2: Verify PI-specific integration path**

Check that the extension still loads and that the new memory hook code does not change existing tool registration behavior.

- [ ] **Step 3: Verify benchmark outputs**

Confirm the benchmark report shows:
- recall and ranking metrics improved
- stale injection rate down
- KOIF route accuracy and repeat stability up

- [ ] **Step 4: Commit**

Commit docs and validation notes.

