export type Issue = {
  type: string;
  severity: "low" | "medium" | "high";
  message?: string;
};

export type ParamRow = {
  name: string;
  type?: string;
  required?: boolean;
  desc?: string;
  position?: "query" | "body" | "path" | "header";
};

export type ResponseField = {
  path: string;
  name?: string;
  type?: string;
  desc?: string;
};

export type RequestSchema = {
  query: ParamRow[];
  body: ParamRow[] | null;
  headers: string[];
  path_params: ParamRow[];
};

export type ResponseSchema = {
  root: string;
  fields: ResponseField[];
  example: unknown | null;
};

export type EntityMapping = {
  entity: string;
  evidence: string[];
};

export type MetricMapping = {
  field_path: string;
  metric: string;
  via: "alias" | "name_match" | "manual";
};

export type DomainMapping = {
  domain: string;
  capability?: string;
  confidence: number;
  evidence: string[];
  locked: boolean;
};

export type LifecycleStatus =
  | "raw"
  | "draft"
  | "candidate"
  | "verified"
  | "agent_ready"
  | "deprecated"
  | "blocked";

export type ApiAssetCard = {
  api_id: string;
  source_seq: number;
  name: string;
  module: string;
  domain: string;
  capability?: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  path_raw?: string;
  lifecycle_status: LifecycleStatus;
  quality_score: number;
  quality_breakdown?: Record<string, number>;
  issue_marker?: string;
  issues?: Issue[];
  request_schema?: RequestSchema;
  response_schema?: ResponseSchema;
  entity_mapping?: EntityMapping[];
  metric_mapping?: MetricMapping[];
  domain_mapping?: DomainMapping;
  tool_candidate?: boolean;
  parse_failure?: boolean;
  source_line_no?: number;
  owner?: string;
  notes?: string;
};

export type ToolRegistryEntry = {
  tool_id: string;
  tool_name: string;
  description: string;
  domain: string;
  capability?: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  source_apis: string[];
  fallback_apis?: string[];
  call_policy?: Record<string, unknown>;
  quality_gate?: {
    min_quality_score?: number;
    required_status?: LifecycleStatus[];
    require_contract_test?: boolean;
  };
  runtime?: {
    enabled_in_pi?: boolean;
    pi_tool_name?: string;
  };
  origin?: "manual" | "auto";
};

export type KgNode = {
  id: string;
  type: string;
  [k: string]: unknown;
};

export type KgEdge = {
  source: string;
  target: string;
  type: string;
  [k: string]: unknown;
};