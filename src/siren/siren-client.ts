/**
 * Siren REST API client (API-key authentication).
 */

import { DEFAULT_SIREN_API_URL } from "../constants.js";
import { SirenApiError } from "../errors.js";
import type {
  SirenMetricDataPoint,
  SirenMetricQuery,
  SirenOptions,
  SirenRegion,
  SirenRegionsResponse,
} from "./types.js";

/** Resolved API key auth with guaranteed non-optional fields */
interface ResolvedApiKeyAuth {
  type: "apiKey";
  apiKey: string;
  accountId: string;
}

/**
 * Coerce a raw API value to a finite number, or return null if it is not a
 * genuine numeric measurement. Unlike bare `Number(...)`, this rejects `null`,
 * booleans, and empty/whitespace strings (all of which `Number` would silently
 * turn into 0/1), so absent readings are never mistaken for real zeros.
 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

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

  const numericValue = toFiniteNumber(record.value);
  if (numericValue === null) {
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
    const numericValue = toFiniteNumber(value);
    if (numericValue === null) {
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

function getEnv(name: string): string | undefined {
  // Read from Node's process.env when available; returns undefined in browsers.
  // Accessed via globalThis so this type-checks without @types/node.
  const env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  return env?.[name];
}

export class SirenClient {
  private readonly auth: ResolvedApiKeyAuth;
  private readonly baseUrl: string;

  constructor(options: SirenOptions) {
    // Resolve API key auth from env vars if not provided directly
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

    this.baseUrl = options.baseUrl ?? DEFAULT_SIREN_API_URL;
  }

  /**
   * Fetch metric data for a region over a date range.
   */
  async getMetricData(query: SirenMetricQuery): Promise<SirenMetricDataPoint[]> {
    // Encode every dynamic segment: regionId/metric/dates are arbitrary
    // caller-supplied strings, so an unescaped '/', '?', or '#' could otherwise
    // alter the requested route.
    const accountId = encodeURIComponent(this.auth.accountId);
    const regionId = encodeURIComponent(query.regionId);
    const metric = encodeURIComponent(query.metric);
    const startDate = encodeURIComponent(formatDate(query.startDate));
    const endDate = encodeURIComponent(formatDate(query.endDate));

    const url = `${this.baseUrl}/metric-data-multiple/${accountId}/${regionId}/${metric}/${startDate}/${endDate}`;
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

  /**
   * List available regions.
   *
   * The endpoint is paginated (`limit`/`offset`/`total`); this walks every page
   * so callers always get the complete list. Regions are de-duplicated by `id`,
   * and pagination stops as soon as a page yields no new regions — so a server
   * that ignores the pagination params degrades to a single page rather than
   * looping forever or returning duplicates.
   */
  async listRegions(): Promise<SirenRegion[]> {
    const accountId = encodeURIComponent(this.auth.accountId);
    const pageSize = 100;
    const seen = new Set<string>();
    const all: SirenRegion[] = [];
    let offset = 0;
    // Hard cap on iterations as a final backstop against a misbehaving server.
    const MAX_PAGES = 10_000;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${this.baseUrl}/custom-regions/${accountId}/custom?limit=${pageSize}&offset=${offset}`;
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
      const items = Array.isArray(data.items) ? data.items : [];

      let added = 0;
      for (const region of items) {
        if (!seen.has(region.id)) {
          seen.add(region.id);
          all.push(region);
          added++;
        }
      }

      const total = typeof data.total === "number" ? data.total : all.length;
      // Stop on natural end (collected everything) or on no progress (empty
      // page, or a server that ignored the offset and re-sent the same page).
      if (added === 0 || all.length >= total) break;
      offset += items.length;
    }

    return all;
  }

  /**
   * List available metrics.
   */
  async listMetrics(): Promise<string[]> {
    const url = `${this.baseUrl}/metrics`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      throw new SirenApiError(
        `Siren API error (${response.status}): ${response.statusText}`
      );
    }
    return response.json();
  }
}
