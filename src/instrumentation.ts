import {
  context,
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";

type AttributeValue = string | number | boolean;

export type RetrievalStatus = "ok" | "error" | "connection_error";

const TRACER = trace.getTracer("dclimate_client_js.ipfs_retrieval");
const METER = metrics.getMeter("dclimate_client_js.ipfs_retrieval");

const DATASET_OPEN_COUNTER = METER.createCounter(
  "dclimate_client.ipfs.dataset_open.requests",
  {
    unit: "1",
    description: "IPFS Zarr dataset open requests.",
  }
);
const DATASET_OPEN_DURATION = METER.createHistogram(
  "dclimate_client.ipfs.dataset_open.duration",
  {
    unit: "s",
    description: "IPFS Zarr dataset open latency.",
  }
);
const STORE_OPEN_COUNTER = METER.createCounter(
  "dclimate_client.ipfs.store_open.requests",
  {
    unit: "1",
    description: "IPFS Zarr store open attempts.",
  }
);
const STORE_OPEN_DURATION = METER.createHistogram(
  "dclimate_client.ipfs.store_open.duration",
  {
    unit: "s",
    description: "IPFS Zarr store open attempt latency.",
  }
);

export function otelAttributes(
  attributes: Record<string, unknown> = {}
): Attributes {
  const cleaned: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      cleaned[key] = value;
    } else {
      cleaned[key] = String(value);
    }
  }
  return cleaned;
}

export function recordSpanError(span: Span, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  span.recordException(error instanceof Error ? error : message);
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

export async function withSpan<T>(
  name: string,
  attributes: Record<string, unknown>,
  callback: (span: Span) => Promise<T>
): Promise<T> {
  const span = TRACER.startSpan(name, {
    attributes: otelAttributes(attributes),
  });

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      return await callback(span);
    } finally {
      span.end();
    }
  });
}

export function recordDatasetOpen({
  gatewayUrl,
  storeType,
  status,
  seconds,
}: {
  gatewayUrl: string;
  storeType: string;
  status: RetrievalStatus;
  seconds: number;
}): void {
  const attributes = otelAttributes({
    "dclimate_client.ipfs.gateway": gatewayUrl,
    "dclimate_client.ipfs.store_type": storeType,
    "dclimate_client.ipfs.status": status,
  });
  DATASET_OPEN_COUNTER.add(1, attributes);
  DATASET_OPEN_DURATION.record(seconds, attributes);
}

export function recordStoreOpen({
  gatewayUrl,
  storeType,
  status,
  seconds,
}: {
  gatewayUrl: string;
  storeType: string;
  status: RetrievalStatus;
  seconds: number;
}): void {
  const attributes = otelAttributes({
    "dclimate_client.ipfs.gateway": gatewayUrl,
    "dclimate_client.ipfs.store_type": storeType,
    "dclimate_client.ipfs.status": status,
  });
  STORE_OPEN_COUNTER.add(1, attributes);
  STORE_OPEN_DURATION.record(seconds, attributes);
}

export function secondsSince(startedAt: number): number {
  return (performance.now() - startedAt) / 1000;
}

export function classifyRetrievalError(error: unknown): RetrievalStatus {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("Connection refused") ||
    message.includes("Max retries exceeded") ||
    message.includes("Timeout") ||
    message.includes("timed out") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT")
  ) {
    return "connection_error";
  }
  return "error";
}
