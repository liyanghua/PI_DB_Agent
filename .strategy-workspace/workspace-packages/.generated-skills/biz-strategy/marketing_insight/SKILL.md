---
name: biz-strategy-marketing_insight
description: Use when answering questions about 市场分析洞察元策略 strategy.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [business-strategy, biz-spec, strategy-skill]
    related_skills: [business-strategy-skill-pack, biz-strategy-index]
---

# 市场分析洞察元策略

## Overview

This skill was generated from `/Users/yichen/Desktop/OntologyBrain/PI_AGENT/docs/biz_spec/marketing_insight/20260519市场分析洞察元策略.md` using the portable V2
`book-to-skill` extraction pipeline and the business meta strategy schema.

Use it to answer questions about the strategy's target, object, scenario,
diagnostic logic, metrics, actions, execution conditions, boundaries, and
verification method across `客户业务专家视角` and `经营增长目标维度`.

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

- 客户业务专家视角: 页面截图
- 经营增长目标维度: 迭代日期

## Common Pitfalls

- Do not answer as if the source document covered every schema field.
- Do not replace document evidence with generic e-commerce advice.
- Do not ignore execution boundaries and validation requirements.

## Verification

- `schema_tags.json` contains structured tags.
- `schema_tags.json` contains both `客户业务专家视角` and `经营增长目标维度`.
- `source_digest.md` contains the source-backed digest.
- This skill can be loaded by any Agent runtime that supports `SKILL.md`.
