/**
 * STAC Server client for fast CID resolution.
 *
 * This module provides direct access to a STAC server API for resolving dataset CIDs,
 * which is faster than traversing the IPFS-hosted catalog structure.
 */

import type {
  CatalogCollection,
  CatalogDataset,
  DatasetCatalog,
  DatasetVariantConfig,
} from "./stac-catalog.js";
import { getStringProperty } from "./stac-catalog.js";

export const DEFAULT_STAC_SERVER_URL = "https://api.stac.dclimate.net";

export interface StacServerSearchResponse {
  type: "FeatureCollection";
  features: StacServerItem[];
  numberMatched?: number;
  numberReturned?: number;
}

export interface StacServerItem {
  type: "Feature";
  id: string;
  collection?: string;
  properties: Record<string, unknown>;
  assets: Record<string, { href: string; type?: string; title?: string }>;
}

export interface ResolvedCidFromServer {
  cid: string;
  collectionId: string;
  dataset: string;
  variant: string;
}

/**
 * Resolve dataset CID via STAC server /search API.
 *
 * Uses the same API format as the frontend (POST /search with collections filter).
 *
 * @param collection - Collection ID (e.g., 'ecmwf_aifs', 'ecmwf_era5')
 * @param dataset - Dataset name (e.g., 'temperature', 'precipitation')
 * @param variant - Optional variant name (e.g., 'ensemble', 'deterministic')
 * @param serverUrl - STAC server base URL
 * @returns The resolved CID and metadata
 * @throws Error if dataset or variant is not found, or if server request fails
 */
