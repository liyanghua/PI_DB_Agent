#!/usr/bin/env node
/**
 * audit_competition_domain.ts
 * 
 * 竞争域 19 接口审计脚本
 * 
 * 功能：
 * 1. 从 registry/derived/api_asset_cards.json 筛选 domain="竞争域" 的接口
 * 2. 按 quality_score / lifecycle_status / 字段信号强度排序
 * 3. 输出 registry/derived/competition_domain_audit.md 报告
 * 4. 标注 P0 候选集合（预计 4-6 个）
 * 
 * 运行：cd <spec-pack> && node --import ./scripts/ts_loader.mjs scripts/audit_competition_domain.ts
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface ApiAssetCard {
  api_id: string;
  name: string;
  path: string;
  method: string;
  domain: string;
  lifecycle_status: string;
  quality_score: number;
  source_line_no: number;
  request_schema?: {
    query?: Array<{ name: string; desc: string; required: boolean }>;
    body?: Array<{ name: string; desc: string; required: boolean }>;
  };
  response_example?: any;
  response_fields?: Array<{ name: string; desc: string }>;
  verified_call?: {
    real_url?: string;
    real_body?: any;
  };
}

interface AuditRecord {
  api_id: string;
  name: string;
  path: string;
  method: string;
  lifecycle_status: string;
  quality_score: number;
  source_line_no: number;
  has_competition_signal: boolean;
  signal_fields: string[];
  verified_call_covered: boolean;
  p0_candidate: boolean;
  notes: string[];
}

const COMPETITION_KEYWORDS = [
  "competition",
  "competitor",
  "竞争",
  "竞品",
  "brand",
  "品牌",
  "bid",
  "出价",
  "cpc",
  "market",
  "市场",
  "share",
  "份额",
  "concentration",
  "集中度"
];

function detectCompetitionSignal(card: ApiAssetCard): { has: boolean; fields: string[] } {
  const fields: string[] = [];
  
  // 检查 path
  if (COMPETITION_KEYWORDS.some(kw => card.path.toLowerCase().includes(kw))) {
    fields.push(`path含关键词`);
  }
  
  // 检查 request_schema
  const allParams = [
    ...(card.request_schema?.query || []),
    ...(card.request_schema?.body || [])
  ];
  
  for (const param of allParams) {
    const paramText = `${param.name} ${param.desc || ""}`.toLowerCase();
    if (COMPETITION_KEYWORDS.some(kw => paramText.includes(kw))) {
      fields.push(`param:${param.name}`);
    }
  }
  
  // 检查 response_fields
  if (card.response_fields) {
    for (const field of card.response_fields) {
      const fieldText = `${field.name} ${field.desc || ""}`.toLowerCase();
      if (COMPETITION_KEYWORDS.some(kw => fieldText.includes(kw))) {
        fields.push(`resp:${field.name}`);
      }
    }
  }
  
  return { has: fields.length > 0, fields };
}

function assessP0Candidate(record: AuditRecord): boolean {
  // P0 标准：
  // 1. quality_score >= 0.7
  // 2. lifecycle_status = agent_ready 或 verified
  // 3. has_competition_signal = true
  // 4. 优先 verified_call_covered = true
  
  if (record.quality_score < 0.7) return false;
  if (!["agent_ready", "verified"].includes(record.lifecycle_status)) return false;
  if (!record.has_competition_signal) return false;
  
  return true;
}

async function main() {
  const rootDir = process.cwd();
  const cardsPath = join(rootDir, "registry/derived/api_asset_cards.json");
  const outputPath = join(rootDir, "registry/derived/competition_domain_audit.md");
  
  if (!existsSync(cardsPath)) {
    console.error(`❌ ${cardsPath} 不存在`);
    process.exit(1);
  }
  
  console.log(`📊 读取 ${cardsPath}...`);
  const cardsData = JSON.parse(readFileSync(cardsPath, "utf-8"));
  const allCards: ApiAssetCard[] = cardsData.cards || [];
  
  // 筛选竞争域
  const competitionCards = allCards.filter(c => c.domain === "竞争域");
  console.log(`🔍 竞争域接口总数：${competitionCards.length}`);
  
  // 审计
  const auditRecords: AuditRecord[] = competitionCards.map(card => {
    const signal = detectCompetitionSignal(card);
    const verified = !!(card.verified_call?.real_url || card.verified_call?.real_body);
    
    const record: AuditRecord = {
      api_id: card.api_id,
      name: card.name,
      path: card.path,
      method: card.method,
      lifecycle_status: card.lifecycle_status,
      quality_score: card.quality_score,
      source_line_no: card.source_line_no,
      has_competition_signal: signal.has,
      signal_fields: signal.fields,
      verified_call_covered: verified,
      p0_candidate: false,
      notes: []
    };
    
    // P0 评估
    record.p0_candidate = assessP0Candidate(record);
    
    // 备注
    if (record.quality_score < 0.5) {
      record.notes.push("质量分偏低");
    }
    if (!signal.has) {
      record.notes.push("无明显竞争信号");
    }
    if (!verified) {
      record.notes.push("未覆盖全量验证版");
    }
    
    return record;
  });
  
  // 排序：P0 候选优先，然后按 quality_score 降序
  auditRecords.sort((a, b) => {
    if (a.p0_candidate !== b.p0_candidate) {
      return a.p0_candidate ? -1 : 1;
    }
    return b.quality_score - a.quality_score;
  });
  
  const p0Count = auditRecords.filter(r => r.p0_candidate).length;
  console.log(`✅ P0 候选接口：${p0Count} 个`);
  
  // 生成报告
  const lines: string[] = [
    "# 竞争域接口审计报告",
    "",
    `> 生成时间：${new Date().toISOString()}  `,
    `> 竞争域接口总数：${competitionCards.length}  `,
    `> P0 候选接口：${p0Count}`,
    "",
    "---",
    "",
    "## 1. P0 候选集合",
    "",
    "以下接口满足 P0 标准（quality_score ≥ 0.7 + agent_ready/verified + 含竞争信号）：",
    ""
  ];
  
  const p0Records = auditRecords.filter(r => r.p0_candidate);
  if (p0Records.length === 0) {
    lines.push("⚠️ 暂无符合 P0 标准的接口。建议降低 quality_score 阈值或扩大竞争信号关键词范围。");
  } else {
    lines.push("| api_id | name | quality | lifecycle | 竞争信号 | 全量验证版 | 备注 |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    
    for (const r of p0Records) {
      lines.push(
        `| \`${r.api_id}\` | ${r.name} | ${r.quality_score.toFixed(3)} | ${r.lifecycle_status} | ${r.signal_fields.join(", ") || "-"} | ${r.verified_call_covered ? "✅" : "❌"} | ${r.notes.join("; ") || "-"} |`
      );
    }
  }
  
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. 完整审计表（全部竞争域接口）");
  lines.push("");
  lines.push("| api_id | name | path | method | quality | lifecycle | P0? | 竞争信号 | 全量验证版 | 备注 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  
  for (const r of auditRecords) {
    lines.push(
      `| \`${r.api_id}\` | ${r.name} | \`${r.path}\` | ${r.method} | ${r.quality_score.toFixed(3)} | ${r.lifecycle_status} | ${r.p0_candidate ? "✅" : ""} | ${r.signal_fields.join(", ") || "-"} | ${r.verified_call_covered ? "✅" : "❌"} | ${r.notes.join("; ") || "-"} |`
    );
  }
  
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 3. 下一步建议");
  lines.push("");
  
  if (p0Count >= 4 && p0Count <= 6) {
    lines.push(`✅ P0 候选接口数量（${p0Count}）符合预期（4-6 个），可进入 mapping 扩展阶段。`);
  } else if (p0Count < 4) {
    lines.push(`⚠️ P0 候选接口不足 4 个，建议：`);
    lines.push(`- 检查 quality_score 阈值是否过严（当前 ≥ 0.7）`);
    lines.push(`- 扩大竞争信号关键词范围`);
    lines.push(`- 降级部分 lifecycle_status=candidate 的接口进入 P0`);
  } else {
    lines.push(`⚠️ P0 候选接口过多（${p0Count} 个），建议按以下优先级筛选：`);
    lines.push(`1. verified_call_covered = true 优先`);
    lines.push(`2. quality_score 最高的 6 个`);
    lines.push(`3. 信号字段覆盖度最全的（brand + bid + market）`);
  }
  
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 4. 竞争信号关键词表");
  lines.push("");
  lines.push("当前使用的竞争信号关键词：");
  lines.push("");
  lines.push(COMPETITION_KEYWORDS.map(kw => `- ${kw}`).join("\n"));
  lines.push("");
  lines.push("若需扩展，修改 `scripts/audit_competition_domain.ts` 中的 `COMPETITION_KEYWORDS`。");
  lines.push("");
  
  const reportContent = lines.join("\n");
  writeFileSync(outputPath, reportContent, "utf-8");
  
  console.log(`📄 报告已写入 ${outputPath}`);
  console.log("");
  console.log("📊 统计摘要：");
  console.log(`   竞争域接口总数：${competitionCards.length}`);
  console.log(`   P0 候选接口：${p0Count}`);
  console.log(`   含竞争信号：${auditRecords.filter(r => r.has_competition_signal).length}`);
  console.log(`   全量验证版覆盖：${auditRecords.filter(r => r.verified_call_covered).length}`);
  console.log("");
  
  if (p0Count < 3) {
    console.warn("⚠️  警告：P0 候选接口少于 3 个，CPS 公式可能无足够数据源支撑");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("❌ 审计失败：", err);
  process.exit(1);
});