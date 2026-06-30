#!/usr/bin/env python3
"""Shared helpers for business strategy skill generation."""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from typing import Any


SCHEMA_VERSION_V1 = "biz-strategy-meta-v1"
SCHEMA_VERSION = "biz-strategy-meta-v2"
EXPERT_PERSPECTIVE = "客户业务专家视角"
GROWTH_PERSPECTIVE = "经营增长目标维度"
EXPERT_FIELDS = [
    "业务场景",
    "场景目标",
    "输出成果",
    "流程图或业务模型",
    "执行步骤",
    "关键节点思路说明",
    "页面截图",
    "常见问题类型",
    "判断依据/指标",
    "判断标准",
    "问题解决方法/执行动作",
    "流程触发与终止条件",
    "方法是否有效的验证方式",
    "工具表单模板",
]
GROWTH_FIELDS = [
    "目标",
    "对象",
    "场景",
    "问题分类",
    "核心变量",
    "判断指标",
    "判断标准",
    "因果关系",
    "决策顺序",
    "建议动作",
    "执行条件",
    "例外情况",
    "验证方式",
    "迭代日期",
]
PERSPECTIVE_FIELDS = {
    EXPERT_PERSPECTIVE: EXPERT_FIELDS,
    GROWTH_PERSPECTIVE: GROWTH_FIELDS,
}
V1_FIELDS = GROWTH_FIELDS
FIELD_ALIASES = {
    EXPERT_PERSPECTIVE: {
        "业务场景": ["业务场景"],
        "场景目标": ["场景目标", "任务目标"],
        "输出成果": ["输出成果", "交付成果"],
        "流程图或业务模型": ["流程图或业务模型", "业务模型", "流程图", "诊断模型"],
        "执行步骤": ["执行步骤", "操作步骤"],
        "关键节点思路说明": ["关键节点思路说明", "为什么这么做", "关键节点"],
        "页面截图": ["页面截图", "关键页面", "操作页面"],
        "常见问题类型": ["常见问题类型", "常见问题"],
        "判断依据/指标": ["判断依据/指标", "判断依据"],
        "判断标准": ["判断标准"],
        "问题解决方法/执行动作": ["问题解决方法/执行动作", "问题解决方法", "执行动作"],
        "流程触发与终止条件": ["流程触发与终止条件", "触发条件", "终止条件", "流程触发"],
        "方法是否有效的验证方式": ["方法是否有效的验证方式", "有效验证方式"],
        "工具表单模板": ["工具表单模板", "工具模板", "表单模板"],
    },
    GROWTH_PERSPECTIVE: {
        "目标": ["目标", "核心目标"],
        "对象": ["对象", "研究对象", "分析对象"],
        "场景": ["场景", "适用场景"],
        "问题分类": ["问题分类", "常见问题类型", "问题类型"],
        "核心变量": ["核心变量", "关键变量", "变量"],
        "判断指标": ["判断指标"],
        "判断标准": ["判断标准", "标准", "阈值"],
        "因果关系": ["因果关系", "为什么", "原因"],
        "决策顺序": ["决策顺序"],
        "建议动作": ["建议动作"],
        "执行条件": ["执行条件"],
        "例外情况": ["例外情况", "边界", "不成立"],
        "验证方式": ["验证方式", "复盘指标"],
        "迭代日期": ["迭代日期", "更新时间", "最近一次迭代"],
    },
}
V1_FIELD_ALIASES = {
    "目标": ["目标", "场景目标", "核心目标"],
    "对象": ["对象", "研究对象", "分析对象"],
    "场景": ["场景", "业务场景", "适用场景"],
    "问题分类": ["问题分类", "常见问题类型", "问题类型"],
    "核心变量": ["核心变量", "关键变量", "变量"],
    "判断指标": ["判断指标", "判断依据", "指标"],
    "判断标准": ["判断标准", "标准", "阈值"],
    "因果关系": ["因果关系", "为什么", "原因"],
    "决策顺序": ["决策顺序", "执行步骤", "流程"],
    "建议动作": ["建议动作", "问题解决方法", "执行动作", "动作"],
    "执行条件": ["执行条件", "触发条件", "流程触发"],
    "例外情况": ["例外情况", "边界", "不成立"],
    "验证方式": ["验证方式", "方法是否有效的验证方式", "复盘指标"],
    "迭代日期": ["迭代日期", "更新时间", "最近一次迭代"],
}
SEMANTIC_CONFIDENCE = 0.68
SEMANTIC_RULES = {
    EXPERT_PERSPECTIVE: {
        "关键节点思路说明": {
            "value": "先明确分析边界，按全域趋势→行业结构→竞品竞店→用户需求→价格空间→产品与链接规划推进。",
            "keywords": [
                "先明确“分析对象是谁”",
                "避免市场洞察变成泛泛而谈",
                "先看全域趋势",
                "先看行业结构",
                "再看竞品竞店",
                "再看用户需求",
                "再看价格空间",
                "最后落到产品和链接规划",
            ],
        },
        "判断依据/指标": {
            "value": "销量/支付买家数、GMV/交易指数、客单价、价格带、搜索人气、增长率、评价/问大家、CTR/CVR、成交人数、利润空间。",
            "keywords": [
                "销量/支付买家数",
                "GMV/交易指数",
                "客单价",
                "价格带",
                "搜索人气",
                "增长率",
                "评价/问大家",
                "CTR",
                "CVR",
                "成交人数",
                "利润空间",
                "支付买家数",
                "GMV",
                "排名",
            ],
        },
        "流程触发与终止条件": {
            "value": "类目清楚、产品清楚、分析周期清楚、目标清楚时启动；完成立项、上架测试或机会评分达标后终止。",
            "keywords": [
                "类目是否清楚",
                "产品是否清楚",
                "分析周期是否清楚",
                "目标是否清楚",
                "85分以上",
                "优先立项开发",
                "提交立项或进入上架测试",
                "进入上架测试",
            ],
        },
        "方法是否有效的验证方式": {
            "value": "看点击率、收藏加购率、转化率、成交人数、搜索增长、支付买家数、GMV和机会评分的变化。",
            "keywords": [
                "点击率",
                "收藏加购率",
                "转化率",
                "成交人数",
                "搜索增长",
                "支付买家数",
                "GMV",
                "机会评分",
                "提升≥2个百分点",
                "CVR提升≥1个百分点",
            ],
        },
    },
    GROWTH_PERSPECTIVE: {
        "对象": {
            "value": "类目、产品线、人群、价格带、关键词、评价/问大家、竞品、跨平台趋势素材和产品机会。",
            "keywords": [
                "分析类目",
                "分析产品线",
                "目标价格带",
                "目标人群",
                "分析周期",
                "类目大盘分析表",
                "行业前300商品分析表",
                "关键词需求拆解表",
                "评价/问大家痛点表",
                "价格带机会表",
                "竞品竞争格局表",
                "跨平台趋势素材表",
                "产品开发与链接规划表",
            ],
        },
        "问题分类": {
            "value": "卖得好、涨得快、搜什么、关心和抱怨什么、竞争弱点、做什么产品、怎么和竞品打、如何落到链接规划。",
            "keywords": [
                "这个类目现在什么东西卖得好？",
                "这个类目什么东西涨得快？",
                "用户到底在搜什么？",
                "用户真正关心和抱怨什么？",
                "哪些地方竞争没有那么强？",
                "我们应该做什么产品？",
                "我们怎么和竞品打？",
                "最后能不能落到链接规划？",
            ],
        },
        "核心变量": {
            "value": "产品类型、材质、功能、风格、人群、场景、价格带、视觉表达、流量入口，以及需求、增长、竞争、利润、供应链、差异化。",
            "keywords": [
                "产品类型",
                "材质",
                "功能",
                "风格",
                "人群",
                "场景",
                "价格带",
                "视觉表达",
                "流量入口",
                "需求",
                "增长",
                "竞争",
                "利润",
                "供应链",
                "差异化",
            ],
        },
        "判断指标": {
            "value": "销量/支付买家数、GMV、客单价、搜索人气、增长率、占比、评价/问大家反馈、CTR/CVR、成交人数、排名、利润空间。",
            "keywords": [
                "销量",
                "支付买家数",
                "GMV",
                "客单价",
                "搜索人气",
                "增长率",
                "占比",
                "评价",
                "问大家",
                "CTR",
                "CVR",
                "成交人数",
                "排名",
                "利润空间",
                "毛利率",
                "点击率",
            ],
        },
        "因果关系": {
            "value": "有搜索需求+有热销验证+有痛点可升级+有价格带空间+有竞品可对标；对手没有做、对手少、对手弱时机会成立。",
            "keywords": [
                "好产品 = 容易爆 + 有利润",
                "有搜索需求 + 有热销验证 + 有痛点可升级 + 有价格带空间 + 有竞品可对标",
                "对手没有做",
                "对手少",
                "对手弱",
                "先看全域趋势",
                "最后落到产品和链接规划",
            ],
        },
        "决策顺序": {
            "value": "先看全域趋势，再看行业结构，再看竞品竞店，再看用户需求，再看价格空间，最后落到产品和链接规划。",
            "keywords": [
                "先看全域趋势",
                "再看行业结构",
                "再看竞品竞店",
                "再看用户需求",
                "再看价格空间",
                "最后落到产品和链接规划",
                "流程1：确定分析边界",
                "流程10：产品开发与链接规划落地",
            ],
        },
        "建议动作": {
            "value": "输出各类分析表和机会表，优先做主推款、测试款、利润款、升级款，并落到产品开发与链接规划。",
            "keywords": [
                "可作为主推款",
                "适合快速测款",
                "适合做产品升级",
                "输出新品开发立项表",
                "输出价格带布局表",
                "输出产品迭代方案",
                "输出季节性产品布局表",
                "主推款",
                "利润款",
                "测试款",
                "升级款",
                "链接规划表",
            ],
        },
        "执行条件": {
            "value": "类目精确到三级/最小叶子类目，分析周期清楚，能获取行业前300、关键词、评价、问大家、价格带、竞品和趋势素材，且具备访客量、供应链与测图能力。",
            "keywords": [
                "精确到三级类目",
                "最小叶子类目",
                "近7天",
                "近30天",
                "月维度",
                "季节维度",
                "行业前300",
                "关键词",
                "评价",
                "问大家",
                "价格带",
                "竞品",
                "跨平台内容",
                "美工或AI生成工具",
                "商品曝光大于1000",
                "有足够访客量",
                "供应链",
            ],
        },
        "验证方式": {
            "value": "看点击率、收藏加购率、转化率、成交人数、搜索增长、支付买家数、GMV和机会评分变化。",
            "keywords": [
                "点击率",
                "收藏加购率",
                "转化率",
                "成交人数",
                "搜索增长",
                "支付买家数",
                "GMV",
                "机会评分",
                "≥85分",
                "提升≥2个百分点",
                "CVR提升≥1个百分点",
            ],
        },
    },
}


