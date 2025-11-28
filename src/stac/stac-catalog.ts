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
  organization?: string;
  title?: string;
  category?: string;
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
  organizationId?: string;
  organizationTitle?: string;
  category?: string;
  datasetNames?: string[];
}

export interface StacCatalog {
  type: "Catalog";
  stac_version: string;
  id: string;
  title?: string;
  description?: string;
  links: StacLink[];
  collections?: StacCollection[]; // Loaded collections
  organizations?: StacOrganization[];
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

export interface StacOrganization {
  id: string;
  title?: string;
  link: StacLink;
  catalog: StacCatalog;
}

export interface ResolvedDatasetFromStac {
  cid: string;
  collectionId: string;
  organizationId?: string;
  dataset: string;
  variant: string;
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

function extractCollectionsFromOrgLink(link: StacLink): Set<string> {
  const collections = new Set<string>();
  Object.entries(link).forEach(([key, value]) => {
    if (!key.startsWith("dclimate:collections")) return;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === "string") {
          collections.add(v);
        }
      }
    }
  });
  return collections;
}

function extractDatasetSlugsFromOrgLink(link: StacLink): string[] {
  const datasets = link["dclimate:datasets"];
  if (!Array.isArray(datasets)) return [];
  return datasets.filter((d): d is string => typeof d === "string");
}

function buildCollectionCategoryMap(link: StacLink): Map<string, string> {
  const map = new Map<string, string>();
  Object.entries(link).forEach(([key, value]) => {
    if (!key.startsWith("dclimate:collections:")) return;
    const category = key.split(":").pop();
    if (!category || !Array.isArray(value)) return;
    for (const coll of value) {
      if (typeof coll === "string") {
        map.set(coll, category);
      }
    }
  });
  return map;
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
    const catalogUrl = resolveIpfsUri(`ipfs://${cid}`, gatewayUrl);
    const catalogResponse = await fetch(catalogUrl);

    if (!catalogResponse.ok) {
      throw new Error(`HTTP ${catalogResponse.status}: ${catalogResponse.statusText}`);
    }

    const catalog: StacCatalog = await catalogResponse.json();

    const organizations: StacOrganization[] = [];
    const collections: StacCollection[] = [];
    const orgLinks = catalog.links.filter(
      (link) => link.rel === "child" && typeof link?.["dclimate:id"] === "string"
    );

    for (const link of orgLinks) {
      const orgId = link["dclimate:id"] as string;
      const orgUrl = resolveIpfsUri(link.href, gatewayUrl);
      const collectionCategories = buildCollectionCategoryMap(link);
      const datasetSlugs = extractDatasetSlugsFromOrgLink(link);

      try {
        const orgResponse = await fetch(orgUrl);
        if (!orgResponse.ok) {
          console.warn(`Failed to load organization catalog from ${link.href}: ${orgResponse.status}`);
          continue;
        }

        const orgCatalog: StacCatalog = await orgResponse.json();
        organizations.push({
          id: orgId,
          title: link.title,
          link,
          catalog: orgCatalog,
        });

        const collectionLinks = orgCatalog.links.filter((orgLink) => orgLink.rel === "child");

        for (const collectionLink of collectionLinks) {
          try {
            const collectionUrl = resolveIpfsUri(collectionLink.href, gatewayUrl);
            const collectionResponse = await fetch(collectionUrl);

            if (!collectionResponse.ok) {
              console.warn(`Failed to load collection from ${collectionLink.href}: ${collectionResponse.status}`);
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
            collection.organizationId = orgId;
            collection.organizationTitle = link.title;
            const category = collectionCategories.get(collection.id);
            if (category) {
              collection.category = category;
            }

            const datasetNames = datasetSlugs
              .filter((slug) => slug.startsWith(`${collection.id}/`))
              .map((slug) => slug.split("/")[1])
              .filter(Boolean);
            if (datasetNames.length) {
              collection.datasetNames = datasetNames;
            }

            collections.push(collection);
          } catch (collectionError) {
            console.warn(`Error loading collection ${collectionLink.href}:`, collectionError);
          }
        }
      } catch (orgError) {
        console.warn(`Error loading organization ${link.href}:`, orgError);
      }
    }

    catalog.collections = collections;
    catalog.organizations = organizations;

    setCachedCatalog(gatewayUrl, catalog, cid);

    return catalog;
  } catch (error) {
    throw new StacLoadError(
      `Failed to load STAC catalog from IPFS CID: ${cid}`,
      error as Error
    );
  }
}

