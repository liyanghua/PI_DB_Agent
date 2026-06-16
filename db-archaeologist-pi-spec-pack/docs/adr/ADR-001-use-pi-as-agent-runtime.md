# ADR-001 — 使用 earendil-works/pi 作为 Agent Runtime 基座

## Status

Accepted for MVP.

## Context

DB Archaeologist Agent 需要一个轻量的后台 Agent runtime，用于：

- 挂载 custom tools。
- 管理 Agent state。
- 支持工具调用。
- 支持 skills / prompt templates。
- 便于 AI-coding 迭代。

## Decision

MVP 使用 `earendil-works/pi` 作为 runtime harness。项目业务能力通过 custom tools / extensions / skills 接入。

## Rationale

- Pi core 包含 agent runtime、tool calling、state management。
- Pi 支持 custom tools 和 extension。
- Pi 可以通过 skills / context files 注入 DB Archaeologist 规范。
- Pi 适合作为 AI-coding 和内部工具型 Agent 的运行基座。

## Consequences

- 需要把 DB Archaeologist 能力包装为 TypeScript custom tools。
- 需要额外设计 sandbox/container 策略，因为 runtime 默认权限边界需要外部控制。
- 业务 registry 不应写死在 prompt 内，而应作为工具后端读取。

## Non-goals

- 不把 Pi 改造成完整工作流引擎。
- 不把 Pi 作为长期生产调度系统的唯一依赖。
- 不绕过 API 权限和网关治理。
