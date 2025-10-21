export type CatalogMap = Record<string, string>;

export interface CatalogResolverOptions {
  endpoint?: string;
  fetcher?: typeof fetch;
  staticCatalog?: CatalogMap;
  /** When true, the resolver will attempt to refresh the remote catalog once per process. */
  autoRefresh?: boolean;
}

export interface ClientOptions extends CatalogResolverOptions {
  gatewayUrl?: string;
}

export interface LoadDatasetOptions {
  cid?: string;
  /**
   * Optional pre-resolved CID path such as "collection-dataset-finalized".
   * When provided, the resolver will skip inferring from collection/dataset inputs.
   */
  path?: string;
  gatewayUrl?: string;
  signal?: AbortSignal;
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
  path: string;
  cid: string;
  fetchedAt: Date;
}

export interface DatasetRequest {
  dataset: string;
  collection?: string;
  variant?: string;
}
