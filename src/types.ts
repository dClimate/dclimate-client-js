import type { IPFSELEMENTS_INTERFACE } from "@dclimate/jaxray";

export type IpfsElements = IPFSELEMENTS_INTERFACE;

export interface ClientOptions {
  gatewayUrl?: string;
  ipfsElements?: IpfsElements;
  /**
   * STAC server URL for fast CID resolution.
   * If provided, the client will try this server first before falling back to IPFS catalog.
   * Default: "http://localhost:8081"
   */
  stacServerUrl?: string | null;
}

export interface LoadDatasetOptions {
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

export interface BoundsSelectionOptions {
  latitudeKey?: string;
  longitudeKey?: string;
}

export interface TimeRange {
  start: Date | string;
  end: Date | string;
}

export type BoundsSelection =
  | readonly [west: number, south: number, east: number, north: number]
  | {
      west: number;
      south: number;
      east: number;
      north: number;
      options?: BoundsSelectionOptions;
    };

export interface GeoSelectionOptions {
  point?: {
    latitude: number;
    longitude: number;
    options?: PointQueryOptions;
  };
  bounds?: BoundsSelection;
  boundsOptions?: BoundsSelectionOptions;
  timeRange?: TimeRange;
}

export interface DatasetMetadata {
  dataset: string;
  collection?: string;
  variant?: string;
  organization?: string;
  /**
   * Array of variants that were concatenated together (if STAC-based concatenation was used)
   */
  concatenatedVariants?: string[];
  /**
   * Dimension used for concatenation (e.g., "time")
   */
  concatDimension?: string;
  path: string;
  cid: string;
  /**
   * Source type: "stac" for STAC resolution, "stac_concatenated" for STAC-based concatenation, or "direct_cid" for direct CID loading
   */
  source: "stac" | "stac_concatenated" | "direct_cid";
  fetchedAt: Date;
}

export interface DatasetRequest {
  dataset?: string;
  collection?: string;
  variant?: string;
  organization?: string;
  cid?: string;
}

export interface DataArrayObject {
  data: unknown;
  dims: string[];
  coords: Record<string, unknown[]>;
  attrs: Record<string, unknown>;
  name?: string;
  shape: number[];
}

export interface DatasetObject {
  dataVars: Record<string, DataArrayObject>;
  coords: Record<string, unknown[]>;
  attrs: Record<string, unknown>;
  dims: string[];
  sizes: Record<string, number>;
}
