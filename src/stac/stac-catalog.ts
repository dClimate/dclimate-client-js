// ============================================================================
// Error Classes
// ============================================================================

export class StacCatalogError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = "StacCatalogError";
  }
}

export class StacLoadError extends StacCatalogError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = "StacLoadError";
  }
}

export class StacResolutionError extends StacCatalogError {
  constructor(message: string) {
    super(message);
    this.name = "StacResolutionError";
  }
}

// ============================================================================
// STAC Interfaces
// ============================================================================

export interface DatasetVariantConfig {
  variant: string;
  cid?: string;
  /**
   * Priority for auto-concatenation. Lower numbers = higher priority (loaded first).
   * When multiple variants have concatPriority defined, they will be automatically
   * concatenated in priority order (1, 2, 3, ...).
   * Variants without concatPriority are not included in auto-concatenation.
   */
  concatPriority?: number;
  /**
   * Dimension along which to concatenate (default: "time").
   * Only used when concatPriority is defined.
   */
  concatDimension?: string;
}

export interface CatalogDataset {
  dataset: string;
  variants: DatasetVariantConfig[];
}

export interface CatalogCollection {
  collection: string;
  datasets: CatalogDataset[];
}

export type DatasetCatalog = CatalogCollection[];


export interface StacLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
  // For dclimate:id, dclimate:types and other arbitrary metadata
  [key: string]: any;
}

export interface StacAsset {
  href: string;
  type?: string;
  title?: string;
  roles?: string[];
}

export interface StacItem {
  type: "Feature";
  stac_version: string;
  id: string;
  properties: Record<string, any>;
  geometry: any;
  bbox?: number[];
  assets: Record<string, StacAsset>;
  links: StacLink[];
}

export interface StacCollection {
  type: "Collection";
  stac_version: string;
  id: string;
  title?: string;
  description?: string;
  keywords?: string[];
  license?: string;
  extent?: any;
  summaries?: Record<string, any>;
  links: StacLink[];
  items?: StacItem[]; // Loaded items
}

export interface StacCatalog {
  type: "Catalog";
  stac_version: string;
  id: string;
  title?: string;
  description?: string;
  links: StacLink[];
  collections?: StacCollection[]; // Loaded collections
}

interface CatalogCacheEntry {
  catalog: StacCatalog;
  timestamp: number;
  rootCid: string;
}

export interface StacCatalogOptions {
  gatewayUrl?: string;
  cacheTtlMs?: number; // Default: 3600000 (1 hour)
  rootCid?: string; // Optional: use specific catalog version
}

export interface ConcatenableStacItem {
  variant: string;
  cid: string;
  concatPriority: number;
  concatDimension: string;
}

// ============================================================================
// Cache Implementation
// ============================================================================

const catalogCache: Map<string, CatalogCacheEntry> = new Map();

function getCachedCatalog(gatewayUrl: string, ttlMs: number): StacCatalog | null {
  const key = `stac:${gatewayUrl}`;
  const entry = catalogCache.get(key);

  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age > ttlMs) {
    catalogCache.delete(key);
    return null;
  }

  return entry.catalog;
}

function setCachedCatalog(gatewayUrl: string, catalog: StacCatalog, rootCid: string): void {
  const key = `stac:${gatewayUrl}`;
  catalogCache.set(key, {
    catalog,
    timestamp: Date.now(),
    rootCid,
  });
}

// ============================================================================
// Core STAC Functions
// ============================================================================

/**
 * Fetches the root catalog CID from the STAC API endpoint
 */
export async function getRootCatalogCid(): Promise<string> {
  try {
    const response = await fetch("https://ipfs-gateway.dclimate.net/stac");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.cid || typeof data.cid !== "string") {
      throw new Error("Invalid response: missing or invalid 'cid' field");
    }

    return data.cid;
  } catch (error) {
    throw new StacLoadError(
      "Failed to fetch root catalog CID from STAC API",
      error as Error
    );
  }
}

/**
 * Converts ipfs:// URIs to HTTP gateway URLs
 */