export async function resolveCidFromStacServer(
  collection: string,
  dataset: string,
  variant?: string,
  serverUrl: string = DEFAULT_STAC_SERVER_URL
): Promise<ResolvedCidFromServer> {
  // Search by collection
  const body = {
    limit: 100,
    collections: [collection],
  };

  const response = await fetch(`${serverUrl}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`STAC server error ${response.status}: ${text}`);
  }

  const data: StacServerSearchResponse = await response.json();
  const features = data.features || [];

  // Filter to matching dataset (item ID pattern: {collection}-{dataset}-{variant})
  const prefix = `${collection}-${dataset}`;
  const matches = features.filter((f) => f.id.startsWith(prefix));

  if (matches.length === 0) {
    throw new Error(`No items found for ${collection}/${dataset}`);
  }

  // Select by variant or use default preference
  let selectedItem: StacServerItem | undefined;
  let resolvedVariant: string;

  if (variant) {
    selectedItem = matches.find(
      (f) => getStringProperty(f.properties, "dclimate:variant") === variant
    );
    if (!selectedItem) {
      throw new Error(
        `Variant '${variant}' not found for ${collection}/${dataset}`
      );
    }
    resolvedVariant = variant;
  } else {
    // Prefer: default > final > finalized > latest > first match
    selectedItem = matches[0];
    resolvedVariant =
      getStringProperty(matches[0].properties, "dclimate:variant") ?? "default";

    const preferredOrder = ["default", "final", "finalized", "latest"];
    for (const preferred of preferredOrder) {
      const found = matches.find(
        (f) => getStringProperty(f.properties, "dclimate:variant") === preferred
      );
      if (found) {
        selectedItem = found;
        resolvedVariant = preferred;
        break;
      }
    }
  }

  // Extract CID from asset
  const href = selectedItem.assets?.data?.href || "";
  if (!href) {
    throw new Error(`Item '${selectedItem.id}' has no data asset`);
  }

  const cid = href.startsWith("ipfs://") ? href.replace("ipfs://", "") : href;

  return {
    cid,
    collectionId: collection,
    dataset,
    variant: resolvedVariant,
  };
}

/**
 * Simple function to just get the CID string.
 */
export async function resolveDatasetCidFromStacServer(
  collection: string,
  dataset: string,
  variant?: string,
  serverUrl: string = DEFAULT_STAC_SERVER_URL
): Promise<string> {
  const result = await resolveCidFromStacServer(
    collection,
    dataset,
    variant,
    serverUrl
  );
  return result.cid;
}

interface StacServerCollectionsResponse {
  collections: Array<{
    id: string;
    title?: string;
    extent?: unknown;
  }>;
}

interface StacServerSearchFeature {
  id: string;
  collection?: string;
  bbox?: number[];
  properties: Record<string, unknown>;
}

interface StacServerSearchPage {
  features: StacServerSearchFeature[];
}

function stripIpfsScheme(cid: string | undefined): string | undefined {
  if (!cid) return undefined;
  return cid.startsWith("ipfs://") ? cid.replace(/^ipfs:\/\//, "") : cid;
}

/**
 * List all datasets/variants by querying a STAC API server directly.
 *
 * This is the fast path that mirrors `listAvailableDatasetsFromStac` (the IPFS
 * walker) without traversing the IPFS-hosted catalog tree. Two requests:
 *   1. GET  /collections  — collection ids, titles
 *   2. POST /search       — items, with dataset/variant/CID in properties
 *
 * Returns the same {@link DatasetCatalog} shape as the IPFS walker so callers
 * don't need to know which path produced it.
 *
 * Notes:
 *   - Organization is derived from the `{org}_{name}` collection-id convention
 *     (e.g. `noaa_aigfs` → org=`noaa`). The IPFS walker reads it from a
 *     `dclimate:id` field on an org-level link; the STAC API doesn't expose
 *     organizations as first-class entities.
 *   - Category (historical/forecast) isn't populated here — the IPFS walker
 *     pulls it from `dclimate:collections:<category>` on the org link, which
 *     has no STAC API equivalent.
 *   - The fixed `limit: 1000` covers today's catalog (~45 items) by a wide
 *     margin. If the catalog grows past that, switch to following the
 *     STAC `next` link instead of a single request.
 */
export async function listAvailableDatasetsFromStacServer(
  serverUrl: string = DEFAULT_STAC_SERVER_URL
): Promise<DatasetCatalog> {
  const [collectionsResp, searchResp] = await Promise.all([
    fetch(`${serverUrl}/collections`),
    fetch(`${serverUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 1000 }),
    }),
  ]);

  if (!collectionsResp.ok) {
    const text = await collectionsResp.text();
    throw new Error(
      `STAC server /collections error ${collectionsResp.status}: ${text}`
    );
  }
  if (!searchResp.ok) {
    const text = await searchResp.text();
    throw new Error(
      `STAC server /search error ${searchResp.status}: ${text}`
    );
  }

  const collectionsBody = (await collectionsResp.json()) as StacServerCollectionsResponse;
  const searchBody = (await searchResp.json()) as StacServerSearchPage;

  interface CollectionAccumulator {
    title?: string;
    organization?: string;
    // Categories seen across items in this collection. Used to roll up to a
    // single `category` value on the output — see the unanimity check below.
    observations: Set<string>;
    datasets: Map<string, Map<string, DatasetVariantConfig>>;
  }

  const accumulators = new Map<string, CollectionAccumulator>();

  for (const coll of collectionsBody.collections ?? []) {
    const organization = coll.id.includes("_") ? coll.id.split("_")[0] : undefined;
    accumulators.set(coll.id, {
      title: coll.title,
      organization,
      observations: new Set(),
      datasets: new Map(),
    });
  }

  for (const feature of searchBody.features ?? []) {
    const collectionId =
      feature.collection ??
      (feature.id.includes("-") ? feature.id.split("-")[0] : undefined);
    if (!collectionId) continue;

    let entry = accumulators.get(collectionId);
    if (!entry) {
      entry = {
        organization: collectionId.includes("_") ? collectionId.split("_")[0] : undefined,
        observations: new Set(),
        datasets: new Map(),
      };
      accumulators.set(collectionId, entry);
    }

    const props = feature.properties ?? {};
    const observation = props["dclimate:observation"];
    if (typeof observation === "string" && observation.length > 0) {
      entry.observations.add(observation);
    }
    // Prefer the explicit property fields; fall back to id-parsing for items
    // that pre-date the dclimate:* property convention.
    const idParts = feature.id.split("-");
    const datasetName =
      getStringProperty(props, "dclimate:dataset_id") ??
      (idParts.length >= 2 ? idParts[1] : undefined);
    const variantName =
      getStringProperty(props, "dclimate:variant") ??
      (idParts.length >= 3 ? idParts.slice(2).join("-") : "default");
    if (!datasetName) continue;

    const cid = stripIpfsScheme(
      getStringProperty(props, "dclimate:latest_dataset_cid")
    );

    const variantConfig: DatasetVariantConfig = { variant: variantName };
    if (cid) variantConfig.cid = cid;

    const bbox = feature.bbox;
    if (Array.isArray(bbox) && bbox.length >= 4) {
      variantConfig.spatialExtent = {
        bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
      };
    }

    const startDt =
      getStringProperty(props, "start_datetime") ??
      getStringProperty(props, "datetime") ??
      null;
    const endDt =
      getStringProperty(props, "end_datetime") ??
      getStringProperty(props, "datetime") ??
      null;
    if (startDt !== null || endDt !== null) {
      variantConfig.temporalExtent = { start: startDt, end: endDt };
    }

    let datasetVariants = entry.datasets.get(datasetName);
    if (!datasetVariants) {
      datasetVariants = new Map();
      entry.datasets.set(datasetName, datasetVariants);
    }
    datasetVariants.set(variantName, variantConfig);
  }

  const result: DatasetCatalog = [];
  for (const [collectionId, entry] of accumulators) {
    if (entry.datasets.size === 0) continue;
    const datasets: CatalogDataset[] = [];
    for (const [datasetName, variants] of entry.datasets) {
      datasets.push({ dataset: datasetName, variants: [...variants.values()] });
    }
    const collection: CatalogCollection = {
      collection: collectionId,
      datasets,
    };
    if (entry.organization) collection.organization = entry.organization;
    if (entry.title) collection.title = entry.title;
    // Only roll up to a collection-level category when every item in the
    // collection agrees. Mixed observations would be a meaningful ambiguity
    // — leave undefined and let callers handle it rather than picking a
    // misleading value.
    if (entry.observations.size === 1) {
      collection.category = [...entry.observations][0];
    }
    result.push(collection);
  }
  return result;
}
