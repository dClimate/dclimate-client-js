/**
 * Siren REST API client supporting API-key and x402 payment authentication.
 */

import { DEFAULT_SIREN_API_URL } from "../constants.js";
import { SirenApiError, X402NotInstalledError, X402PaymentError } from "../errors.js";
import type {
  SirenAuth,
  SirenMetricDataPoint,
  SirenMetricQuery,
  SirenOptions,
  SirenRegion,
  SirenRegionsResponse,
} from "./types.js";

/**
 * Parse the Siren metric-data response format.
 * The API returns: `{ "metric_name": { "2026-01-01": 0.5, "2026-01-02": 1.2, ... } }`
 * We flatten this into an array of `{ date, value }` objects.
 */
function parseMetricListItem(item: unknown): SirenMetricDataPoint {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new SirenApiError("Unexpected Siren metric list format: items must be objects.");
  }

  const record = item as Record<string, unknown>;
  if (typeof record.date !== "string") {
    throw new SirenApiError(
      "Unexpected Siren metric list format: each item must include a string 'date'."
    );
  }

  const numericValue = Number(record.value);
  if (!Number.isFinite(numericValue)) {
    throw new SirenApiError(
      "Unexpected Siren metric list format: each item must include a numeric 'value'."
    );
  }

  return {
    ...record,
    date: record.date,
    value: numericValue,
  };
}

function parseMetricResponse(
  body: unknown,
  metric: string
): SirenMetricDataPoint[] {
  if (Array.isArray(body)) return body.map(parseMetricListItem);
  if (!body || typeof body !== "object") {
    throw new SirenApiError(
      "Unexpected Siren metric response format: expected an object or array."
    );
  }

  const record = body as Record<string, unknown>;
  if (!(metric in record)) {
    const availableMetrics = Object.keys(record);
    if (availableMetrics.length > 0) {
      const preview = availableMetrics.slice(0, 5).join(", ");
      const suffix = availableMetrics.length > 5 ? ", ..." : "";
      throw new SirenApiError(
        `Siren API response missing requested metric '${metric}'. Available metrics: ${preview}${suffix}.`
      );
    }
    throw new SirenApiError(
      `Siren API response missing requested metric '${metric}' and returned no metrics.`
    );
  }

  const timeSeries = record[metric];
  if (!timeSeries || typeof timeSeries !== "object" || Array.isArray(timeSeries)) {
    throw new SirenApiError(
      `Unexpected Siren metric response format for '${metric}': expected an object keyed by date.`
    );
  }

  return Object.entries(timeSeries).map(([date, value]) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      throw new SirenApiError(
        `Unexpected Siren metric value type for date '${date}': expected numeric value.`
      );
    }
    return { date, value: numericValue };
  });
}

function formatDate(date: string | Date): string {
  if (typeof date === "string") return date;
  return date.toISOString().split("T")[0];
}

/** Resolved API key auth with guaranteed non-optional fields */
interface ResolvedApiKeyAuth {
  type: "apiKey";
  apiKey: string;
  accountId: string;
}

function isApiKeyAuth(auth: SirenAuth): auth is ResolvedApiKeyAuth {
  return auth.type === "apiKey";
}

function getEnv(name: string): string | undefined {
  // Works in Node.js; silently returns undefined in browsers
  try {
    return typeof process !== "undefined" ? process.env[name] : undefined;
  } catch {
    return undefined;
  }
}

export class SirenClient {
  private readonly auth: SirenAuth;
  private readonly baseUrl: string;
  private readonly x402BaseUrl: string | undefined;
  private x402Fetch?: typeof fetch;

  constructor(options: SirenOptions) {
    // Resolve API key auth from env vars if not provided directly
    if (options.auth.type === "apiKey") {
      const apiKey = options.auth.apiKey ?? getEnv("SIREN_API_KEY");
      const accountId = options.auth.accountId ?? getEnv("SIREN_ACCOUNT_ID");
      if (!apiKey) {
        throw new SirenApiError(
          "Siren API key is required. Pass it as auth.apiKey or set the SIREN_API_KEY environment variable."
        );
      }
      if (!accountId) {
        throw new SirenApiError(
          "Siren account ID is required. Pass it as auth.accountId or set the SIREN_ACCOUNT_ID environment variable."
        );
      }
      this.auth = { type: "apiKey", apiKey, accountId };
    } else {
      this.auth = options.auth;
    }

    this.baseUrl = options.baseUrl ?? DEFAULT_SIREN_API_URL;
    this.x402BaseUrl = options.x402BaseUrl;
  }

