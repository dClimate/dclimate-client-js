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
  StacReleaseMetadata,
  StacZarrResolution,
} from "./stac-catalog.js";
import {
  getStacReleaseMetadata,
  getStacZarrResolutions,
  getStringProperty,
} from "./stac-catalog.js";

export const DEFAULT_STAC_SERVER_URL = "https://api.stac.dclimate.net";

export interface StacServerSearchResponse {
  type: "FeatureCollection";
  features: StacServerItem[];
  numberMatched?: number;
  numberReturned?: number;
  links?: Array<{
    rel: string;
    href: string;
    method?: string;
    headers?: Record<string, string | string[]>;
    body?: Record<string, unknown>;
    merge?: boolean;
  }>;
}

export interface StacServerItem {
  type: "Feature";
  id: string;
  collection?: string;
  properties: Record<string, unknown>;
  assets: Record<
    string,
    { href: string; type?: string; title?: string; [key: string]: unknown }
  >;
}

export interface ResolvedCidFromServer extends StacReleaseMetadata {
  cid: string;
  collectionId: string;
  dataset: string;
  variant: string;
  zarrResolutions: StacZarrResolution[];
}

const MAX_STAC_SEARCH_PAGES = 50;

type StacSearchBody = Record<string, unknown> | undefined;
type StacSearchHeaders = Record<string, string>;

interface StacSearchPage<T> {
  features?: T[];
  links?: unknown;
}

