// 洞察画布前端
// 数据流：用户填 topic → /api/insight/propose → plan → 渲染三栏 →
// 用户勾选字段 → 客户端 recompute output_schema 与 coverage → /api/insight/save。

const $ = (id) => document.getElementById(id);
const refs = {
  topic: $("topicInput"),
  template: $("templateSelect"),
  templateMeta: $("templateMeta"),
  limit: $("limitInput"),
  scopeTime: $("scopeTime"),
  scopeEntities: $("scopeEntities"),
  propose: $("proposeBtn"),
  save: $("saveBtn"),
  copyPrompt: $("copyPromptBtn"),
  saved: $("savedList"),
  candidates: $("candidatesPane"),
  output: $("outputPane"),
  status: $("statusLabel"),
  planMeta: $("planMeta"),
  coverage: $("coverageBadge"),
  missing: $("missingBadge"),
};

const state = {
  templates: [],
  plan: null,
};

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}
async function postJson(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${url} ${r.status}`);
  return j;
}

function setStatus(s, kind = "mute") {
  refs.status.textContent = s;
  refs.status.className = "text-[11px] " + (kind === "err" ? "text-red-600" : kind === "ok" ? "text-emerald-600" : "text-zinc-500");
}

// ─────────── templates ───────────

async function loadTemplates() {
  try {
    const r = await getJson("/api/insight/templates");
    state.templates = r.templates ?? [];
    refs.template.innerHTML = `<option value="">（按 topic 自动匹配）</option>` +
      state.templates.map(t => `<option value="${t.key}">${t.cn_name} (${t.key})</option>`).join("");
    refs.template.addEventListener("change", () => renderTemplateMeta());
    renderTemplateMeta();
  } catch (e) {
    setStatus(`模板加载失败: ${e.message}`, "err");
  }
}

function renderTemplateMeta() {
  const key = refs.template.value;
  if (!key) { refs.templateMeta.textContent = ""; return; }
  const tpl = state.templates.find(t => t.key === key);
  if (!tpl) { refs.templateMeta.textContent = ""; return; }
  refs.templateMeta.innerHTML = `
    <div>必须维度: ${tpl.required_dimensions.map(d => `<code>${d}</code>`).join(" · ") || "—"}</div>
    <div>必须指标: ${tpl.required_metrics.map(m => `<code>${m}</code>`).join(" · ") || "—"}</div>
    <div class="text-zinc-400">领域偏好: ${tpl.preferred_domains.join(" / ") || "—"}</div>
    <div class="text-zinc-400">输出粒度: ${tpl.output_grain || "—"}</div>
  `;
}

// ─────────── saved list ───────────

async function loadSaved() {
  try {
    const r = await getJson("/api/insight/list?limit=20");
    const items = r.plans ?? [];
    if (!items.length) {
      refs.saved.innerHTML = `<div class="text-zinc-400">（暂无）</div>`;
      return;
    }
    refs.saved.innerHTML = items.map(it => {
      const cov = it.coverage_pct == null ? "—" : `${(it.coverage_pct * 100).toFixed(0)}%`;
      return `
        <div class="border border-zinc-200 rounded px-2 py-1.5 hover:bg-white cursor-pointer" data-plan="${it.plan_id}">
          <div class="font-medium text-zinc-800 truncate">${escapeHtml(it.topic || "(no topic)")}</div>
          <div class="text-[11px] text-zinc-500 flex items-center gap-2">
            <span>${escapeHtml(it.template_cn_name || it.template_key || "")}</span>
            <span>·</span>
            <span>cov ${cov}</span>
          </div>
        </div>`;
    }).join("");
    refs.saved.querySelectorAll("[data-plan]").forEach(el => {
      el.addEventListener("click", async () => {
        const id = el.getAttribute("data-plan");
        try {
          setStatus("加载方案…");
          const plan = await getJson(`/api/insight/get?plan_id=${encodeURIComponent(id)}`);
          state.plan = plan;
          refs.topic.value = plan.topic || "";
          refs.template.value = plan.template_key || "";
          renderTemplateMeta();
          render();
          setStatus("已加载", "ok");
        } catch (e) { setStatus(`加载失败: ${e.message}`, "err"); }
      });
    });
  } catch (e) {
    refs.saved.innerHTML = `<div class="text-red-600">加载失败: ${escapeHtml(e.message)}</div>`;
  }
}

// ─────────── propose ───────────

async function propose() {
  const topic = refs.topic.value.trim();
  if (!topic) { setStatus("请输入洞察方向", "err"); return; }
  const limit = Math.max(3, Math.min(30, Number(refs.limit.value) || 12));
  const scope = {};
  if (refs.scopeTime.value.trim()) scope.time_range = refs.scopeTime.value.trim();
  if (refs.scopeEntities.value.trim()) {
    scope.target_entities = refs.scopeEntities.value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  }
  refs.propose.disabled = true;
  setStatus("生成中…");
  try {
    const plan = await postJson("/api/insight/propose", {
      topic,
      template_key: refs.template.value || undefined,
      candidate_limit: limit,
      scope: Object.keys(scope).length ? scope : undefined,
    });
    state.plan = plan;
    render();
    setStatus(`已生成 · cov ${(plan.coverage_report.coverage_pct * 100).toFixed(0)}%`, "ok");
  } catch (e) {
    setStatus(`生成失败: ${e.message}`, "err");
  } finally {
    refs.propose.disabled = false;
  }
}

// ─────────── render ───────────

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function roleBadge(role) {
  return `<span class="badge role-${role}">${role}</span>`;
}

function render() {
  if (!state.plan) {
    refs.candidates.innerHTML = `<div class="text-zinc-400 text-[12.5px]">暂无方案。</div>`;
    refs.output.innerHTML = `<div class="text-zinc-400">无方案。</div>`;
    refs.planMeta.textContent = "";
    refs.coverage.classList.add("hidden");
    refs.missing.classList.add("hidden");
    refs.save.disabled = true;
    refs.copyPrompt.disabled = true;
    return;
  }
  const plan = state.plan;
  refs.planMeta.textContent = `${plan.template_cn_name} · ${plan.candidate_apis.length} 个候选 · plan_id=${plan.plan_id}`;
  const cov = plan.coverage_report.coverage_pct ?? 0;
  refs.coverage.textContent = `coverage ${(cov * 100).toFixed(0)}%`;
  refs.coverage.className = "badge ml-auto " + (cov >= 0.7 ? "badge-ok" : cov >= 0.4 ? "badge-warn" : "badge-mute");
  refs.coverage.classList.remove("hidden");
  refs.save.disabled = false;
  refs.copyPrompt.disabled = false;

  refs.candidates.innerHTML = plan.candidate_apis.map((c, ci) => renderCandidate(c, ci)).join("") || `<div class="text-zinc-400">未匹配到候选 API。</div>`;
  attachCandidateHandlers();
  renderOutput();
}

function renderCandidate(c, ci) {
  const fields = c.selected_fields.map((sf, fi) => renderField(sf, ci, fi)).join("");
  const gaps = c.gaps.length ? `<div class="text-[11.5px] text-amber-700 mt-1">⚠ ${c.gaps.map(escapeHtml).join("、")}</div>` : "";
  const missing = c.missing_required_params.length
    ? `<div class="text-[11.5px] text-zinc-500 mt-1">missing required: ${c.missing_required_params.map(escapeHtml).join("、")}</div>`
    : "";
  const roleBadgeMap = { primary: "badge-info", supplement: "badge-mute", fallback: "badge-warn" };
  return `
    <details class="api-card card-shadow" data-ci="${ci}" ${c.role_in_plan === "primary" ? "open" : ""}>
      <summary class="flex items-center gap-2">
        <span class="badge ${roleBadgeMap[c.role_in_plan] || "badge-mute"}">${c.role_in_plan}</span>
        <span class="font-medium text-[13px]">${escapeHtml(c.api_name)}</span>
        <span class="text-[11.5px] text-zinc-500 font-mono truncate">${escapeHtml(c.api_path)}</span>
        <span class="ml-auto text-[11px] text-zinc-500">score ${c.score.toFixed(2)} · q ${c.quality_score.toFixed(2)} · ${escapeHtml(c.lifecycle_status)}</span>
      </summary>
      <div class="mt-2 text-[11.5px] text-zinc-500">${escapeHtml(c.reasons.slice(0, 3).join(" | "))}</div>
      <div class="mt-2 space-y-0.5">${fields || `<div class="text-zinc-400">无字段</div>`}</div>
      ${gaps}
      ${missing}
    </details>
  `;
}

function renderField(sf, ci, fi) {
  const checked = sf.selected ? "checked" : "";
  const conf = (sf.confidence * 100).toFixed(0);
  const mapped = sf.mapped_to_output ? `<span class="badge badge-ok">→ ${escapeHtml(sf.mapped_to_output)}</span>` : "";
  return `
    <label class="field-row hover:bg-zinc-50 rounded px-1">
      <input type="checkbox" data-ci="${ci}" data-fi="${fi}" ${checked} class="accent-iris-500" />
      <div>
        <div class="path">${escapeHtml(sf.field_path)} ${roleBadge(sf.role)} ${mapped}</div>
        ${sf.field_desc ? `<div class="desc">${escapeHtml(sf.field_desc)}</div>` : ""}
      </div>
      <span class="text-[11px] text-zinc-500">${conf}%</span>
    </label>
  `;
}

function attachCandidateHandlers() {
  refs.candidates.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      const ci = Number(cb.getAttribute("data-ci"));
      const fi = Number(cb.getAttribute("data-fi"));
      const sf = state.plan.candidate_apis[ci].selected_fields[fi];
      sf.selected = cb.checked;
      sf.source = "manual";
      recomputeOutputSchema();
      renderOutput();
    });
  });
}

// ─────────── recompute output_schema (client-side) ───────────

function recomputeOutputSchema() {
  const plan = state.plan;
  const cols = [];
  const allDims = new Set();
  const allMetrics = new Set();
  for (const c of plan.candidate_apis) {
    for (const sf of c.selected_fields) {
      if (!sf.selected) continue;
      if (sf.role === "metric" && sf.matched_metric) allMetrics.add(sf.matched_metric);
      if ((sf.role === "dim" || sf.role === "time") && sf.matched_dim) allDims.add(sf.matched_dim);
    }
  }
  function bestPick(predicate) {
    let pick;
    for (const c of plan.candidate_apis) {
      for (const sf of c.selected_fields) {
        if (!sf.selected) continue;
        if (!predicate(sf)) continue;
        if (!pick || sf.confidence > pick.conf) pick = { conf: sf.confidence, api_id: c.api_id, field_path: sf.field_path, type: sf.field_type };
      }
    }
    return pick;
  }
  // 维持以模板必需字段为主轴；其它命中的指标/维度也一起加
  const templateDims = inferTemplateDims(plan);
  const templateMetrics = inferTemplateMetrics(plan);
  for (const dim of templateDims) {
    const pick = bestPick(sf => (dim === "time" ? sf.role === "time" : sf.role === "dim" && sf.matched_dim === dim));
    if (pick) cols.push({ col_name: dim === "time" ? "stat_date" : dim, role: dim === "time" ? "time" : "dim", source: { api_id: pick.api_id, field_path: pick.field_path }, type: pick.type, required_by_template: true });
  }
  for (const metric of templateMetrics) {
    const pick = bestPick(sf => sf.role === "metric" && sf.matched_metric === metric);
    if (pick) cols.push({ col_name: metric, role: "metric", source: { api_id: pick.api_id, field_path: pick.field_path }, type: pick.type, required_by_template: true });
  }
  // mapped_to_output 同步
  const sourceLookup = new Map();
  for (const col of cols) sourceLookup.set(`${col.source.api_id}::${col.source.field_path}`, col.col_name);
  for (const c of plan.candidate_apis) {
    for (const sf of c.selected_fields) {
      const key = `${c.api_id}::${sf.field_path}`;
      const m = sourceLookup.get(key);
      sf.mapped_to_output = m || null;
      sf.suggested_alias = m || null;
    }
  }
  // coverage
  const reqDims = templateDims.length;
  const reqMetrics = templateMetrics.length;
  const dimHit = templateDims.filter(d => allDims.has(d)).length;
  const metricHit = templateMetrics.filter(m => allMetrics.has(m)).length;
  const total = reqDims + reqMetrics;
  const missing = [
    ...templateDims.filter(d => !allDims.has(d)).map(d => `dim:${d}`),
    ...templateMetrics.filter(m => !allMetrics.has(m)).map(m => `metric:${m}`),
  ];
  plan.output_schema = cols;
  plan.coverage_report = {
    required_dim_covered: templateDims.filter(d => allDims.has(d)),
    required_metric_covered: templateMetrics.filter(m => allMetrics.has(m)),
    missing_required: missing,
    confidence_avg: plan.coverage_report?.confidence_avg ?? 0,
    coverage_pct: total === 0 ? 1 : +((dimHit + metricHit) / total).toFixed(3),
  };
}

function inferTemplateDims(plan) {
  const tpl = state.templates.find(t => t.key === plan.template_key);
  return tpl?.required_dimensions ?? [];
}
function inferTemplateMetrics(plan) {
  const tpl = state.templates.find(t => t.key === plan.template_key);
  return tpl?.required_metrics ?? [];
}

function renderOutput() {
  const plan = state.plan;
  if (!plan) return;
  const rows = plan.output_schema.map(col => `
    <tr>
      <td class="font-mono">${escapeHtml(col.col_name)}</td>
      <td>${roleBadge(col.role)}</td>
      <td class="font-mono text-[11px] text-zinc-500">${escapeHtml(col.source.api_id)}</td>
      <td class="font-mono text-[11px] text-zinc-500">${escapeHtml(col.source.field_path)}</td>
    </tr>`).join("");
  const cov = plan.coverage_report;
  const covPct = (cov.coverage_pct * 100).toFixed(0);
  const covClass = cov.coverage_pct >= 0.7 ? "badge-ok" : cov.coverage_pct >= 0.4 ? "badge-warn" : "badge-mute";
  refs.output.innerHTML = `
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <span class="badge ${covClass}">coverage ${covPct}%</span>
        <span class="text-[11px] text-zinc-500">${cov.required_dim_covered.length + cov.required_metric_covered.length}/${cov.required_dim_covered.length + cov.required_metric_covered.length + cov.missing_required.length} 必需项</span>
      </div>
      ${cov.missing_required.length ? `<div class="text-[11.5px] text-amber-700">缺口: ${cov.missing_required.map(escapeHtml).join("、")}</div>` : `<div class="text-[11.5px] text-emerald-700">无缺口 ✓</div>`}
      <table class="data-table">
        <thead><tr><th>col_name</th><th>role</th><th>api_id</th><th>field_path</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="text-zinc-400 text-center">空</td></tr>`}</tbody>
      </table>
      <details class="text-[11.5px]">
        <summary class="cursor-pointer text-zinc-500 hover:text-zinc-800">LLM 精排 prompt</summary>
        <pre class="mt-2 bg-zinc-50 border border-zinc-200 rounded p-2 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11px]">${escapeHtml(plan.llm_refinement_prompt || "")}</pre>
      </details>
    </div>
  `;
  refs.missing.classList.toggle("hidden", cov.missing_required.length === 0);
  if (cov.missing_required.length) refs.missing.textContent = `${cov.missing_required.length} 项缺口`;
}

// ─────────── save / copy ───────────

async function save() {
  if (!state.plan) return;
  refs.save.disabled = true;
  setStatus("保存中…");
  try {
    const r = await postJson("/api/insight/save", { plan: state.plan });
    setStatus(`已保存 ${r.plan_id}`, "ok");
    await loadSaved();
  } catch (e) {
    setStatus(`保存失败: ${e.message}`, "err");
  } finally {
    refs.save.disabled = false;
  }
}

async function copyPrompt() {
  if (!state.plan?.llm_refinement_prompt) return;
  try {
    await navigator.clipboard.writeText(state.plan.llm_refinement_prompt);
    setStatus("prompt 已复制", "ok");
  } catch {
    setStatus("剪贴板不可用", "err");
  }
}

// ─────────── boot ───────────

refs.propose.addEventListener("click", propose);
refs.save.addEventListener("click", save);
refs.copyPrompt.addEventListener("click", copyPrompt);
refs.topic.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") propose();
});

await loadTemplates();
await loadSaved();