  /**
   * Fetch metric data for a region over a date range.
   */
  async getMetricData(query: SirenMetricQuery): Promise<SirenMetricDataPoint[]> {
    const startDate = formatDate(query.startDate);
    const endDate = formatDate(query.endDate);

    if (isApiKeyAuth(this.auth)) {
      const url = `${this.baseUrl}/metric-data-multiple/${this.auth.accountId}/${query.regionId}/${query.metric}/${startDate}/${endDate}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.auth.apiKey}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        throw new SirenApiError(
          `Siren API error (${response.status}): ${response.statusText}`
        );
      }
      const body = await response.json();
      return parseMetricResponse(body, query.metric);
    }

    // x402 auth
    const wrappedFetch = await this.getX402Fetch();
    const apiBase = this.x402BaseUrl ?? this.baseUrl;
    const url = `${apiBase}/metric-data/${query.regionId}/${query.metric}/${startDate}/${endDate}`;
    const response = await wrappedFetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      throw new X402PaymentError(
        `Siren x402 request failed (${response.status}): ${response.statusText}`
      );
    }
    const body = await response.json();
    return parseMetricResponse(body, query.metric);
  }

  /**
   * List available regions. Free endpoint — no payment required.
   */
  async listRegions(): Promise<SirenRegion[]> {
    if (isApiKeyAuth(this.auth)) {
      const url = `${this.baseUrl}/custom-regions/${this.auth.accountId}/custom`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.auth.apiKey}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        throw new SirenApiError(
          `Siren API error (${response.status}): ${response.statusText}`
        );
      }
      const data: SirenRegionsResponse = await response.json();
      return data.items;
    }

    // x402 auth — listRegions is free, but we still use the x402 base URL
    // The server simply won't return 402 for this endpoint
    const wrappedFetch = await this.getX402Fetch();
    const apiBase = this.x402BaseUrl ?? this.baseUrl;
    const url = `${apiBase}/regions`;
    const response = await wrappedFetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      throw new SirenApiError(
        `Siren API error (${response.status}): ${response.statusText}`
      );
    }
    const data: SirenRegionsResponse = await response.json();
    return data.items;
  }

  /**
   * Lazily initialize the x402-wrapped fetch function.
   * Dynamically imports @x402/* packages so they remain optional.
   */
  private async getX402Fetch(): Promise<typeof fetch> {
    if (this.x402Fetch) return this.x402Fetch;

    if (this.auth.type !== "x402") {
      throw new Error("x402 fetch requested but auth is not x402");
    }

    let wrapFetchWithPayment: typeof import("@x402/fetch")["wrapFetchWithPayment"];
    let x402Client: typeof import("@x402/core")["x402Client"];
    let registerEvmSchemes: typeof import("@x402/evm")["registerEvmSchemes"];

    try {
      const fetchMod = await import("@x402/fetch");
      wrapFetchWithPayment = fetchMod.wrapFetchWithPayment;
    } catch {
      throw new X402NotInstalledError(
        "x402 auth requires @x402/fetch. Install it: npm install @x402/core @x402/fetch @x402/evm"
      );
    }

    try {
      const coreMod = await import("@x402/core");
      x402Client = coreMod.x402Client;
    } catch {
      throw new X402NotInstalledError(
        "x402 auth requires @x402/core. Install it: npm install @x402/core @x402/fetch @x402/evm"
      );
    }

    try {
      const evmMod = await import("@x402/evm");
      registerEvmSchemes = evmMod.registerEvmSchemes;
    } catch {
      throw new X402NotInstalledError(
        "x402 auth requires @x402/evm. Install it: npm install @x402/core @x402/fetch @x402/evm"
      );
    }

    // Build x402 client with EVM scheme registered for the signer
    const client = new x402Client();
    const network = this.auth.network ?? "base";
    registerEvmSchemes(client, this.auth.signer, network);

    this.x402Fetch = wrapFetchWithPayment(fetch, client);
    return this.x402Fetch;
  }
}
