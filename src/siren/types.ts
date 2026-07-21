/**
 * Siren API types and authentication.
 *
 * Auth mode: API key + account ID (Bearer token).
 */

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface SirenApiKeyAuth {
  type: "apiKey";
  /** Falls back to SIREN_API_KEY env var if omitted */
  apiKey?: string;
  /** Falls back to SIREN_ACCOUNT_ID env var if omitted */
  accountId?: string;
}

export type SirenAuth = SirenApiKeyAuth;

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface SirenOptions {
  auth: SirenAuth;
  /** Base URL for API requests (default: production Siren API) */
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Query types
// ---------------------------------------------------------------------------

export interface SirenMetricQuery {
  regionId: string;
  metric: string;
  startDate: string | Date;
  endDate: string | Date;
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface SirenMetricDataPoint {
  date: string;
  value: number;
  [key: string]: unknown;
}

export interface SirenCountry {
  id: string;
  name: string;
  code: string;
}

export interface SirenRegion {
  id: string;
  name: string;
  internal_code: string | null;
  region_type: string;
  account_id: string | null;
  country_id: string;
  commodity_code: string;
  geo_json: string;
  extra_info: string | null;
  created_at: string;
  historical_fetch_enabled: boolean;
  country: SirenCountry;
}

export interface SirenRegionsResponse {
  items: SirenRegion[];
  limit: number;
  offset: number;
  total: number;
}
