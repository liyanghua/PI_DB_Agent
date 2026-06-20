// markdown_validation_overlay_extractor.ts — 从全量验证版.md 提取 validation overlay
// 输入：docs/data_api/智能体数仓完整接口文档_全量验证版.md
// 输出：ValidationEntry[] + ParseFailure[]

import { createHash } from "node:crypto";
import { canonicalizePath, pathToApiId } from "../normalizers/path_canon.js";
import type { AuthInjectPolicy, VerifiedStatus } from "../lib/types.js";

export type ValidationEntry = {
  api_id: string;
  source_seq: number;
  source_line_no: number;
  module: string;
  business_module: string;
  analysis_domain: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path_raw: string;
  path_canon: string;
  base_url_segment: string;
  url_template: string;
  verified_url_full: string;
  body_template: Record<string, unknown>;
  auth_inject_policy: AuthInjectPolicy;
  verified_status: VerifiedStatus;
  verified_code?: string;
  verified_msg?: string;
  fix_note?: string;
  last_verified_at: null;
};

export type ParseFailure = {
  source_line_no: number;
  raw_line: string;
  failure_type:
    | "column_count_mismatch"
    | "url_unparseable"
    | "body_json_unparseable"
    | "status_emoji_unknown"
    | "api_id_collision"
    | "method_unknown";
  message: string;
};

export type ExtractResult = {
  meta: {
    source_sha256: string;
    source_line_count: number;
    table_header_line_no: number;
    entries_total: number;
    entries_parsed: number;
    entries_failed: number;
    status_distribution: Record<VerifiedStatus, number>;
  };
  entries: ValidationEntry[];
  failures: ParseFailure[];
};

const EXPECTED_HEADER = "| 序号 | 模块 | 业务模块 | 分析域 | 接口名称 | 方法 | 原URL/Path | 修复后状态 | 修复后可用URL | 修复后入参 | 说明/验证信息 |";
const SECTION_START = "## 🎯 所有接口列表（修复后验证结果）";

const STATUS_MAP: Record<string, VerifiedStatus> = {
  "✅ 成功": "success",
  "✅ 成功但空数据": "empty",
  "❌ 业务失败": "business_failed",
  "❌ 业务失败/请求失败": "business_failed",
  "🔒 无法测试": "untestable",
};

const VALID_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// 按反引号外的 | 切列（反引号内的 | 不切）
function splitByPipeOutsideBackticks(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inBacktick = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "`") inBacktick = !inBacktick;
    else if (c === "|" && !inBacktick) {
      cols.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  cols.push(current.trim());
  return cols.filter((c) => c !== ""); // 去掉首尾空列
}

function stripBackticks(s: string): string {
  return s.replace(/^`|`$/g, "");
}

function parseVerifiedUrl(fullUrl: string): { base_url_segment: string; url_template: string; host: string } | null {
  try {
    const u = new URL(fullUrl);
    const host = u.origin;
    const path = u.pathname;
    const query = u.search;

    // base_url_segment: 从 path 中提取 /openApi/api/<appId>/<version> 前缀
    const m = path.match(/^(\/openApi\/api\/\d+\/\d+)/);
    if (!m) {
      // 尝试兜底：如果没有标准前缀，base_url_segment 为空，url_template 为完整 path+query
      return { base_url_segment: "", url_template: path + query, host };
    }
    const base_url_segment = m[1];
    const url_template = path.slice(base_url_segment.length) + query;
    return { base_url_segment, url_template, host };
  } catch {
    return null;
  }
}

function inferAuthPolicy(_verifiedUrl: string): AuthInjectPolicy {
  // query_camel 负责 userId/tenantId；x-ca-* 是网关签名头，真实成功 curl 与上游错误均证明必须携带。
  return {
    style: "query_camel",
    identity_keys: ["userId", "tenantId"],
    headers_required: ["x-ca-appCodeKey", "x-ca-appCode"],
  };
}

function mapStatus(rawStatus: string, notes: string): VerifiedStatus {
  // unauthorized 优先：notes 含 Incorrect signature 或 appCodeKey does not authorize
  if (notes.includes("Incorrect signature") || notes.includes("appCodeKey does not authorize")) {
    return "unauthorized";
  }

  // 精确匹配
  if (STATUS_MAP[rawStatus]) return STATUS_MAP[rawStatus];

  // 模糊匹配
  if (rawStatus.includes("成功但空") || rawStatus.includes("空数据")) return "empty";
  if (rawStatus.includes("成功")) return "success";
  if (rawStatus.includes("业务失败") || rawStatus.includes("请求失败")) return "business_failed";
  if (rawStatus.includes("无法测试")) return "untestable";

  throw new Error(`unknown status: ${rawStatus}`);
}

function extractCodeMsg(notes: string): { code?: string; msg?: string; fix_note?: string } {
  const codeM = notes.match(/code[=:]([^\s;]+)/i);
  const msgM = notes.match(/msg[=:]([^;]+)/i);

  let fix_note = notes;
  if (codeM || msgM) {
    fix_note = notes.replace(/code[=:][^\s;]+/gi, "").replace(/msg[=:][^;]+/gi, "").trim();
    fix_note = fix_note.replace(/^[;,\s]+|[;,\s]+$/g, "").trim();
  }

  return {
    code: codeM ? codeM[1].trim() : undefined,
    msg: msgM ? msgM[1].trim() : undefined,
    fix_note: fix_note || undefined,
  };
}

