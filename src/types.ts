import type { IPFSELEMENTS_INTERFACE } from "@dclimate/jaxray";

export type IpfsElements = IPFSELEMENTS_INTERFACE;

export interface ClientOptions {
  gatewayUrl?: string;
  ipfsElements?: IpfsElements;
}

export interface LoadDatasetOptions {
  cid?: string;
  gatewayUrl?: string;
  ipfsElements?: IpfsElements;
  returnJaxrayDataset?: boolean;
  autoConcatenate?: boolean;
}

export interface PointQueryOptions {
  method?: "nearest" | "exact";
  latitudeKey?: string;
  longitudeKey?: string;
  tolerance?: number;
}

export interface TimeRange {
  start: Date | string;
  end: Date | string;
}

export interface GeoSelectionOptions {
  point?: {
    latitude: number;
    longitude: number;
    options?: PointQueryOptions;
  };
  timeRange?: TimeRange;
}

export interface DatasetMetadata {
  dataset: string;
  collection?: string;
  variant?: string;
  /**
   * Array of variants that were concatenated together (if auto-concatenation was used)
   */
  concatenatedVariants?: string[];
  path: string;
  cid: string;
  /**
   * URL endpoint that was used to fetch the CID (if fetched from URL)
   */
  url?: string;
  /**
   * Unix timestamp in milliseconds when the dataset was last updated (if available from API)
   */
  timestamp?: number;
  /**
   * Source type: "catalog" for catalog resolution or "direct_cid" for direct CID loading
   */
  source: "catalog" | "direct_cid";
  fetchedAt: Date;
}

export interface DatasetRequest {
  dataset: string;
  collection?: string;
  variant?: string;
}