def slugify(text: str) -> str:
    raw = text.lower()
    raw = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", raw)
    raw = re.sub(r"-{2,}", "-", raw).strip("-")
    if not raw:
        raw = "strategy"
    ascii_slug = re.sub(r"[^a-z0-9-]", "", raw)
    return (ascii_slug or "strategy")[:42].strip("-") or "strategy"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def title_from_document(source_path: Path, text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip() or source_path.stem
    return source_path.stem


def _line_value(line: str, aliases: list[str]) -> str | None:
    stripped = line.strip().lstrip("-*0123456789.、)） ")
    for alias in aliases:
        match = re.match(rf"^{re.escape(alias)}\s*[:：]\s*(.+)$", stripped)
        if match:
            return match.group(1).strip()
    return None


def _heading_info(line: str) -> tuple[int, str] | None:
    match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line.strip())
    if not match:
        return None
    return len(match.group(1)), match.group(2).strip()


def _normalize_heading(text: str) -> str:
    normalized = re.sub(r"\[[^\]]+\]\([^)]+\)", "", text)
    normalized = re.sub(r"^[一二三四五六七八九十0-9０-９]+[、.．]\s*", "", normalized)
    normalized = re.sub(r"^\d+(?:\.\d+)*\s*", "", normalized)
    normalized = re.sub(r"^流程\d+[：:]\s*", "", normalized)
    normalized = re.sub(r"\s+", "", normalized)
    normalized = normalized.replace("模版", "模板")
    return normalized


