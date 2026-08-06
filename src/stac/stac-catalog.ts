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

export interface SpatialExtent {
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
}

export interface TemporalExtent {
  start: string | null;
  end: string | null;
}

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
  spatialExtent?: SpatialExtent;
  temporalExtent?: TemporalExtent;
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
  [key: string]: unknown;
}

export interface StacAsset {
  href: string;
  type?: string;
  title?: string;
  roles?: string[];
  [key: string]: unknown;
}

export interface StacItem {
  type: "Feature";
  stac_version: string;
  id: string;
  properties: Record<string, unknown>;
  geometry: unknown;
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
  extent?: unknown;
  summaries?: Record<string, unknown>;
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
}

export function getStringProperty(
  properties: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = properties?.[key];
  return typeof value === "string" ? value : undefined;
}

function getBooleanProperty(
  properties: Record<string, unknown> | undefined,
  key: string
): boolean | undefined {
  const value = properties?.[key];
  return typeof value === "boolean" ? value : undefined;
}

export interface StacReleaseMetadata {
  versionsApi?: string;
  provenanceApi?: string;
  citationApi?: string;
  streamId?: string;
  commitId?: string;
  versionLabel?: string;
  isCitable?: boolean;
  retentionClass?: string;
}

export function getStacReleaseMetadata(
  properties: Record<string, unknown> | undefined
): StacReleaseMetadata {
  return {
    versionsApi: getStringProperty(properties, "dclimate:versions_api"),
    provenanceApi: getStringProperty(properties, "dclimate:provenance_api"),
    citationApi: getStringProperty(properties, "dclimate:citation_api"),
    streamId: getStringProperty(properties, "dclimate:stream_id"),
    commitId: getStringProperty(properties, "dclimate:commit_id"),
    versionLabel: getStringProperty(properties, "dclimate:version_label"),
    isCitable: getBooleanProperty(properties, "dclimate:is_citable"),
    retentionClass: getStringProperty(properties, "dclimate:retention_class"),
  };
}

function getNumberProperty(
  properties: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const value = properties?.[key];
  return typeof value === "number" ? value : undefined;
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
  zarrResolutions: StacZarrResolution[];
}

export interface StacOrganization {
  id: string;
  title?: string;
  link: StacLink;
  catalog: StacCatalog;
}

export interface ResolvedDatasetFromStac extends StacReleaseMetadata {
  cid: string;
  collectionId: string;
  organizationId?: string;
  dataset: string;
  variant: string;
  zarrResolutions: StacZarrResolution[];
}

export interface StacZarrResolution {
  assetKey: string;
  resolution: string;
  group: string;
}

export function getStacZarrResolutions(
  assets: Record<string, StacAsset>
): StacZarrResolution[] {
  const choices = Object.entries(assets).flatMap(([assetKey, asset]) => {
    if (assetKey === "data") return [];
    const resolution = getStringProperty(asset, "dclimate:spatial_resolution");
    const group = getStringProperty(asset, "dclimate:zarr_group");
    return resolution && group ? [{ assetKey, resolution, group }] : [];
  });
  return choices.filter(
    (choice, index) =>
      choices.findIndex(
        (candidate) =>
          candidate.resolution === choice.resolution &&
          candidate.group === choice.group
      ) === index
  );
}

// ============================================================================
// Cache Implementation
// ============================================================================

const catalogCache: Map<string, CatalogCacheEntry> = new Map();

// In-flight loads keyed by cache key. The completed-catalog cache above only
// dedupes once a walk finishes; without this, N concurrent cold-cache callers
// each start their own walk (each with its own fan-out limiter), multiplying
// gateway traffic by N. Sharing the promise means one walk, one limiter.
const inFlightCatalogLoads: Map<string, Promise<StacCatalog>> = new Map();

function getCatalogCacheKey(gatewayUrl: string, rootCid?: string): string {
  // `||` (not ??) so an empty-string rootCid shares the latest slot, matching
  // loadStacCatalog's `rootCid || getRootCatalogCid()` resolution.
  return `stac:${gatewayUrl}:${rootCid || "latest"}`;
}

function getCachedCatalog(
  gatewayUrl: string,
  rootCid: string | undefined,
  ttlMs: number
): StacCatalog | null {
  const key = getCatalogCacheKey(gatewayUrl, rootCid);
  const entry = catalogCache.get(key);

  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age > ttlMs) {
    catalogCache.delete(key);
    return null;
  }

  return entry.catalog;
}

