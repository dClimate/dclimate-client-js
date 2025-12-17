/**
 * STAC Server client for fast CID resolution.
 *
 * This module provides direct access to a STAC server API for resolving dataset CIDs,
 * which is faster than traversing the IPFS-hosted catalog structure.
 */

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
  properties: Record<string, any>;
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
      (f) => f.properties["dclimate:variant"] === variant
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
    resolvedVariant = matches[0].properties["dclimate:variant"] || "default";

    const preferredOrder = ["default", "final", "finalized", "latest"];
    for (const preferred of preferredOrder) {
      const found = matches.find(
        (f) => f.properties["dclimate:variant"] === preferred
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