def _is_heading_match(title: str, aliases: list[str]) -> bool:
    normalized = _normalize_heading(title)
    return any(_normalize_heading(alias) in normalized for alias in aliases)


def _clean_section_lines(lines: list[str]) -> list[str]:
    cleaned: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped == "---":
            continue
        cleaned.append(stripped)
    return cleaned


def _section_value(lines: list[str], limit: int = 700) -> str:
    cleaned = _clean_section_lines(lines)
    text = re.sub(r"\s+", " ", " ".join(cleaned)).strip()
    return text[:limit]


def _section_evidence(heading: str, lines: list[str], limit: int = 500) -> str:
    cleaned = _clean_section_lines(lines)
    evidence = "\n".join([heading, *cleaned[:6]]).strip()
    return evidence[:limit]


def _section_by_heading(text: str, aliases: list[str]) -> tuple[str, str] | None:
    lines = text.splitlines()
    for index, line in enumerate(lines):
        heading = _heading_info(line)
        if not heading:
            continue
        level, title = heading
        if not _is_heading_match(title, aliases):
            continue
        section_lines: list[str] = []
        for next_line in lines[index + 1 :]:
            next_heading = _heading_info(next_line)
            if next_heading and next_heading[0] <= level:
                break
            section_lines.append(next_line)
        value = _section_value(section_lines)
        if value:
            return value, _section_evidence(line.strip(), section_lines)
    return None


