/**
 * Siren API types and authentication strategies.
 *
 * Supports two auth modes:
 * - API key + account ID (traditional Bearer token)
 * - x402 pay-per-request via wallet signature (MetaMask, viem, etc.)
 */

// ---------------------------------------------------------------------------
// EVM signer interface (mirrors @x402/evm ClientEvmSigner)
// Defined here so the SDK has zero hard dependency on @x402/*
// ---------------------------------------------------------------------------

export interface EvmSigner {
  readonly address: `0x${string}`;
  signTypedData(params: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
  readContract(params: {
    address: `0x${string}`;
    abi: unknown[];
    functionName: string;
    args?: unknown[];
  }): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Auth strategies (discriminated union)
// ---------------------------------------------------------------------------

export interface SirenApiKeyAuth {
  type: "apiKey";
  /** Falls back to SIREN_API_KEY env var if omitted */
  apiKey?: string;
  /** Falls back to SIREN_ACCOUNT_ID env var if omitted */
  accountId?: string;
}

export interface SirenX402Auth {
  type: "x402";
  /** An EVM signer — use createEip1193Signer() for MetaMask, or @x402/evm's toClientEvmSigner() for viem */
  signer: EvmSigner;
  /** Chain network identifier (default: "base") */
  network?: string;
  /** x402 facilitator URL (uses protocol default if omitted) */
  facilitatorUrl?: string;
}

export type SirenAuth = SirenApiKeyAuth | SirenX402Auth;

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface SirenOptions {
  auth: SirenAuth;
  /** Base URL for API-key authenticated requests (default: production Siren API) */
  baseUrl?: string;
  /** Base URL for x402-authenticated requests (separate service, TBD) */
  x402BaseUrl?: string;
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