function selectCollectionFromCatalog(
  catalog: StacCatalog,
  collection: string,
  dataset?: string,
  organization?: string
): { collection: StacCollection; organizationId?: string; resolvedCollectionId: string } {
  const orgLinks = catalog.links.filter(
    (link) => link.rel === "child" && typeof link?.["dclimate:id"] === "string"
  );

  const normalizedCollection =
    organization && collection && !collection.startsWith(`${organization}_`)
      ? `${organization}_${collection}`
      : collection;

  let resolvedOrganization = organization;

  if (!resolvedOrganization) {
    for (const link of orgLinks) {
      const orgId = link["dclimate:id"] as string;
      const declaredCollections = extractCollectionsFromOrgLink(link);
      const datasetSlugs = extractDatasetSlugsFromOrgLink(link);
      const datasetCollections = datasetSlugs
        .map((slug) => (slug.includes("/") ? slug.split("/")[0] : slug))
        .filter(Boolean);

      const collectionMatches =
        declaredCollections.has(normalizedCollection) ||
        declaredCollections.has(collection) ||
        declaredCollections.has(`${orgId}_${collection}`) ||
        datasetCollections.includes(normalizedCollection) ||
        datasetCollections.includes(collection) ||
        datasetCollections.includes(`${orgId}_${collection}`);

      const datasetMatches =
        dataset &&
        datasetSlugs.some(
          (slug) =>
            slug === `${normalizedCollection}/${dataset}` ||
            slug === `${collection}/${dataset}` ||
            slug === `${orgId}_${collection}/${dataset}`
        );

      if (collectionMatches || datasetMatches) {
        resolvedOrganization = orgId;
        break;
      }
    }
  }

  if (!resolvedOrganization) {
    throw new StacResolutionError(
      `Unable to determine organization for collection "${collection}". Provide an organization or verify the catalog metadata.`
    );
  }

  const resolvedCollectionId =
    normalizedCollection || `${resolvedOrganization}_${collection}`;

  const collectionObj =
    catalog.collections?.find(
      (col) =>
        col.organizationId === resolvedOrganization &&
        (col.id === resolvedCollectionId || col.id === collection || col.id === `${resolvedOrganization}_${collection}`)
    ) ||
    catalog.collections?.find(
      (col) =>
        col.id === resolvedCollectionId || col.id === `${resolvedOrganization}_${collection}`
    );

  if (!collectionObj) {
    throw new StacResolutionError(
      `Collection "${collection}" not found under organization "${resolvedOrganization}".`
    );
  }

  return {
    collection: collectionObj,
    organizationId: resolvedOrganization,
    resolvedCollectionId: collectionObj.id,
  };
}

/**
 * Resolves a dataset from the STAC catalog, returning CID and resolved IDs.
 */