def _section_by_heading_window(
    text: str,
    start_aliases: list[str],
    end_aliases: list[list[str]],
) -> tuple[str, str] | None:
    lines = text.splitlines()
    capturing = False
    start_heading = ""
    level = 0
    section_lines: list[str] = []
    for line in lines:
        heading = _heading_info(line)
        if heading and capturing:
            heading_level, title = heading
            if heading_level <= level and any(_is_heading_match(title, aliases) for aliases in end_aliases):
                break
        if heading and not capturing:
            heading_level, title = heading
            if any(_is_heading_match(title, [alias]) for alias in start_aliases):
                capturing = True
                start_heading = line.strip()
                level = heading_level
            continue
        if capturing:
            section_lines.append(line)
    value = _section_value(section_lines, limit=1200)
    if value:
        return value, _section_evidence(start_heading, section_lines, limit=700)
    return None


def _fallback_section_for_field(
    text: str,
    perspective: str,
    field: str,
    aliases: list[str],
) -> tuple[str, str] | None:
    direct = _section_by_heading(text, aliases)
    if direct:
        return direct
    if perspective != EXPERT_PERSPECTIVE:
        return None
    if field == "流程图或业务模型":
        return _section_by_heading(text, ["整体流程", "业务模型", "流程图"])
    if field == "执行步骤":
        return _section_by_heading(text, ["具体流程及执行步骤", "整体流程", "执行流程"])
    if field == "判断标准":
        return _section_by_heading_window(
            text,
            ["具体流程及执行步骤"],
            [["需要的工具表单清单", "工具表单清单", "工具表单模板"], ["适用子场景"]],
        )
    if field == "问题解决方法/执行动作":
        return _section_by_heading(text, ["具体流程及执行步骤", "执行动作"])
    if field == "工具表单模板":
        return _section_by_heading(text, ["需要的工具表单清单", "工具表单清单", "工具表单模板"])
    if field == "常见问题类型":
        return _section_by_heading(text, ["适用子场景分别输出", "适用子场景", "子场景"])
    return None


