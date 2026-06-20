// shape.ts: 把 probeApiSample 的 response.top 按 fieldMapping 形态归整成 RawRecord[]
// 策略：
//   1) probeApiSample 已按 card.response_schema.root 抽过一次（pickTop），返回 raw_kind ∈ {array, object, scalar}
//   2) raw_kind=array → 直接当 RawRecord[]（仅保留 object 元素）
//   3) raw_kind=object → 在对象中寻找 candidates（list/data/records/result/keywords/items/rows），找到数组字段则用之，否则把对象本身作为 1 条记录并标 single_object_record
//   4) raw_kind=scalar → 跳过，标 unexpected_payload
// shape 阶段不动字段重命名，重命名交给 normalize 阶段的 field_map。

import type { ApiProbeResult } from "../api_runtime.js";

export type RawRecord = Record<string, unknown>;

export interface ApiShapeStatus {
  shape: "array" | "object_with_inner_array" | "single_object_record" | "unexpected_payload" | "skipped";
  count: number;
  inner_field?: string;
  note?: string;
}

export interface ShapeReport {
  per_api: Record<string, ApiShapeStatus>;
}

const INNER_ARRAY_CANDIDATES = ["list", "records", "result", "results", "keywords", "items", "rows", "data"];

export function shapeRawByApi(
  probeResults: Record<string, ApiProbeResult>,
): { rawByApi: Record<string, RawRecord[]>; report: ShapeReport } {
  const rawByApi: Record<string, RawRecord[]> = {};
  const per_api: Record<string, ApiShapeStatus> = {};

  for (const [apiName, probe] of Object.entries(probeResults)) {
    if (!probe || probe.status.state !== "ok" || !probe.response) {
      per_api[apiName] = { shape: "skipped", count: 0, note: `probe.state=${probe?.status?.state ?? "unknown"}` };
      continue;
    }

    const { raw_kind, top } = probe.response;

    if (raw_kind === "array") {
      const records = (top as unknown[]).filter((x) => x && typeof x === "object" && !Array.isArray(x)) as RawRecord[];
      rawByApi[apiName] = records;
      per_api[apiName] = { shape: "array", count: records.length };
      continue;
    }

    if (raw_kind === "object") {
      const obj = (top[0] ?? {}) as RawRecord;
      let inner: { field: string; value: RawRecord[] } | null = null;
      for (const k of INNER_ARRAY_CANDIDATES) {
        const v = obj[k];
        if (Array.isArray(v) && v.some((x) => x && typeof x === "object" && !Array.isArray(x))) {
          inner = {
            field: k,
            value: (v as unknown[]).filter((x) => x && typeof x === "object" && !Array.isArray(x)) as RawRecord[],
          };
          break;
        }
      }
      if (inner) {
        rawByApi[apiName] = inner.value;
        per_api[apiName] = { shape: "object_with_inner_array", count: inner.value.length, inner_field: inner.field };
      } else {
        rawByApi[apiName] = [obj];
        per_api[apiName] = {
          shape: "single_object_record",
          count: 1,
          note: "未在响应对象中找到数组字段，已把整个对象作为 1 条记录",
        };
      }
      continue;
    }

    per_api[apiName] = { shape: "unexpected_payload", count: 0, note: `raw_kind=${raw_kind}` };
  }

  return { rawByApi, report: { per_api } };
}