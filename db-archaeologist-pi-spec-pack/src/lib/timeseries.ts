// timeseries.ts: 月度时序数据聚合工具
// 用途：把多月时序明细（如 data_keyword_trend 返回的多行 keyword×month）聚合成单条记录，含 MoM/YoY/斜率

export interface TimeSeriesRow {
  business_date: string; // YYYY-MM 或 YYYY-MM-DD
  value: number;
  [key: string]: unknown;
}

export interface AggregatedTimeSeries {
  latest_value: number;
  latest_date: string;
  mom?: number; // 月环比（最新月 vs 上月），小数
  yoy?: number; // 年同比（最新月 vs 去年同月），小数
  slope?: number; // 线性回归斜率（单位：value per month）
  growth_rate?: number; // 整体增长率（最新 vs 最早）/ 时间跨度，小数
  points_count: number; // 有效数据点数
  date_range: { start: string; end: string };
}

/**
 * 聚合单个关键词的月度时序数据。
 * 
 * @param rows 同一关键词的多个月份数据，每行含 business_date + value
 * @param valueField 数值字段名（如 "search_value"）
 * @param dateField 日期字段名（缺省 "business_date"）
 * @returns 聚合结果，含 mom/yoy/slope
 */
export function aggregateMonthlyTimeSeries(
  rows: TimeSeriesRow[],
  valueField: string,
  dateField = "business_date",
): AggregatedTimeSeries | null {
  if (rows.length === 0) return null;

  // 1. 提取并排序
  const points: Array<{ date: string; value: number; timestamp: number }> = [];
  for (const row of rows) {
    const dateStr = String(row[dateField] || "").trim();
    const rawValue = row[valueField];
    if (!dateStr || rawValue == null) continue;

    const value = typeof rawValue === "number" ? rawValue : parseFloat(String(rawValue));
    if (isNaN(value)) continue;

    // 解析日期（支持 YYYY-MM 或 YYYY-MM-DD）
    const normalized = dateStr.length === 7 ? `${dateStr}-01` : dateStr;
    const timestamp = Date.parse(normalized);
    if (isNaN(timestamp)) continue;

    points.push({ date: dateStr, value, timestamp });
  }

  if (points.length === 0) return null;

  // 按时间升序
  points.sort((a, b) => a.timestamp - b.timestamp);

  const latest = points[points.length - 1];
  const earliest = points[0];

  // 2. 计算 MoM（最新月 vs 上一个月）
  let mom: number | undefined;
  if (points.length >= 2) {
    const prev = points[points.length - 2];
    mom = prev.value !== 0 ? (latest.value - prev.value) / prev.value : undefined;
  }

  // 3. 计算 YoY（最新月 vs 12 个月前）
  let yoy: number | undefined;
  const latestMonthTs = latest.timestamp;
  const yearAgoTs = latestMonthTs - 365 * 24 * 60 * 60 * 1000;
  // 找最接近 12 个月前的数据点（容忍 ±45 天）
  const yearAgoPoint = points.find((p) => Math.abs(p.timestamp - yearAgoTs) < 45 * 24 * 60 * 60 * 1000);
  if (yearAgoPoint && yearAgoPoint.value !== 0) {
    yoy = (latest.value - yearAgoPoint.value) / yearAgoPoint.value;
  }

  // 4. 计算线性回归斜率（简化版：最小二乘法）
  let slope: number | undefined;
  if (points.length >= 2) {
    const n = points.length;
    // 用月份序号（0, 1, 2, ...）作为 x 轴
    const xMean = (n - 1) / 2;
    const yMean = points.reduce((sum, p) => sum + p.value, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      const x = i;
      const y = points[i].value;
      numerator += (x - xMean) * (y - yMean);
      denominator += (x - xMean) ** 2;
    }

    slope = denominator !== 0 ? numerator / denominator : undefined;
  }

  // 5. 整体增长率（最新 vs 最早）
  let growth_rate: number | undefined;
  if (earliest.value !== 0 && points.length >= 2) {
    const monthsSpan = points.length - 1;
    growth_rate = monthsSpan > 0 ? (latest.value - earliest.value) / earliest.value / monthsSpan : undefined;
  }

  return {
    latest_value: latest.value,
    latest_date: latest.date,
    mom,
    yoy,
    slope,
    growth_rate,
    points_count: points.length,
    date_range: { start: earliest.date, end: latest.date },
  };
}

/**
 * 批量聚合多个关键词的时序数据。
 * 
 * @param rows 所有原始行（可能包含多个关键词）
 * @param keywordField 关键词字段名（如 "keywords"）
 * @param valueField 数值字段名（如 "search_value"）
 * @param dateField 日期字段名（缺省 "business_date"）
 * @returns Map<keyword, AggregatedTimeSeries>
 */
export function batchAggregateByKeyword(
  rows: TimeSeriesRow[],
  keywordField: string,
  valueField: string,
  dateField = "business_date",
): Map<string, AggregatedTimeSeries> {
  const grouped = new Map<string, TimeSeriesRow[]>();

  for (const row of rows) {
    const keyword = String(row[keywordField] || "").trim();
    if (!keyword) continue;

    if (!grouped.has(keyword)) {
      grouped.set(keyword, []);
    }
    grouped.get(keyword)!.push(row);
  }

  const result = new Map<string, AggregatedTimeSeries>();
  for (const [keyword, keywordRows] of grouped) {
    const agg = aggregateMonthlyTimeSeries(keywordRows, valueField, dateField);
    if (agg) {
      result.set(keyword, agg);
    }
  }

  return result;
}