export function resolveDatasetFromStac(
  catalog: StacCatalog,
  collection: string,
  dataset: string,
  variant?: string,
  organization?: string
): ResolvedDatasetFromStac {
  const { collection: collectionObj, organizationId, resolvedCollectionId } =
    selectCollectionFromCatalog(catalog, collection, dataset, organization);

  const matchingItems = collectionObj.items?.filter((item) => {
    const prefix = `${collectionObj.id}-`;
    const remainder = item.id.startsWith(prefix)
      ? item.id.slice(prefix.length)
      : item.id;
    const parts = remainder.split("-");
    const itemDataset = parts[0];
    return itemDataset === dataset;
  });

  if (!matchingItems || matchingItems.length === 0) {
    const availableDatasets =
      collectionObj.items?.map((item) => {
        const prefix = `${collectionObj.id}-`;
        const remainder = item.id.startsWith(prefix)
          ? item.id.slice(prefix.length)
          : item.id;
        return remainder.split("-")[0];
      }) || [];
    const uniqueDatasets = [...new Set(availableDatasets)];
    throw new StacResolutionError(
      `Dataset "${dataset}" not found in collection "${resolvedCollectionId}". Available datasets: ${uniqueDatasets.join(", ")}`
    );
  }

  let selectedItem: StacItem | undefined;
  let resolvedVariant = variant ?? "";
  const candidates = matchingItems.map((item) => {
    const prefix = `${collectionObj.id}-`;
    const remainder = item.id.startsWith(prefix)
      ? item.id.slice(prefix.length)
      : item.id;
    const parts = remainder.split("-");
    const itemVariant = parts.slice(1).join("-") || "default";
    return { item, variant: itemVariant };
  });

  if (variant) {
    selectedItem = candidates.find((c) => c.variant === variant)?.item;
    if (!selectedItem) {
      const availableVariants = candidates.map((c) => c.variant);
      throw new StacResolutionError(
        `Variant "${variant}" not found for dataset "${resolvedCollectionId}-${dataset}". Available variants: ${availableVariants.join(", ")}`
      );
    }
    resolvedVariant = variant;
  } else {
    if (candidates.length === 1) {
      selectedItem = candidates[0].item;
      resolvedVariant = candidates[0].variant;
    } else {
      const preferredOrder = ["default", "final", "finalized", "latest", ""];
      for (const pref of preferredOrder) {
        const match = candidates.find((c) => c.variant === pref);
        if (match) {
          selectedItem = match.item;
          resolvedVariant = match.variant;
          break;
        }
      }
      if (!selectedItem) {
        const availableVariants = candidates.map((c) => c.variant);
        throw new StacResolutionError(
          `Multiple variants available for "${resolvedCollectionId}-${dataset}". Please specify one of: ${availableVariants.join(", ")}`
        );
      }
    }
  }

  if (!selectedItem?.assets?.data) {
    throw new StacResolutionError(
      `No data asset found for item "${selectedItem?.id ?? "unknown"}"`
    );
  }

  const href = selectedItem.assets.data.href;
  const cid = href.replace(/^ipfs:\/\//, "");

  return {
    cid,
    collectionId: resolvedCollectionId,
    organizationId,
    dataset,
    variant: resolvedVariant || "default",
  };
}

/**
 * Resolves a dataset CID from the STAC catalog
 */
export function resolveDatasetCidFromStac(
  catalog: StacCatalog,
  collection: string,
  dataset: string,
  variant?: string,
  organization?: string
): string {
  return resolveDatasetFromStac(
    catalog,
    collection,
    dataset,
    variant,
    organization
  ).cid;
}

/**
 * Gets all items for a collection/dataset that have concatenation metadata
 */
export function getConcatenableItemsFromStac(
  catalog: StacCatalog,
  collection: string,
  dataset: string,
  organization?: string
): ConcatenableStacItem[] {
  const { collection: collectionObj } = selectCollectionFromCatalog(
    catalog,
    collection,
    dataset,
    organization
  );

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
    const collectionId = collection.id;
    const datasetNamesFromLink = collection.datasetNames || [];

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

    for (const datasetName of datasetNamesFromLink) {
      if (!datasetMap.has(datasetName)) {
        datasetMap.set(datasetName, { dataset: datasetName, variants: [] });
      }
    }

    // Convert map to array
    const datasets = Array.from(datasetMap.values());

    if (datasets.length > 0) {
      datasetCatalog.push({
        collection: collectionId,
        datasets,
        organization: collection.organizationId,
        title: collection.title,
        category: collection.category,
      });
    }
  }

  return datasetCatalog;
}