def _section_from_line(lines: list[str], index: int, limit: int = 700) -> str:
    for heading_index in range(index, -1, -1):
        heading = _heading_info(lines[heading_index])
        if not heading:
            continue
        level, title = heading
        section_lines: list[str] = []
        for next_line in lines[heading_index + 1 :]:
            next_heading = _heading_info(next_line)
            if next_heading and next_heading[0] <= level:
                break
            section_lines.append(next_line)
        return _section_evidence(title, section_lines, limit=limit)
    start = max(0, index - 2)
    end = min(len(lines), index + 3)
    snippet = "\n".join(line.strip() for line in lines[start:end] if line.strip()).strip()
    return snippet[:limit]


def _semantic_rule_for_field(perspective: str, field: str) -> dict[str, Any] | None:
    return SEMANTIC_RULES.get(perspective, {}).get(field)


def _semantic_fallback_for_field(
    text: str,
    perspective: str,
    field: str,
) -> tuple[str, str] | None:
    rule = _semantic_rule_for_field(perspective, field)
    if not rule:
        return None
    keywords = rule.get("keywords", [])
    if not keywords:
        return None
    lines = text.splitlines()
    snippets: list[str] = []
    seen: set[str] = set()
    for index, line in enumerate(lines):
        if not line.strip():
            continue
        if not any(keyword in line for keyword in keywords):
            continue
        snippet = _section_from_line(lines, index)
        if not snippet or snippet in seen:
            continue
        snippets.append(snippet)
        seen.add(snippet)
        if len(snippets) >= 2:
            break
    if not snippets:
        return None
    value = str(rule["value"])
    evidence = "\n---\n".join(snippets)
    return value, evidence[:700]


def _skill_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _resolve_runtime_path(path: Path, *, base_dir: Path | None = None) -> Path:
    base = (base_dir or Path.cwd()).resolve()
    candidate = path.expanduser()
    if candidate.is_absolute():
        return candidate.resolve()
    return (base / candidate).resolve()


def default_schema_path() -> Path:
    return _skill_root() / "references" / "meta_strategy_schema.md"


def extract_tags_for_perspective(
    text: str,
    perspective: str,
) -> tuple[list[dict[str, Any]], list[str], list[dict[str, str]]]:
    tags: list[dict[str, Any]] = []
    found: set[str] = set()
    lines = [line for line in text.splitlines() if line.strip()]
    for field in PERSPECTIVE_FIELDS[perspective]:
        aliases = FIELD_ALIASES[perspective][field]
        for line in lines:
            value = _line_value(line, aliases)
            if not value:
                continue
            tags.append(
                {
                    "scheme": perspective,
                    "field": field,
                    "value": value,
                    "evidence_quote": line.strip(),
                    "confidence": 0.82,
                }
            )
            found.add(field)
            break
        if field in found:
            continue
        section = _fallback_section_for_field(text, perspective, field, aliases)
        if not section:
            section = _semantic_fallback_for_field(text, perspective, field)
        if not section:
            continue
        value, evidence = section
        confidence = 0.72
        if _semantic_rule_for_field(perspective, field):
            confidence = SEMANTIC_CONFIDENCE
        tags.append(
            {
                "scheme": perspective,
                "field": field,
                "value": value,
                "evidence_quote": evidence,
                "confidence": confidence,
            }
        )
        found.add(field)
    missing = [field for field in PERSPECTIVE_FIELDS[perspective] if field not in found]
    open_questions = [
        {"field": field, "question": f"文档未明确说明：{field}"}
        for field in missing
    ]
    return tags, missing, open_questions


