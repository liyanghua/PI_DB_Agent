# business_field_mapping

按 `subject_kind` 分文件存放业务字段 → 数仓 API 映射（schema 三段式：apis / fields / aggregation）。

| 文件 | subject_kind | Phase 1 状态 |
| --- | --- | --- |
| keyword.yaml  | keyword  | implemented（自 registry/keyword_field_mapping.yaml git mv） |
| category.yaml | category | phase1_placeholder |
| item.yaml     | item     | phase1_placeholder |
| shop.yaml     | shop     | phase1_placeholder |
| creative.yaml | creative | phase1_placeholder |

修订纪律见 [docs/18 §5](../../docs/18_KEYWORD_FIELD_MAPPING_SPEC.md) 五步 SOP；扩展规范见 [docs/23 §10.4](../../docs/23_KOIF_SUBJECT_KIND_AND_RUNTIME_FUSION_SPEC.md)。