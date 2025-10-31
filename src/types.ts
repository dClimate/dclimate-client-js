export interface ClientOptions {
  gatewayUrl?: string;
}

export interface LoadDatasetOptions {
  cid?: string;
  gatewayUrl?: string;
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
  fetchedAt: Date;
}

export interface DatasetRequest {
  dataset: string;
  collection?: string;
  variant?: string;
}