export async function extractValidationOverlay(markdown: string): Promise<ExtractResult> {
  const lines = markdown.split(/\r?\n/);
  const hash = sha256(markdown);

  // 1. 找表头
  let headerLineNo = -1;
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === SECTION_START) {
      inSection = true;
      continue;
    }
    if (inSection && line === EXPECTED_HEADER) {
      headerLineNo = i + 1; // 1-based
      break;
    }
  }

  if (headerLineNo === -1) {
    throw new Error(`表头未找到：期望 "${EXPECTED_HEADER}"`);
  }

  // 2. 解析数据行
  const entries: ValidationEntry[] = [];
  const failures: ParseFailure[] = [];
  const apiIdSeen = new Map<string, number>(); // api_id -> first source_line_no
  const statusDist: Record<VerifiedStatus, number> = {
    success: 0,
    empty: 0,
    business_failed: 0,
    unauthorized: 0,
    untestable: 0,
  };

  const dataStart = headerLineNo + 1; // 跳过分隔行 |------:|
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;

    // 遇到下一个 ## 或 # 标题，终止
    if (line.trim().startsWith("## ") || line.trim().startsWith("# ")) break;
    if (!line.trim() || line.trim().startsWith("|------")) continue;

    const cols = splitByPipeOutsideBackticks(line);
    if (cols.length !== 11) {
      failures.push({
        source_line_no: lineNo,
        raw_line: line.slice(0, 500),
        failure_type: "column_count_mismatch",
        message: `期望 11 列，实际 ${cols.length} 列`,
      });
      continue;
    }

    try {
      const [seqStr, module, businessModule, analysisDomain, name, method, pathRaw, statusRaw, verifiedUrl, bodyRaw, notes] = cols;

      const seq = parseInt(seqStr!, 10);
      if (isNaN(seq)) throw new Error(`序号解析失败: ${seqStr}`);

      const methodUpper = method!.toUpperCase();
      if (!VALID_METHODS.has(methodUpper)) {
        failures.push({
          source_line_no: lineNo,
          raw_line: line.slice(0, 500),
          failure_type: "method_unknown",
          message: `未知 method: ${method}`,
        });
        continue;
      }

      const pathClean = stripBackticks(pathRaw!);
      const canon = canonicalizePath(pathClean);
      const api_id = pathToApiId(canon.path);

      // collision 检测
      if (apiIdSeen.has(api_id)) {
        failures.push({
          source_line_no: lineNo,
          raw_line: line.slice(0, 500),
          failure_type: "api_id_collision",
          message: `api_id=${api_id} 已存在于 line ${apiIdSeen.get(api_id)}`,
        });
        continue;
      }
      apiIdSeen.set(api_id, lineNo);

      const urlClean = stripBackticks(verifiedUrl!);
      const urlParsed = parseVerifiedUrl(urlClean);
      if (!urlParsed) {
        failures.push({
          source_line_no: lineNo,
          raw_line: line.slice(0, 500),
          failure_type: "url_unparseable",
          message: `修复后可用URL 解析失败: ${urlClean.slice(0, 100)}`,
        });
        continue;
      }

      const bodyClean = stripBackticks(bodyRaw!);
      let bodyTemplate: Record<string, unknown>;
      try {
        bodyTemplate = bodyClean ? JSON.parse(bodyClean) : {};
      } catch (e) {
        failures.push({
          source_line_no: lineNo,
          raw_line: line.slice(0, 500),
          failure_type: "body_json_unparseable",
          message: `修复后入参 JSON 解析失败: ${(e as Error).message}`,
        });
        continue;
      }

      let verified_status: VerifiedStatus;
      try {
        verified_status = mapStatus(statusRaw!, notes!);
      } catch (e) {
        failures.push({
          source_line_no: lineNo,
          raw_line: line.slice(0, 500),
          failure_type: "status_emoji_unknown",
          message: (e as Error).message,
        });
        continue;
      }

      statusDist[verified_status]++;

      const { code, msg, fix_note } = extractCodeMsg(notes!);

      entries.push({
        api_id,
        source_seq: seq,
        source_line_no: lineNo,
        module: module!,
        business_module: businessModule!,
        analysis_domain: analysisDomain!,
        name: name!,
        method: methodUpper as ValidationEntry["method"],
        path_raw: pathClean,
        path_canon: canon.path,
        base_url_segment: urlParsed.base_url_segment,
        url_template: urlParsed.url_template,
        verified_url_full: urlClean,
        body_template: bodyTemplate,
        auth_inject_policy: inferAuthPolicy(urlClean),
        verified_status,
        verified_code: code,
        verified_msg: msg,
        fix_note,
        last_verified_at: null,
      });
    } catch (e) {
      failures.push({
        source_line_no: lineNo,
        raw_line: line.slice(0, 500),
        failure_type: "column_count_mismatch",
        message: `行解析异常: ${(e as Error).message}`,
      });
    }
  }

  return {
    meta: {
      source_sha256: hash,
      source_line_count: lines.length,
      table_header_line_no: headerLineNo,
      entries_total: entries.length + failures.length,
      entries_parsed: entries.length,
      entries_failed: failures.length,
      status_distribution: statusDist,
    },
    entries,
    failures,
  };
}