def extract_v1_tags(text: str) -> tuple[list[dict[str, Any]], list[str]]:
    tags: list[dict[str, Any]] = []
    found: set[str] = set()
    lines = [line for line in text.splitlines() if line.strip()]
    for field in V1_FIELDS:
        aliases = V1_FIELD_ALIASES[field]
        for line in lines:
            value = _line_value(line, aliases)
            if not value:
                continue
            tags.append(
                {
                    "scheme": "经营增长目标提升维度",
                    "field": field,
                    "value": value,
                    "evidence_quote": line.strip(),
                    "confidence": 0.82,
                }
            )
            found.add(field)
            break
    missing = [field for field in V1_FIELDS if field not in found]
    return tags, missing


def build_perspectives(text: str) -> dict[str, dict[str, Any]]:
    perspectives: dict[str, dict[str, Any]] = {}
    for perspective in (EXPERT_PERSPECTIVE, GROWTH_PERSPECTIVE):
        tags, missing, open_questions = extract_tags_for_perspective(text, perspective)
        perspectives[perspective] = {
            "tags": tags,
            "missing_fields": missing,
            "open_questions": open_questions,
        }
    return perspectives


def flatten_tags(perspectives: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    tags: list[dict[str, Any]] = []
    for perspective in (EXPERT_PERSPECTIVE, GROWTH_PERSPECTIVE):
        tags.extend(perspectives[perspective]["tags"])
    return tags


def flatten_missing_fields(perspectives: dict[str, dict[str, Any]]) -> list[str]:
    prefixed: list[str] = []
    legacy_raw: list[str] = []
    for perspective in (EXPERT_PERSPECTIVE, GROWTH_PERSPECTIVE):
        for field in perspectives[perspective]["missing_fields"]:
            prefixed.append(f"{perspective}:{field}")
            if field not in legacy_raw:
                legacy_raw.append(field)
    return prefixed + legacy_raw


def flatten_open_questions(perspectives: dict[str, dict[str, Any]]) -> list[str]:
    questions: list[str] = []
    for perspective in (EXPERT_PERSPECTIVE, GROWTH_PERSPECTIVE):
        for item in perspectives[perspective]["open_questions"]:
            questions.append(f"{perspective}:{item['question']}")
    return questions


def build_qa_index(tags: list[dict[str, Any]]) -> dict[str, str]:
    qa_index: dict[str, str] = {}
    for item in tags:
        perspective = str(item["scheme"])
        field = str(item["field"])
        value = str(item["value"])
        qa_index[f"{perspective}.{field}"] = value
        if perspective == GROWTH_PERSPECTIVE and field not in qa_index:
            qa_index[field] = value
    return qa_index


def build_v1_qa_index(tags: list[dict[str, Any]]) -> dict[str, str]:
    return {str(item["field"]): str(item["value"]) for item in tags}


def skill_description(title: str) -> str:
    cleaned = re.sub(r"\s+", " ", title).strip()
    return f"Use when answering questions about {cleaned} strategy."


def _format_missing_by_perspective(perspectives: dict[str, dict[str, Any]]) -> str:
    lines: list[str] = []
    for perspective in (EXPERT_PERSPECTIVE, GROWTH_PERSPECTIVE):
        missing = perspectives[perspective]["missing_fields"]
        missing_text = "、".join(missing) if missing else "无明显缺失字段"
        lines.append(f"- {perspective}: {missing_text}")
    return "\n".join(lines)


def render_skill_md(
    title: str,
    slug: str,
    source_path: Path,
    perspectives: dict[str, dict[str, Any]],
) -> str:
    name = f"biz-strategy-{slug}"
    missing_text = _format_missing_by_perspective(perspectives)
    return f"""---
name: {name}
description: {skill_description(title)}
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [business-strategy, biz-spec, strategy-skill]
    related_skills: [business-strategy-skill-pack, biz-strategy-index]
---

# {title}

## Overview

This skill was generated from `{source_path}` using the portable V2
`book-to-skill` extraction pipeline and the business meta strategy schema.

Use it to answer questions about the strategy's target, object, scenario,
diagnostic logic, metrics, actions, execution conditions, boundaries, and
verification method across `{EXPERT_PERSPECTIVE}` and `{GROWTH_PERSPECTIVE}`.

## When to Use

- The user asks about this specific strategy document.
- The user asks whether the strategy has complete meta-strategy fields.
- The user wants execution actions or diagnosis logic from this strategy.

## Required References

Before giving a high-confidence answer, load:

- `references/schema_tags.json`
- `references/source_digest.md`

## How to Answer

1. Ground answers in `schema_tags.json.perspectives`.
2. Cite the perspective, schema field name, and evidence quote when explaining conclusions.
3. Use `source_digest.md` for the narrative summary and method flow.
4. Treat missing fields as missing. Do not infer them from general business
   knowledge.

## Known Missing Fields

{missing_text}

## Common Pitfalls

- Do not answer as if the source document covered every schema field.
- Do not replace document evidence with generic e-commerce advice.
- Do not ignore execution boundaries and validation requirements.

## Verification

- `schema_tags.json` contains structured tags.
- `schema_tags.json` contains both `{EXPERT_PERSPECTIVE}` and `{GROWTH_PERSPECTIVE}`.
- `source_digest.md` contains the source-backed digest.
- This skill can be loaded by any Agent runtime that supports `SKILL.md`.
"""


def render_v1_skill_md(title: str, slug: str, source_path: Path, missing: list[str]) -> str:
    name = f"biz-strategy-{slug}"
    missing_text = "、".join(missing) if missing else "无明显缺失字段"
    return f"""---
name: {name}
description: {skill_description(title)}
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [business-strategy, biz-spec, strategy-skill]
    related_skills: [business-strategy-skill-pack, biz-strategy-index]
---

# {title}

## Overview

This skill was generated from `{source_path}` using the V1 direct-read baseline
and the business meta strategy schema.

Use it to answer questions about the strategy's target, object, scenario,
diagnostic logic, metrics, actions, execution conditions, boundaries, and
verification method.

## Required References

Before giving a high-confidence answer, load:

- `references/schema_tags.json`
- `references/source_digest.md`

## How to Answer

1. Ground answers in `schema_tags.json`.
2. Cite the schema field name and evidence quote when explaining conclusions.
3. Treat missing fields as missing. Do not infer them from general business knowledge.

## Known Missing Fields

{missing_text}

## Verification

- `schema_tags.json` contains structured V1 tags.
- `source_digest.md` contains the source-backed digest.
- This skill can be loaded by any Agent runtime that supports `SKILL.md`.
"""


def render_digest(
    title: str,
    source_path: Path,
    perspectives: dict[str, dict[str, Any]],
    extraction: dict[str, Any],
) -> str:
    lines = [
        f"# Source Digest: {title}",
        "",
        f"- Source: `{source_path}`",
        f"- Generated: {date.today().isoformat()}",
        f"- Schema version: `{SCHEMA_VERSION}`",
        f"- Extraction engine: `{extraction['engine']}`",
        f"- Extraction fallback: `{str(extraction['fallback']).lower()}`",
        "",
    ]
    if extraction["fallback"]:
        lines.append(f"- Fallback reason: `{extraction['fallback_reason']}`")
        lines.append("")
    for perspective in (EXPERT_PERSPECTIVE, GROWTH_PERSPECTIVE):
        lines.extend([f"## {perspective}", "", "### Extracted Fields", ""])
        tags = perspectives[perspective]["tags"]
        if tags:
            for item in tags:
                lines.append(f"#### {item['field']}")
                lines.append("")
                lines.append(f"- Value: {item['value']}")
                lines.append(f"- Evidence: {item['evidence_quote']}")
                lines.append("")
        else:
            lines.append("- None")
            lines.append("")
        lines.extend(["### Missing Fields", ""])
        missing = perspectives[perspective]["missing_fields"]
        if missing:
            lines.extend(f"- {field}" for field in missing)
        else:
            lines.append("- None")
        lines.append("")
    return "\n".join(lines)


def render_v1_digest(title: str, source_path: Path, tags: list[dict[str, Any]], missing: list[str]) -> str:
    lines = [
        f"# Source Digest: {title}",
        "",
        f"- Source: `{source_path}`",
        f"- Generated: {date.today().isoformat()}",
        f"- Schema version: `{SCHEMA_VERSION_V1}`",
        "",
        "## Extracted Fields",
        "",
    ]
    for item in tags:
        lines.append(f"### {item['field']}")
        lines.append("")
        lines.append(f"- Value: {item['value']}")
        lines.append(f"- Evidence: {item['evidence_quote']}")
        lines.append("")
    lines.extend(["## Missing Fields", ""])
    if missing:
        lines.extend(f"- {field}" for field in missing)
    else:
        lines.append("- None")
    lines.append("")
    return "\n".join(lines)


def update_index(output_root: Path, entry: dict[str, Any]) -> None:
    index_dir = output_root / "biz-strategy-index"
    references_dir = index_dir / "references"
    references_dir.mkdir(parents=True, exist_ok=True)
    index_json = references_dir / "index.json"
    if index_json.exists():
        payload = json.loads(index_json.read_text(encoding="utf-8"))
    else:
        payload = {"skills": []}

    skills = [item for item in payload.get("skills", []) if item.get("name") != entry["name"]]
    skills.append(entry)
    skills.sort(key=lambda item: item.get("name", ""))
    payload["skills"] = skills
    index_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "---",
        "name: biz-strategy-index",
        "description: Use when finding generated business strategy skills.",
        "version: 1.0.0",
        "author: Hermes Agent",
        "license: MIT",
        "metadata:",
        "  hermes:",
        "    tags: [business-strategy, strategy-index, generated-skills]",
        "    related_skills: [business-strategy-skill-pack]",
        "---",
        "",
        "# Business Strategy Skill Index",
        "",
        "## Overview",
        "",
        "This skill indexes generated business strategy skills.",
        "",
        "## Generated Strategy Skills",
        "",
    ]
    if not skills:
        lines.append("No generated strategy skills have been indexed yet.")
    for item in skills:
        fields = ", ".join(item.get("fields", [])) or "no extracted fields"
        missing = ", ".join(item.get("missing_fields", [])) or "none"
        lines.append(f"- `{item['name']}`: {item.get('title', '')}")
        lines.append(f"  - Source: `{item.get('source_path', '')}`")
        lines.append(f"  - Schema version: `{item.get('schema_version', '')}`")
        lines.append(f"  - Extracted fields: {fields}")
        lines.append(f"  - Missing fields: {missing}")
        stats = item.get("perspective_stats", {})
        for perspective in (EXPERT_PERSPECTIVE, GROWTH_PERSPECTIVE):
            if perspective in stats:
                stat = stats[perspective]
                lines.append(
                    f"  - {perspective}: {stat.get('extracted_count', 0)} extracted, "
                    f"{stat.get('missing_count', 0)} missing"
                )
    lines.extend(
        [
            "",
            "## How to Answer",
            "",
            "Use this index to find the generated strategy skill that best matches the user's scenario, then load that skill for detailed answers.",
        ]
    )
    (index_dir / "SKILL.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
