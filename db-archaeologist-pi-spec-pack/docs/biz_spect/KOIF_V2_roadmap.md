# KOIF V2 里程碑路线图

> 版本：v1.0  
> 定位：KOIF 从“关键词经营分析框架”升级为“可回放、可评测、可路由、可研究”的经营智能体系  
> 核心原则：**DeepAnalyze 作为外接研究层 / 报告生成层，不进入 KDS/TMS/PVS... 的核心评分链路**

---

## 0. 总原则

KOIF V2 不改变 KOIF 的核心判定逻辑。

```text
KDS / TMS / PVS / CES / PFS / NOS / BDS / CPS
→ 仍由 KOIF 自研评分链路负责
```

DeepAnalyze 只放在两类位置：

```text
1. 外接研究层：消费 KOIF run、trace、score_vector、router 结果，补充研究笔记、证据归纳、假设扩展
2. 报告生成层：把 KOIF 的结构化结果转成更完整的经营叙述、案例总结、追问清单
```

不做的事：

- 不让 DeepAnalyze 反写 KDS / TMS / 其他核心分数。
- 不让 DeepAnalyze 直接参与 route 决策。
- 不让 DeepAnalyze 破坏 KOIF 的可复现性与 golden case 机制。

---

## 1. V2 目标

KOIF V2 要把这几件事做实：

1. 核心评分稳定。
2. 路由稳定。
3. 报告稳定。
4. 轨迹可回放。
5. 历史 run 可积累为案例库。
6. 外接研究层可增强解释与叙述，但不污染核心链路。

最终输出不只是“一个分数”，而是：

```text
关键词评分向量 + 经营策略路由 + 行动建议 + 研究补充报告
```

---

## 2. 里程碑总表

| 阶段 | 里程碑 | 核心工作 | DeepAnalyze 位置 | 完成标准 |
| --- | --- | --- | --- | --- |
| V2-0 | Core Lock | 固化 `KDS/TMS`、`score_vector`、`trace`、`router` 契约 | 不接入 | 任意 run 可回放、可对比、可回归 |
| V2-1 | 外接研究层 MVP | 定义 `research_layer` 输入输出，只读 `router_run` 和 trace | 外接调用，输出研究笔记/证据归纳 | 失败不阻塞主报告，且不改分数 |
| V2-2 | PVS + CPS | 打通付费域 / 竞争域 | 只做辅助证据和文本总结 | 能输出两维分数，路由规则可扩展 |
| V2-3 | CES + PFS | 打通社媒 / 评论 / 商品域 | 生成内容选题、承接 gap 说明 | 能支撑内容种草 / 老品优化 |
| V2-4 | NOS + BDS | 打通类目域 / 竞争域 | 生成机会假设、竞品摘要 | 能支撑新品立项 / 蓝海判断 |
| V2-5 | Trajectory Memory | 建案例库、失败库、报告模板库 | 总结相似案例、复用研究路径 | 能从历史 run 反哺报告与策略 |
| V2-6 | Full KOIF V2 | 8 维分数 + Router + Actions + Research Layer | 常驻外接层，不侵入核心 | 一次输入拿到经营策略 + 研究报告 |

---

## 3. 分阶段说明

### 3.1 V2-0: Core Lock

先把现有能力锁死，避免后续扩展时把底座改散。

重点是：

- `run.meta.json` / `score_vector.json` / `router_run` 结构稳定。
- `trace` 能完整回放每一步。
- `compare` 和 `eval` 能稳定跑通。
- golden case 成为硬门槛。

这一阶段不引入任何研究层智能，只做工程收口。

### 3.2 V2-1: 外接研究层 MVP

这是 DeepAnalyze 真正能发挥价值的第一层。

输入：

- KOIF run 产物
- trace
- score_vector
- router 结果

输出：

- 研究笔记
- 证据摘要
- 假设扩展
- 追问清单

要求：

- 只读，不回写。
- 失败不阻塞主链路。
- 输出必须能落到报告附录或研究区块。

### 3.3 V2-2: PVS + CPS

先补付费与竞争，因为这两块最适合支撑“值不值得投”和“竞争压力多大”。

重点：

- 打通付费域 field mapping。
- 打通竞争域 field mapping。
- 输出可解释分数。
- 路由规则支持付费投流与竞品对标。

### 3.4 V2-3: CES + PFS

这一阶段解决“内容能不能讲”和“商品能不能接”。

重点：

- 接入社媒与评论信号。
- 接入商品承接信号。
- 把内容选题和页面承接 gap 变成标准输出。

### 3.5 V2-4: NOS + BDS

这一阶段处理新品与蓝海判断。

重点：

- 接入类目与竞争信号。
- 用 KDS + TMS + BDS + NOS 判断新品机会。
- 把“机会假设”写成可执行的立项材料。

### 3.6 V2-5: Trajectory Memory

把 run 变成资产。

重点：

- 建案例库。
- 建失败库。
- 建模板库。
- 把历史轨迹用来增强研究层和报告层。

这一步是 DeepAnalyze 最适合借鉴的地方，但仍然只在外层工作。

### 3.7 V2-6: Full KOIF V2

最终形态是：

- 8 维分数都可用。
- Router 可稳定路由。
- 行动建议可执行。
- 外接研究层可补充解释和叙述。

这时 KOIF 才算从“分析框架”升级成“经营智能系统”。

---

## 4. DeepAnalyze 使用边界

### 4.1 可以借的部分

- 轨迹组织方式。
- 研究过程的可回放机制。
- 案例库 / 经验库思路。
- 报告叙述能力。
- 追问式分析输出。

### 4.2 不建议直接接管的部分

- 核心评分公式。
- taxonomy / field mapping。
- router 条件。
- golden case 评测口径。
- run 产物 schema。

### 4.3 推荐接法

```text
KOIF core
→ 产出 run / trace / vector / router
→ research layer 只读消费
→ report layer 生成补充叙述
```

这能保证：

- 可复现。
- 可回归。
- 可审计。
- 可扩展。

---

## 5. 验收口径

V2 的验收不看“看起来聪明”，只看下面这些：

1. 核心 run 能稳定复现。
2. 评分不会被外接层改写。
3. Router 输出可解释。
4. 报告层能输出研究补充。
5. 历史 run 能形成案例库。
6. 新能力加入后不会打坏旧能力。

---

## 6. 推荐落地顺序

如果按投入产出比排序，建议先做：

1. `V2-0 Core Lock`
2. `V2-1 外接研究层 MVP`
3. `V2-2 PVS + CPS`
4. `V2-3 CES + PFS`
5. `V2-4 NOS + BDS`
6. `V2-5 Trajectory Memory`
7. `V2-6 Full KOIF V2`

---

## 7. 结论

KOIF V2 的正确方向不是“把 DeepAnalyze 直接塞进主链路”，而是：

```text
核心评分自研
外接研究层借鉴 DeepAnalyze
报告生成层吸收 DeepAnalyze 的表达能力
```

这样 KOIF 既保住工程确定性，也能拿到更强的研究表达和案例积累能力。

---

## 8. 参考

- [KOIF 总纲](../keyword_operating_intelligence_framework_koif.md)
- [KOIF Namespace Overview](../14_KOIF_NAMESPACE_OVERVIEW.md)
- [KOIF Router Spec](../15_KOIF_ROUTER_SPEC.md)
- [DeepAnalyze GitHub](https://github.com/ruc-datalab/DeepAnalyze)
- [DeepAnalyze Paper](https://arxiv.org/abs/2510.16872)
