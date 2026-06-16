// render.mjs
// 浏览器侧使用 window.markdownit + window.DOMPurify；Node smoke 用同源极简 fallback。
// 输出始终是 HTML 字符串。提供：
//   - renderMarkdown(src)
//   - renderHtmlSafe(html)
//   - renderDetails(details, hint?)  分发到 components.mjs 的 schema 渲染器
//   - escapeHtml / safeStringify 工具

import { detectKind, renderByKind, renderJsonTree } from "./components.mjs";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export function safeStringify(v) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

// ─────────────────────────────────────────────
// markdown
// ─────────────────────────────────────────────
let mdInstance = null;
function getMd() {
  if (mdInstance) return mdInstance;
  if (typeof globalThis !== "undefined" && globalThis.markdownit) {
    mdInstance = globalThis.markdownit({
      html: false,
      linkify: true,
      typographer: true,
      breaks: false,
    });
    const defaultRender = mdInstance.renderer.rules.link_open || function (tokens, idx, opts, env, self) {
      return self.renderToken(tokens, idx, opts);
    };
    mdInstance.renderer.rules.link_open = function (tokens, idx, opts, env, self) {
      const t = tokens[idx];
      const aIdx = t.attrIndex("target");
      if (aIdx < 0) t.attrPush(["target", "_blank"]);
      else t.attrs[aIdx][1] = "_blank";
      const rIdx = t.attrIndex("rel");
      if (rIdx < 0) t.attrPush(["rel", "noopener noreferrer"]);
      else t.attrs[rIdx][1] = "noopener noreferrer";
      return defaultRender(tokens, idx, opts, env, self);
    };
    const defImg = mdInstance.renderer.rules.image;
    mdInstance.renderer.rules.image = function (tokens, idx, opts, env, self) {
      const t = tokens[idx];
      const src = t.attrGet("src") || "";
      if (!isAllowedImgSrc(src)) return `<span class="text-zinc-400 text-[11.5px]">[blocked img]</span>`;
      const li = t.attrIndex("loading");
      if (li < 0) t.attrPush(["loading", "lazy"]);
      return defImg ? defImg(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
    };
    return mdInstance;
  }
  mdInstance = { render: fallbackMd };
  return mdInstance;
}

function isAllowedImgSrc(src) {
  return /^https?:\/\//i.test(src) || /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src);
}

export function renderMarkdown(src) {
  if (!src) return "";
  const html = getMd().render(String(src));
  return renderHtmlSafe(html);
}

// ─────────────────────────────────────────────
// sanitize
// ─────────────────────────────────────────────
const ALLOWED_TAGS = [
  "a", "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "code", "pre", "blockquote", "strong", "em", "del", "s",
  "hr", "br", "span", "div", "img",
  "details", "summary",
];
const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "class", "colspan", "rowspan",
  "target", "rel", "loading", "open", "data-anchor",
];

export function renderHtmlSafe(html) {
  if (!html) return "";
  if (typeof globalThis !== "undefined" && globalThis.DOMPurify) {
    return globalThis.DOMPurify.sanitize(String(html), {
      ALLOWED_TAGS, ALLOWED_ATTR,
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "link", "meta", "form", "input", "button"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "style"],
    });
  }
  return stripDangerous(String(html));
}

function stripDangerous(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
}

// ─────────────────────────────────────────────
// fallback markdown (Node smoke / no CDN)
// 复用旧 markdown.mjs 的逻辑，但加上 GFM table。
// ─────────────────────────────────────────────
function inline(s) {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) =>
    isAllowedImgSrc(url) ? `<img src="${url}" alt="${alt}" loading="lazy"/>` : `[img]`);
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${txt}</a>`);
  return t;
}

function fallbackMd(src) {
  const lines = String(src).replace(/\r\n/g, "\n").split("\n");
  let out = "";
  let i = 0;
  let inList = null;
  const closeList = () => { if (inList) { out += `</${inList}>`; inList = null; } };

  while (i < lines.length) {
    const ln = lines[i];

    const fence = ln.match(/^```(\w+)?\s*$/);
    if (fence) {
      closeList();
      const lang = fence[1] || "";
      i++;
      const buf = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out += `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(buf.join("\n"))}</code></pre>`;
      continue;
    }

    if (/^---+\s*$/.test(ln)) { closeList(); out += "<hr/>"; i++; continue; }

    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); out += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; i++; continue; }

    // GFM table: header | header \n --- | --- \n row | row
    if (/\|/.test(ln) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      closeList();
      const splitRow = (s) => s.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((x) => x.trim());
      const headers = splitRow(ln);
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== "") { rows.push(splitRow(lines[i])); i++; }
      out += "<table><thead><tr>" + headers.map((h) => `<th>${inline(h)}</th>`).join("") + "</tr></thead><tbody>";
      for (const r of rows) out += "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
      out += "</tbody></table>";
      continue;
    }

    const ul = ln.match(/^\s*[-*]\s+(.*)$/);
    if (ul) { if (inList !== "ul") { closeList(); out += "<ul>"; inList = "ul"; } out += `<li>${inline(ul[1])}</li>`; i++; continue; }
    const ol = ln.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) { if (inList !== "ol") { closeList(); out += "<ol>"; inList = "ol"; } out += `<li>${inline(ol[1])}</li>`; i++; continue; }

    if (/^\s*>\s?/.test(ln)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out += `<blockquote>${inline(buf.join(" "))}</blockquote>`;
      continue;
    }

    if (ln.trim() === "") { closeList(); i++; continue; }
    closeList();
    out += `<p>${inline(ln)}</p>`;
    i++;
  }
  closeList();
  return out;
}

// ─────────────────────────────────────────────
// details dispatcher
// ─────────────────────────────────────────────
const SIZE_GUARD = 256 * 1024;

export function renderDetails(details, hint) {
  if (details == null) return `<div class="text-zinc-400 text-[12px]">(empty)</div>`;
  let serialized = "";
  try { serialized = JSON.stringify(details); } catch { serialized = String(details); }
  if (serialized.length > SIZE_GUARD) {
    return `<div class="text-[11.5px] text-amber-700 mb-2">payload ${(serialized.length/1024).toFixed(0)}KB · 已降级为 JSON 树</div>` +
           renderJsonTree(details, { collapsed: true });
  }
  if (typeof details === "string") {
    if (hint?.mime === "text/html") return renderHtmlSafe(details);
    if (hint?.mime === "text/markdown") return `<div class="markdown">${renderMarkdown(details)}</div>`;
    return `<pre class="text-[11.5px] font-mono whitespace-pre-wrap text-zinc-800">${escapeHtml(details)}</pre>`;
  }
  const kind = detectKind(details, hint);
  return renderByKind(kind, details, { renderMarkdown, escapeHtml });
}

export function detectDetailsKind(details, hint) { return detectKind(details, hint); }