interface StacSearchRequest {
  url: string;
  method: "GET" | "POST";
  body: StacSearchBody;
  headers: StacSearchHeaders;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringHeaders(value: unknown): StacSearchHeaders {
  if (!isRecord(value)) return {};

  const headers: StacSearchHeaders = {};
  for (const [name, headerValue] of Object.entries(value)) {
    if (typeof headerValue === "string") {
      headers[name] = headerValue;
    } else if (
      Array.isArray(headerValue) &&
      headerValue.every((entry) => typeof entry === "string")
    ) {
      headers[name] = headerValue.join(", ");
    }
  }
  return headers;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function resolveServerUrl(serverUrl: string): string {
  const locationHref =
    typeof globalThis.location === "undefined"
      ? undefined
      : globalThis.location.href;
  return locationHref
    ? new URL(serverUrl, locationHref).toString()
    : new URL(serverUrl).toString();
}

function normalizedOrigin(url: string): string {
  const parsed = new URL(url);
  const protocol = parsed.protocol.toLowerCase();
  const hostname = parsed.hostname.replace(/\.+$/, "").toLowerCase();
  const port =
    parsed.port || (protocol === "http:" ? "80" : protocol === "https:" ? "443" : "");
  return `${protocol}//${hostname}:${port}`;
}

function sanitizedUrl(url: URL): string {
  const sanitized = new URL(url);
  sanitized.username = "";
  sanitized.password = "";
  sanitized.search = "";
  sanitized.hash = "";
  return sanitized.toString();
}

function nextSearchRequest<T>(
  serverUrl: string,
  currentUrl: string,
  originalBody: Record<string, unknown>,
  page: StacSearchPage<T>
): StacSearchRequest | undefined {
  const links = Array.isArray(page.links) ? page.links : [];
  const nextLink = links.find(
    (link) => isRecord(link) && link.rel === "next" && Boolean(link.href)
  );
  if (!isRecord(nextLink)) return undefined;
  if (typeof nextLink.href !== "string") {
    throw new Error("STAC pagination link href must be a string");
  }

  const parsedNextUrl = new URL(nextLink.href, currentUrl);
  const nextUrl = parsedNextUrl.toString();
  if (
    normalizedOrigin(nextUrl) !== normalizedOrigin(serverUrl) ||
    parsedNextUrl.username !== "" ||
    parsedNextUrl.password !== ""
  ) {
    throw new Error(
      `STAC pagination link must use the configured server origin ${normalizedOrigin(serverUrl)}: ${sanitizedUrl(parsedNextUrl)}`
    );
  }

  const method = String(nextLink.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    throw new Error(
      `STAC pagination link uses an unsupported method: '${method}'`
    );
  }

  // Continuation headers may contain credentials. Forward them only after
  // validating an encrypted same-origin link; plaintext endpoints still
  // paginate, but without server-supplied headers.
  const headers =
    parsedNextUrl.protocol.toLowerCase() === "https:"
      ? stringHeaders(nextLink.headers)
      : {};

  let body: StacSearchBody;
  if (isRecord(nextLink.body)) {
    body = nextLink.merge
      ? { ...originalBody, ...nextLink.body }
      : nextLink.body;
  } else if (nextLink.merge) {
    body = { ...originalBody };
  } else {
    body = undefined;
  }

  return { url: nextUrl, method, body, headers };
}

function requestUrl(request: StacSearchRequest): string {
  const url = new URL(request.url);
  if (request.method === "GET" && request.body) {
    for (const [key, value] of Object.entries(request.body)) {
      url.searchParams.delete(key);
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  url.hash = "";
  return url.toString();
}

async function fetchSearchPage<T>(
  request: StacSearchRequest
): Promise<StacSearchPage<T>> {
  const response = await fetch(requestUrl(request), {
    method: request.method,
    redirect: "manual",
    headers:
      request.method === "POST"
        ? { "Content-Type": "application/json", ...request.headers }
        : request.headers,
    ...(request.method === "POST"
      ? { body: JSON.stringify(request.body ?? {}) }
      : {}),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`STAC server error ${response.status}: ${text}`);
  }
  const page = (await response.json()) as StacSearchPage<T>;
  if (!isRecord(page)) {
    throw new Error("STAC server returned an invalid search response");
  }
  if (page.features !== undefined && !Array.isArray(page.features)) {
    throw new Error("STAC server returned invalid search features");
  }
  return page;
}

async function* searchPages<T>(
  serverUrl: string,
  originalBody: Record<string, unknown>
): AsyncGenerator<StacSearchPage<T>> {
  const resolvedServerUrl = resolveServerUrl(serverUrl);
  let request: StacSearchRequest = {
    url: `${resolvedServerUrl.replace(/\/+$/, "")}/search`,
    method: "POST",
    body: originalBody,
    headers: {},
  };
  const seen = new Set<string>();

  for (let pageNumber = 0; pageNumber < MAX_STAC_SEARCH_PAGES; pageNumber++) {
    const pageKey = [
      request.method,
      requestUrl(request),
      stableJson(
        request.method === "POST" ? (request.body ?? {}) : undefined
      ),
      stableJson(request.headers),
    ].join("\n");
    if (seen.has(pageKey)) {
      throw new Error(
        "STAC server pagination repeated a request; results truncated"
      );
    }
    seen.add(pageKey);

    const page = await fetchSearchPage<T>(request);
    yield page;

    const nextRequest = nextSearchRequest(
      resolvedServerUrl,
      request.url,
      originalBody,
      page
    );
    if (!nextRequest) return;
    request = nextRequest;
  }

  throw new Error(
    `STAC server pagination exceeded ${MAX_STAC_SEARCH_PAGES} pages; results truncated`
  );
}

function datasetIdFromItemId(
  itemId: string,
  collection: string
): string | undefined {
  const prefix = `${collection}-`;
  const remainder = itemId.startsWith(prefix) ? itemId.slice(prefix.length) : itemId;
  const [dataset] = remainder.split("-");
  return dataset || undefined;
}

function featureMatchesDataset(
  feature: StacServerItem,
  collection: string,
  dataset: string
): boolean {
  if (feature.collection && feature.collection !== collection) {
    return false;
  }

  const datasetId = getStringProperty(feature.properties, "dclimate:dataset_id");
  if (datasetId) {
    return datasetId === dataset;
  }

  return datasetIdFromItemId(feature.id, collection) === dataset;
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

  const features: StacServerItem[] = [];
  for await (const page of searchPages<StacServerItem>(serverUrl, body)) {
    features.push(...(page.features ?? []));
  }

  // Filter to the exact dataset. A prefix match would conflate datasets such
  // as precipitation_total and precipitation_total_land.
  const matches = features.filter((f) =>
    featureMatchesDataset(f, collection, dataset)
  );

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
  const zarrResolutions = getStacZarrResolutions(selectedItem.assets);
  const dataAsset =
    selectedItem.assets?.data ??
    (zarrResolutions[0]
      ? selectedItem.assets[zarrResolutions[0].assetKey]
      : undefined);
  const href = dataAsset?.href || "";
  const advertisedCid = getStringProperty(
    selectedItem.properties,
    "dclimate:latest_dataset_cid"
  );
  const rawCid = href || advertisedCid || "";
  if (!rawCid) {
    throw new Error(`Item '${selectedItem.id}' has no data asset`);
  }

  const cid = rawCid.startsWith("ipfs://")
    ? rawCid.replace("ipfs://", "")
    : rawCid;

  return {
    cid,
    collectionId: collection,
    dataset,
    variant: resolvedVariant,
    zarrResolutions,
    ...getStacReleaseMetadata(selectedItem.properties),
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
 *   - Search pagination is bounded and repeated requests are detected to avoid
 *     looping on malformed `next` links.
 */
/**
 * Fetch every page of `/collections`.
 *
 * The endpoint paginates and defaults to a page size smaller than the number of
 * collections published, so a single unpaged request silently returns a prefix:
 * `numberMatched` exceeds `numberReturned` and the tail is simply absent. That
 * is invisible at the call site -- the response is a well-formed list, just a
 * short one -- and the collections it drops lose the title and organization
 * this endpoint is the only source of, leaving them to fall back to whatever the
 * item search alone can say.
 *
 * Follows `rel="next"` rather than passing a large `limit`, because a limit only
 * moves the cliff: it is a guess about how many collections will exist later,
 * and the day the catalogue outgrows it the truncation returns silently. The
 * link is what the server itself says comes next.
 *
 * Shares `MAX_STAC_SEARCH_PAGES` and the repeat-detection of the item search
 * above: a server that returns a `next` pointing at the page just fetched would
 * otherwise spin forever.
 */
async function fetchAllCollections(
  resolvedServerUrl: string
): Promise<StacServerCollectionsResponse> {
  const collections: StacServerCollectionsResponse["collections"] = [];
  const seen = new Set<string>();
  let url: string | undefined = `${resolvedServerUrl.replace(
    /\/+$/,
    ""
  )}/collections`;

  for (let page = 0; page < MAX_STAC_SEARCH_PAGES; page++) {
    if (!url) break;
    if (seen.has(url)) {
      throw new Error(
        "STAC server /collections pagination repeated a request; results truncated"
      );
    }
    seen.add(url);

    const response: Response = await fetch(url, { redirect: "manual" });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `STAC server /collections error ${response.status}: ${text}`
      );
    }
    const body = (await response.json()) as StacServerCollectionsResponse & {
      links?: Array<{ rel?: string; href?: string }>;
    };
    collections.push(...(body.collections ?? []));

    const next = body.links?.find((link) => link.rel === "next")?.href;
    // Resolved against the current page so a relative `next` works, and dropped
    // if it points at another origin -- following that would be an open redirect
    // out of the configured server.
    url = next ? new URL(next, url).toString() : undefined;
    if (url && new URL(url).origin !== new URL(resolvedServerUrl).origin) {
      url = undefined;
    }
  }

  return { collections };
}

export async function listAvailableDatasetsFromStacServer(
  serverUrl: string = DEFAULT_STAC_SERVER_URL
): Promise<DatasetCatalog> {
  const resolvedServerUrl = resolveServerUrl(serverUrl);
  const searchFeaturesPromise = (async () => {
    const features: StacServerSearchFeature[] = [];
    for await (const page of searchPages<StacServerSearchFeature>(
      resolvedServerUrl,
      { limit: 100 }
    )) {
      features.push(...(page.features ?? []));
    }
    return features;
  })();
  const [collectionsBody, searchFeatures] = await Promise.all([
    fetchAllCollections(resolvedServerUrl),
    searchFeaturesPromise,
  ]);

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

  for (const feature of searchFeatures) {
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
