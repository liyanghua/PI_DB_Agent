# Tool Registry Build Report

Total tools: 18
Manual: 5
Auto: 13
Blocked APIs: 103

## Tools
- `ask_api_catalog` (manual, 公共基础域/API catalog QA) -> primary=undefined, fallbacks=0
- `select_tools_for_task` (manual, 公共基础域/Tool selection) -> primary=undefined, fallbacks=0
- `get_goods_core_metrics` (manual, 商品域/商品核心经营指标查询) -> primary=agent_goods_id_ads_fact_item_summary_d, fallbacks=0
- `get_keyword_trends` (manual, 关键词域/关键词趋势分析) -> primary=agent_sycm_keyword, fallbacks=0
- `get_competition_pattern` (manual, 竞争域/竞争格局分析) -> primary=data_competition_pattern_analysis, fallbacks=0
- `auto_关键词域_关键词分析` (auto, 关键词域/关键词分析) -> primary=data_blue_keyword_7d, fallbacks=10
- `auto_店铺域_店铺数据` (auto, 店铺域/店铺数据) -> primary=agent_shop, fallbacks=1
- `auto_商品域_商品分析` (auto, 商品域/商品分析) -> primary=agent_dws_category_goods_m, fallbacks=18
- `auto_流量域_流量结构` (auto, 流量域/流量结构) -> primary=get_shop_flow_data, fallbacks=0
- `auto_人群域_人群画像` (auto, 人群域/人群画像) -> primary=get_crowd_age_info, fallbacks=0
- `auto_商品域_sku分析` (auto, 商品域/SKU分析) -> primary=get_sku_info_pro, fallbacks=0
- `auto_竞争域_竞争格局` (auto, 竞争域/竞争格局) -> primary=top300_product_analysis, fallbacks=4
- `auto_投流域_推广花费` (auto, 投流域/推广花费) -> primary=data_goods_ads_promotion_paid_metrics_summary_d, fallbacks=3
- `auto_价格带域_价格带分析` (auto, 价格带域/价格带分析) -> primary=market_price_range_analysis3, fallbacks=0
- `auto_类目域_类目结构` (auto, 类目域/类目结构) -> primary=data_ads_category_analysis_m, fallbacks=2
- `auto_投流域_付费推广` (auto, 投流域/付费推广) -> primary=data_cust_ads_ad_flow_plan_goods_keyword_7d, fallbacks=0
- `auto_指标域_指标查询` (auto, 指标域/指标查询) -> primary=data_ads_page_module_metric_d, fallbacks=0
- `auto_任务域_kpi` (auto, 任务域/KPI) -> primary=data_emp_ads_employee_kpi_result_m_sr, fallbacks=0

## Blocked (top 50)
- get_main_image_info :: quality_below_0.75, status_candidate
- get_positive_comment_data :: quality_below_0.75, status_candidate
- get_crowd_gender_info :: quality_below_0.75, status_candidate
- analysis_main_detail_p :: quality_below_0.75, status_candidate
- qbtapidoc_index_index :: quality_below_0.75, status_candidate
- data_best_seller_key_element_m :: quality_below_0.75, status_candidate
- taotian_xuanpin3 :: quality_below_0.75, status_candidate
- taotian_product_analysis :: quality_below_0.75, status_candidate
- jd_trend_xuanpin2 :: quality_below_0.75, status_candidate
- jd_product_extra :: quality_below_0.75, status_candidate
- product_comment_content2 :: quality_below_0.75, status_candidate
- market_sale_wave_analysis :: quality_below_0.75, status_candidate
- product_question_content2 :: quality_below_0.75, status_candidate
- taotian_promotion :: quality_below_0.75, status_candidate
- market_insight_summary :: quality_below_0.75, status_candidate
- keywords_analysis :: quality_below_0.75, status_candidate
- agent_ads_fact_item_summary_d :: quality_below_0.75, status_candidate
- agent_keyword :: status_draft
- data_goods_ads_fact_item_summary_nd :: quality_below_0.75, status_candidate
- data_goods_ads_fact_item_summary_d_avg :: quality_below_0.75, status_candidate
- data_goods_list_byuserids :: quality_below_0.75, status_candidate
- data_goods_scene_summary_d :: quality_below_0.75, status_candidate
- data_goods_sku_ads_tb_slr_sku_olap_1d_v2_sr :: quality_below_0.75, status_candidate
- data_goods_sku_ads_tb_slr_sku_olap_1d_sr :: quality_below_0.75, status_candidate
- data_goods_ind_sum :: quality_below_0.75, status_candidate
- data_goods_sku_trend :: quality_below_0.75, status_candidate
- data_goods_ads_user_goods_summary_d_sr :: quality_below_0.75, status_candidate
- data_goods_ind_info :: quality_below_0.75, status_candidate
- data_goods_dim_user_goods_i_sr :: quality_below_0.75, status_candidate
- data_goods_get_goods :: quality_below_0.75, status_candidate
- data_goods_ads_traffic_scene_summary_d_sr :: quality_below_0.75, status_candidate
- self_api_data_goods_ind_dim_goods_shop_basic_all :: quality_below_0.75, status_candidate
- data_goods_brand_list :: quality_below_0.75, status_candidate
- openapi_api_api_id_5_data_goods_ads_alert_log_result_d :: quality_below_0.75, status_candidate
- goods_trend_indicator :: quality_below_0.75, status_candidate
- goods_dim_goods_shop_basic_all :: quality_below_0.75, status_candidate
- goods_ads_ad_performance_summary :: quality_below_0.75, status_candidate
- goods_ads_promotion_search_lift_analysis_d :: quality_below_0.75, status_candidate
- openapi_api_1958050182385065986_5_agent_keyword :: quality_below_0.75, status_draft
- openapi_api_2015974626756595714_5_data_goods_ads_goods_shop_goods_task_1d :: quality_below_0.75, status_draft
- openapi_api_2015974626756595714_5_goods_ads_mature_plan_agg_nd :: status_draft
- openapi_api_2015974626756595714_5_data_cust_dim_pub_metrics_center :: quality_below_0.75, status_draft
- openapi_api_1958050182385065986_5_data_keywords_category_list :: quality_below_0.75, status_draft
- openapi_api_1958050182385065986_5_data_ads_fact_item_summary_df_v :: quality_below_0.75, status_candidate
- openapi_api_1958050182385065986_5_data_dim_shop_info :: quality_below_0.75, status_candidate
- openapi_api_1958050182385065986_5_data_dim_goods_info :: quality_below_0.75, status_candidate
- openapi_api_1958050182385065986_5_data_competitor_product :: quality_below_0.75, status_candidate
- data_ads_category_growth_stats_y :: quality_below_0.75, status_candidate
- data_dim_qbt_taotian_category_d :: quality_below_0.75, status_candidate
- data_ads_price_range_rank_m :: quality_below_0.75, status_candidate
