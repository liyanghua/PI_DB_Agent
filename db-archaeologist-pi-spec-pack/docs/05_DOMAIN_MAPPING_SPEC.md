# Domain Mapping Specification

## 1. 目标

Domain Mapping 的目标是把原始 API 路径和接口名称映射到业务域、能力、实体和指标，降低 Agent 选工具的搜索空间。

## 2. 领域枚举

```yaml
domains:
  - 商品域
  - 店铺域
  - 类目域
  - 关键词域
  - 竞争域
  - 价格带域
  - 投流域
  - 流量域
  - 指标域
  - 任务域
  - 视觉素材域
  - 评论口碑域
  - 人群域
  - 公共基础域
  - 租户连接域
  - 未分类域
```

## 3. 规则优先级

1. 显式模块名优先。
2. Path 关键词次之。
3. 接口名称语义第三。
4. 返回字段第四。
5. LLM 判断只能作为补充，不能覆盖人工 locked mapping。

## 4. 输出格式

```yaml
api_id: data_goods_ads_fact_item_summary_d
domain: 商品域
capability: 商品诊断指标查询
entities:
  - Goods
metrics:
  - visitors
  - pay_sales
  - conversion_rate
confidence: 0.86
mapping_evidence:
  - path contains /data/goods
  - name contains 商品诊断
locked: false
```
