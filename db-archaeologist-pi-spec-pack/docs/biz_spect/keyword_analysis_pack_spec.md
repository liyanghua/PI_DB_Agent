# 关键词分析策略包规范

> 版本：v1.0  
> 定位：关键词分析的通用策略包第一版  
> 目标：把“任意品类输入 → 关键词需求分析 → KDS 排名 → 蓝海辅助榜 → 报告输出”封装成可扩展的策略包，作为后续竞品、评论/问大家、主图、详情、趋势、卖点、社媒、商机卡等策略包的母体。

---

## 1. 策略包目标

`keyword_analysis_pack` 是通用关键词分析能力的容器，负责定义：

1. 这个分析包支持哪些模式；
2. 默认策略是什么；
3. 哪些策略属于同一包；
4. 任意品类输入时，如何在 mock / live 下保持可执行。

当前代码里，业务入口仍叫 `keyword_demand`，但运行时策略包配置已经统一到 `keyword_analysis_pack`。也就是说：

- `keyword_demand` = 用户和 skill 看到的业务能力名
- `keyword_analysis_pack` = runtime 里承载这条能力的 pack_id

当前第一版已经落地的能力：

- 任意品类名称输入。
- taxonomy 命中优先。
- mock 模式下回落到最相近已知类目。
- live 模式下自动反查 category_id，失败后仍可 partial_no_id 继续跑。
- KDS 主榜按需求强度排序。
- 蓝海词作为辅助榜单输出，不进入主机会池。

---

## 2. 包边界

### 2.1 本包包含

- `baseline_v1`：关键词需求分类 + KDS Baseline。
- `semantic_v2`：预留的语义聚类策略位。
- `llm_voc_v3`：预留的评论/问大家补证策略位。

### 2.2 本包不包含

- 竞品分析策略包。
- 主图分析策略包。
- 详情分析策略包。
- 趋势分析策略包。
- 卖点分析策略包。
- 社媒分析策略包。
- 商机卡生成策略包。

这些能力后续应以独立 pack 进入，但共用本包的类目输入、运行时和报告约定。

---

## 3. 包能力

| 能力 | 支持情况 |
|---|---|
| 任意品类输入 | 支持 |
| mock 回落 | 支持 |
| live 自动反查 category_id | 支持 |
| baseline_v1 | 支持 |
| 蓝海辅助榜 | 支持 |
| KDS 主榜 | 支持 |
| 多策略扩展 | 支持 |

---

## 4. 第一版运行口径

### 4.1 输入

```yaml
category: "任意品类名称"
category_id: "可选"
strategy: "baseline_v1"
live: false
date_range:
  start_date: "2026-06-01"
  end_date: "2026-06-07"
```

### 4.2 输出

- `run_id`
- `run_dir`
- `requested_category`
- `analysis_category`
- `top_overall`
- `top_by_type`
- `top_by_blue_ocean`
- `summary_path`
- `report_path`
- `resolution`
- `pull_report`

---

## 5. 兼容原则

1. `population` 是人群类目的主标签。
2. `target_user` 仅用于兼容历史数据，不作为第一版新增口径。
3. `blue_ocean` 是辅助榜，不进入主榜机会池。
4. `unknown` 只能进入待确认，不进入主机会池。
5. `top_overall` 只保留真正进入机会池的词，transaction_block 和纯品类词不进主榜。

---

## 6. 未来扩展方向

后续可在同一包机制下新增：

- 竞品分析包
- 评论/问大家分析包
- 主图分析包
- 详情分析包
- 趋势分析包
- 卖点分析包
- 社媒分析包
- 商机卡生成包