export function resolveIpfsUri(uri: string, gatewayUrl: string): string {
  if (uri.startsWith("ipfs://")) {
    const cid = uri.replace(/^ipfs:\/\//, "");
    return `${gatewayUrl}/ipfs/${cid}`;
  }
  return uri;
}

/**
 * Loads the STAC catalog from IPFS, with recursive loading of collections and items
 */
export async function loadStacCatalog(
  gatewayUrl: string,
  rootCid?: string
): Promise<StacCatalog> {
  const cacheTtl = 3600000; // 1 hour

  // Check cache first
  const cached = getCachedCatalog(gatewayUrl, cacheTtl);
  if (cached) {
    return cached;
  }

  // Fetch root CID if not provided
  const cid = rootCid || (await getRootCatalogCid());

  try {
    // Load root catalog
    const catalogUrl = resolveIpfsUri(`ipfs://${cid}`, gatewayUrl);
    const catalogResponse = await fetch(catalogUrl);

    if (!catalogResponse.ok) {
      throw new Error(`HTTP ${catalogResponse.status}: ${catalogResponse.statusText}`);
    }

    const catalog: StacCatalog = await catalogResponse.json();

    // Load collections recursively
    const collections: StacCollection[] = [];
    const collectionLinks = catalog.links.filter((link) => link.rel === "child");

    for (const link of collectionLinks) {
      try {
        const collectionUrl = resolveIpfsUri(link.href, gatewayUrl);
        const collectionResponse = await fetch(collectionUrl);

        if (!collectionResponse.ok) {
          console.warn(`Failed to load collection from ${link.href}: ${collectionResponse.status}`);
          continue;
        }

        const collection: StacCollection = await collectionResponse.json();

        // Load items for this collection
        const items: StacItem[] = [];
        const itemLinks = collection.links.filter((itemLink) => itemLink.rel === "item");

        for (const itemLink of itemLinks) {
          try {
            const itemUrl = resolveIpfsUri(itemLink.href, gatewayUrl);
            const itemResponse = await fetch(itemUrl);

            if (!itemResponse.ok) {
              console.warn(`Failed to load item from ${itemLink.href}: ${itemResponse.status}`);
              continue;
            }

            const item: StacItem = await itemResponse.json();
            items.push(item);
          } catch (itemError) {
            console.warn(`Error loading item ${itemLink.href}:`, itemError);
          }
        }

        collection.items = items;
        collections.push(collection);
      } catch (collectionError) {
        console.warn(`Error loading collection ${link.href}:`, collectionError);
      }
    }

    catalog.collections = collections;

    // Cache the loaded catalog
    setCachedCatalog(gatewayUrl, catalog, cid);

    return catalog;
  } catch (error) {
    throw new StacLoadError(
      `Failed to load STAC catalog from IPFS CID: ${cid}`,
      error as Error
    );
  }
}

/**
 * Resolves a dataset CID from the STAC catalog
 */
export function resolveDatasetCidFromStac(
  catalog: StacCatalog,
  collection: string,
  dataset: string,
  variant?: string
): string {
  // Find collection in catalog
  const collectionObj = catalog.collections?.find(
    (col) =>
      col.id === collection ||
      catalog.links.some(
        (link) =>
          link.rel === "child" &&
          link?.["dclimate:id"] === collection &&
          link.href.includes(col.id)
      )
  );

  if (!collectionObj) {
    const availableCollections = catalog.collections?.map((c) => c.id) || [];
    throw new StacResolutionError(
      `Collection "${collection}" not found in STAC catalog. Available collections: ${availableCollections.join(", ")}`
    );
  }

  // Find matching items
  const matchingItems = collectionObj.items?.filter((item) => {
    // Parse item ID: expected format is {collection}-{dataset}-{variant}
    const parts = item.id.split("-");
    if (parts.length < 2) return false;

    const itemCollection = parts[0];
    const itemDataset = parts[1];
    const itemVariant = parts.slice(2).join("-") || "default";

    return itemCollection === collection && itemDataset === dataset;
  });

  if (!matchingItems || matchingItems.length === 0) {
    const availableDatasets = collectionObj.items?.map((item) => {
      const parts = item.id.split("-");
      return parts[1];
    }) || [];
    const uniqueDatasets = [...new Set(availableDatasets)];
    throw new StacResolutionError(
      `Dataset "${dataset}" not found in collection "${collection}". Available datasets: ${uniqueDatasets.join(", ")}`
    );
  }

  // If variant specified, find exact match
  if (variant) {
    const item = matchingItems.find((item) => {
      const parts = item.id.split("-");
      const itemVariant = parts.slice(2).join("-") || "default";
      return itemVariant === variant;
    });

    if (!item) {
      const availableVariants = matchingItems.map((item) => {
        const parts = item.id.split("-");
        return parts.slice(2).join("-") || "default";
      });
      throw new StacResolutionError(
        `Variant "${variant}" not found for dataset "${collection}-${dataset}". Available variants: ${availableVariants.join(", ")}`
      );
    }

    // Extract CID from asset
    const dataAsset = item.assets.data;
    if (!dataAsset) {
      throw new StacResolutionError(
        `No data asset found for item "${item.id}"`
      );
    }

    return dataAsset.href.replace(/^ipfs:\/\//, "");
  }

  // No variant specified - if only one item, return it
  if (matchingItems.length === 1) {
    const item = matchingItems[0];
    const dataAsset = item.assets.data;
    if (!dataAsset) {
      throw new StacResolutionError(
        `No data asset found for item "${item.id}"`
      );
    }
    return dataAsset.href.replace(/^ipfs:\/\//, "");
  }

  // Multiple variants available, user must specify
  const availableVariants = matchingItems.map((item) => {
    const parts = item.id.split("-");
    return parts.slice(2).join("-") || "default";
  });
  throw new StacResolutionError(
    `Multiple variants available for "${collection}-${dataset}". Please specify one of: ${availableVariants.join(", ")}`
  );
}

/**
 * Gets all items for a collection/dataset that have concatenation metadata
 */
export function getConcatenableItemsFromStac(
  catalog: StacCatalog,
  collection: string,
  dataset: string
): ConcatenableStacItem[] {
  // Find collection in catalog
  const collectionObj = catalog.collections?.find(
    (col) =>
      col.id === collection ||
      catalog.links.some(
        (link) =>
          link.rel === "child" &&
          link?.["dclimate:id"] === collection &&
          link.href.includes(col.id)
      )
  );

  if (!collectionObj) {
    throw new StacResolutionError(
      `Collection "${collection}" not found in STAC catalog`
    );
  }

  // Find all items matching the dataset pattern
  const matchingItems: ConcatenableStacItem[] = [];

  for (const item of collectionObj.items || []) {
    // Parse item ID: expected format is {collection}-{dataset}-{variant}
    const parts = item.id.split("-");
    if (parts.length < 2) continue;

    const itemCollection = parts[0];
    const itemDataset = parts[1];
    const itemVariant = parts.slice(2).join("-") || "default";

    // Check if this item matches our dataset
    if (itemCollection === collection && itemDataset === dataset) {
      // Check for concatenation metadata in properties
      const concatPriority = item.properties["dclimate:concatPriority"];
      const concatDimension = item.properties["dclimate:concatDimension"];

      // Also check in link metadata (fallback)
      const itemLink = collectionObj.links.find(
        (link) =>
          link.rel === "item" && link?.["dclimate:id"] === item.id
      );

      const linkConcatPriority = itemLink?.["dclimate:concatPriority"];
      const linkConcatDimension = itemLink?.["dclimate:concatDimension"];

      const priority = concatPriority ?? linkConcatPriority;
      const dimension = concatDimension ?? linkConcatDimension ?? "time";

      // Extract CID from assets
      const dataAsset = item.assets.data;
      if (!dataAsset) continue;

      const cid = dataAsset.href.replace(/^ipfs:\/\//, "");

      matchingItems.push({
        variant: itemVariant,
        cid,
        concatPriority: priority ?? 0,
        concatDimension: dimension,
      });
    }
  }

  return matchingItems;
}

/**
 * Lists all datasets available in the STAC catalog
 */
export function listAvailableDatasetsFromStac(
  catalog: StacCatalog
): DatasetCatalog {
  const datasetCatalog: DatasetCatalog = [];

  for (const collection of catalog.collections || []) {

    // Find collection link to get dclimate metadata
    const collectionLink = catalog.links.find(
      (link) =>
        link.rel === "child" &&
        (link?.["dclimate:id"] === collection.id ||
          link.href.includes(collection.id))
    );

    const collectionId =
      collectionLink?.["dclimate:id"] || collection.id;

    // Group items by dataset
    const datasetMap = new Map<string, { dataset: string; variants: any[] }>();

    for (const item of collection.items || []) {
      const parts = item.id.split("-");
      if (parts.length < 2) continue;

      const itemDataset = parts[1];
      const itemVariant = parts.slice(2).join("-") || "default";

      // Extract CID from asset
      const dataAsset = item.assets.data;
      if (!dataAsset) continue;

      const cid = dataAsset.href.replace(/^ipfs:\/\//, "");

      if (!datasetMap.has(itemDataset)) {
        datasetMap.set(itemDataset, {
          dataset: itemDataset,
          variants: [],
        });
      }

      datasetMap.get(itemDataset)!.variants.push({
        variant: itemVariant,
        cid,
      });
    }

    // Convert map to array
    const datasets = Array.from(datasetMap.values());

    if (datasets.length > 0) {
      datasetCatalog.push({
        collection: collectionId,
        datasets,
      });
    }
  }

  return datasetCatalog;
}