function setCachedCatalog(
  gatewayUrl: string,
  rootCid: string | undefined,
  catalog: StacCatalog
): void {
  const key = getCatalogCacheKey(gatewayUrl, rootCid);
  catalogCache.set(key, {
    catalog,
    timestamp: Date.now(),
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

// Cap on simultaneous gateway requests during the catalog walk. Uncapped
// fan-out fires every leaf at once (~139 documents on the real catalog);
// throttled responses would be warn-skipped and cached as a silently
// partial catalog for the TTL.
const MAX_CONCURRENT_CATALOG_FETCHES = 12;

function createFetchLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

// ============================================================================
// Core STAC Functions
// ============================================================================

/**
 * Fetches the root catalog CID from the STAC API endpoint
 */
export async function getRootCatalogCid(
  endpoint: string = "https://ipfs-gateway.dclimate.net/stac"
): Promise<string> {
  try {
    const response = await fetch(endpoint);
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
  const cached = getCachedCatalog(gatewayUrl, rootCid, cacheTtl);
  if (cached) {
    return cached;
  }

  // Coalesce concurrent cold-cache loads for the same catalog: the first
  // caller runs the walk and every other caller awaits the same promise,
  // so the fan-out cap is enforced across callers rather than per-call.
  const cacheKey = getCatalogCacheKey(gatewayUrl, rootCid);
  const existing = inFlightCatalogLoads.get(cacheKey);
  if (existing) {
    return existing;
  }

  const loadPromise = loadStacCatalogUncached(gatewayUrl, rootCid);
  inFlightCatalogLoads.set(cacheKey, loadPromise);
  try {
    return await loadPromise;
  } finally {
    inFlightCatalogLoads.delete(cacheKey);
  }
}

async function loadStacCatalogUncached(
  gatewayUrl: string,
  rootCid?: string
): Promise<StacCatalog> {
  // Fetch root CID if not provided
  const cid = rootCid || (await getRootCatalogCid());

  try {
    const catalogUrl = resolveIpfsUri(`ipfs://${cid}`, gatewayUrl);
    const catalogResponse = await fetch(catalogUrl);

    if (!catalogResponse.ok) {
      throw new Error(`HTTP ${catalogResponse.status}: ${catalogResponse.statusText}`);
    }

    const catalog: StacCatalog = await catalogResponse.json();

    const orgLinks = catalog.links.filter(
      (link) => link.rel === "child" && typeof link?.["dclimate:id"] === "string"
    );

    // The limiter guards only the fetch itself (not whole mapper bodies), so
    // a parent level never holds a slot while awaiting its children.
    const limitedFetch = createFetchLimiter(MAX_CONCURRENT_CATALOG_FETCHES);

    const organizationResults = await Promise.all(
      orgLinks.map(async (link) => {
        const orgId = link["dclimate:id"] as string;
        const orgUrl = resolveIpfsUri(link.href, gatewayUrl);
        const collectionCategories = buildCollectionCategoryMap(link);
        const datasetSlugs = extractDatasetSlugsFromOrgLink(link);

        let organization: StacOrganization;
        try {
          const orgResponse = await limitedFetch(() => fetch(orgUrl));
          if (!orgResponse.ok) {
            console.warn(`Failed to load organization catalog from ${link.href}: ${orgResponse.status}`);
            return undefined;
          }

          const orgCatalog: StacCatalog = await orgResponse.json();
          organization = {
            id: orgId,
            title: link.title,
            link,
            catalog: orgCatalog,
          };
        } catch (orgError) {
          console.warn(`Error loading organization ${link.href}:`, orgError);
          return undefined;
        }

        // A parsed org whose collection listing is malformed or fails still
        // appears in catalog.organizations with zero collections, matching
        // the pre-parallelization walk.
        try {
          const collectionLinks = organization.catalog.links.filter(
            (orgLink) => orgLink.rel === "child"
          );
          const collectionResults = await Promise.all(
            collectionLinks.map(async (collectionLink) => {
              try {
                const collectionUrl = resolveIpfsUri(collectionLink.href, gatewayUrl);
                const collectionResponse = await limitedFetch(() =>
                  fetch(collectionUrl)
                );

                if (!collectionResponse.ok) {
                  console.warn(`Failed to load collection from ${collectionLink.href}: ${collectionResponse.status}`);
                  return undefined;
                }

                const collection: StacCollection = await collectionResponse.json();

                // Load items for this collection
                const itemLinks = collection.links.filter((itemLink) => itemLink.rel === "item");
                const itemResults = await Promise.all(
                  itemLinks.map(async (itemLink) => {
                    try {
                      const itemUrl = resolveIpfsUri(itemLink.href, gatewayUrl);
                      const itemResponse = await limitedFetch(() =>
                        fetch(itemUrl)
                      );

                      if (!itemResponse.ok) {
                        console.warn(`Failed to load item from ${itemLink.href}: ${itemResponse.status}`);
                        return undefined;
                      }

                      return await itemResponse.json() as StacItem;
                    } catch (itemError) {
                      console.warn(`Error loading item ${itemLink.href}:`, itemError);
                      return undefined;
                    }
                  })
                );

                collection.items = itemResults.filter((item): item is StacItem => item !== undefined);
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

                return collection;
              } catch (collectionError) {
                console.warn(`Error loading collection ${collectionLink.href}:`, collectionError);
                return undefined;
              }
            })
          );

          return {
            organization,
            collections: collectionResults.filter(
              (collection): collection is StacCollection => collection !== undefined
            ),
          };
        } catch (orgError) {
          console.warn(`Error loading organization ${link.href}:`, orgError);
          return { organization, collections: [] };
        }
      })
    );
    const loadedOrganizations = organizationResults.filter(
      (result): result is NonNullable<typeof result> => result !== undefined
    );
    const organizations = loadedOrganizations.map(({ organization }) => organization);
    const collections = loadedOrganizations.flatMap((result) => result.collections);

    catalog.collections = collections;
    catalog.organizations = organizations;

    setCachedCatalog(gatewayUrl, rootCid, catalog);

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

  if (!selectedItem) {
    throw new StacResolutionError("No STAC item was selected for this dataset");
  }

  const zarrResolutions = getStacZarrResolutions(selectedItem.assets);
  const selectedAsset =
    selectedItem.assets.data ??
    (zarrResolutions[0]
      ? selectedItem.assets[zarrResolutions[0].assetKey]
      : undefined);
  if (!selectedAsset) {
    throw new StacResolutionError(
      `No readable data asset found for item "${selectedItem.id}"`
    );
  }
  const href = selectedAsset.href;
  const cid = href.replace(/^ipfs:\/\//, "");

  return {
    cid,
    collectionId: resolvedCollectionId,
    organizationId,
    dataset,
    variant: resolvedVariant || "default",
    zarrResolutions,
    ...getStacReleaseMetadata(selectedItem.properties),
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
  const { collection: collectionObj, resolvedCollectionId } = selectCollectionFromCatalog(
    catalog,
    collection,
    dataset,
    organization
  );

  // Find all items matching the dataset pattern
  const matchingItems: ConcatenableStacItem[] = [];

  // Item IDs follow {collection}-{dataset}-{variant}. Strip the resolved
  // collection id as a prefix (mirroring resolveDatasetFromStac) so
  // collection and dataset names containing hyphens still match.
  const collectionPrefix = `${resolvedCollectionId}-`;

  for (const item of collectionObj.items || []) {
    if (!item.id.startsWith(collectionPrefix)) continue;
    const remainder = item.id.slice(collectionPrefix.length);

    if (remainder !== dataset && !remainder.startsWith(`${dataset}-`)) {
      continue;
    }
    const itemVariant =
      remainder === dataset
        ? "default"
        : remainder.slice(dataset.length + 1) || "default";

    // Check for concatenation metadata in properties
    // Also check in link metadata (fallback)
    const itemLink = collectionObj.links.find(
      (link) =>
        link.rel === "item" && link?.["dclimate:id"] === item.id
    );

    // Variants without an explicit concatPriority have not opted into
    // auto-concatenation (see DatasetVariantConfig) and must be excluded.
    const priority =
      getNumberProperty(item.properties, "dclimate:concatPriority") ??
      getNumberProperty(itemLink, "dclimate:concatPriority");
    if (priority === undefined) continue;
    const dimension =
      getStringProperty(item.properties, "dclimate:concatDimension") ??
      getStringProperty(itemLink, "dclimate:concatDimension") ??
      "time";

    // Extract CID from assets
    const zarrResolutions = getStacZarrResolutions(item.assets);
    const dataAsset =
      item.assets.data ??
      (zarrResolutions[0] ? item.assets[zarrResolutions[0].assetKey] : undefined);
    if (!dataAsset) continue;

    const cid = dataAsset.href.replace(/^ipfs:\/\//, "");

    matchingItems.push({
      variant: itemVariant,
      cid,
      concatPriority: priority,
      concatDimension: dimension,
      zarrResolutions,
    });
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
    const datasetMap = new Map<string, CatalogDataset>();

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

      const variantEntry: DatasetVariantConfig = {
        variant: itemVariant,
        cid,
      };

      const bbox = item.bbox;
      if (Array.isArray(bbox) && bbox.length >= 4) {
        variantEntry.spatialExtent = {
          bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
        };
      }

      const startDt =
        getStringProperty(item.properties, "start_datetime") ??
        getStringProperty(item.properties, "datetime") ??
        null;
      const endDt =
        getStringProperty(item.properties, "end_datetime") ??
        getStringProperty(item.properties, "datetime") ??
        null;
      if (startDt != null || endDt != null) {
        variantEntry.temporalExtent = {
          start: startDt ?? null,
          end: endDt ?? null,
        };
      }

      datasetMap.get(itemDataset)!.variants.push(variantEntry);
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
