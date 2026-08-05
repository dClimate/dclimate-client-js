import { createIpfsElements, Dataset } from "@dclimate/jaxray";
import { GeoTemporalDataset } from "./geotemporal-dataset.js";
import {
  ClientOptions,
  DatasetMetadata,
  DatasetRequest,
  DatasetVersionsRequest,
  GeoSelectionOptions,
  LoadDatasetOptions,
} from "./types.js";
import { DEFAULT_IPFS_GATEWAY } from "./constants.js";
import { openDatasetFromCid, IpfsElements } from "./ipfs/open-dataset.js";
import {
  DatasetNotFoundError,
  SirenNotConfiguredError,
  VersionHistoryUnavailableError,
} from "./errors.js";
import { normalizeSegment } from "./utils.js";

import { concatenateVariants, type VariantToLoad } from "./actions/concatenate-variants.js";
import {
  loadStacCatalog,
  resolveDatasetFromStac,
  getConcatenableItemsFromStac,
  listAvailableDatasetsFromStac,
  type StacCatalog,
  type ConcatenableStacItem,
  type ResolvedDatasetFromStac,
} from "./stac/index.js";
import { DatasetCatalog } from "./stac/stac-catalog.js";
import {
  resolveCidFromStacServer,
  listAvailableDatasetsFromStacServer,
  DEFAULT_STAC_SERVER_URL,
} from "./stac/stac-server.js";
import { SirenClient } from "./siren/siren-client.js";
import { listVersionsFromUrl } from "./versions/version-client.js";
import type { DatasetVersionListing } from "./versions/types.js";

function normalizeZarrGroup(group?: string): string | undefined {
  const normalized = group?.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized || undefined;
}

export class DClimateClient {
  private gatewayUrl: string;
  private stacServerUrl: string | null;
  private rootCid?: string;
  private cachedGateway?: string;
  private cachedIpfs?: IpfsElements;
  private clientIpfsElements?: IpfsElements;
  private stacCatalog?: StacCatalog;
  private stacCatalogTimestamp?: number;
  private stacCacheTtl: number = 3600000; // 1 hour
  private sirenClient?: SirenClient;

  constructor(options: ClientOptions = {}) {
    this.gatewayUrl = options.gatewayUrl ?? DEFAULT_IPFS_GATEWAY;
    this.rootCid = options.rootCid;
    this.clientIpfsElements = options.ipfsElements;
    // stacServerUrl: use provided value, or default if undefined, or null to
    // disable. A pinned rootCid also disables the server path — the server
    // only serves the latest catalog, so consulting it would silently bypass
    // the pinned version (and contact public infrastructure).
    this.stacServerUrl =
      options.stacServerUrl === null || options.rootCid
        ? null
        : options.stacServerUrl ?? DEFAULT_STAC_SERVER_URL;

    if (options.siren) {
      this.sirenClient = new SirenClient(options.siren);
    }
  }

  private async getStacCatalog(gatewayUrl: string): Promise<StacCatalog> {
    // Caching (per-gateway key + TTL) lives in loadStacCatalog's module
    // cache; a second client-level cache only added double-TTL staleness.
    return loadStacCatalog(gatewayUrl, this.rootCid);
  }

  async listAvailableDatasets(): Promise<DatasetCatalog> {
    // STAC API first — single-digit HTTP calls vs. hundreds of serial IPFS
    // gateway round-trips. Falls through to the IPFS walk only if the server
    // is unavailable or misconfigured. Mirrors the resolve-CID pattern below.
    if (this.stacServerUrl) {
      try {
        return await listAvailableDatasetsFromStacServer(this.stacServerUrl);
      } catch {
        // Fall through to IPFS catalog.
      }
    }
    const catalog = await this.getStacCatalog(this.gatewayUrl);
    return listAvailableDatasetsFromStac(catalog);
  }

  async listCatalogEntries(): Promise<DatasetCatalog> {
    return this.listAvailableDatasets();
  }

  private async resolveDatasetDetails(
    request: DatasetRequest,
    gatewayUrl: string = this.gatewayUrl
  ): Promise<ResolvedDatasetFromStac> {
    if (!request.collection || !request.dataset) {
      throw new DatasetNotFoundError(
        "Collection and dataset names must be provided."
      );
    }

    const collection =
      request.organization &&
      !request.collection.startsWith(`${request.organization}_`)
        ? `${request.organization}_${request.collection}`
        : request.collection;

    if (this.stacServerUrl) {
      try {
        const resolved = await resolveCidFromStacServer(
          collection,
          request.dataset,
          request.variant,
          this.stacServerUrl
        );
        return {
          ...resolved,
          organizationId:
            request.organization ??
            (resolved.collectionId.includes("_")
              ? resolved.collectionId.split("_")[0]
              : undefined),
        };
      } catch {
        // Fall through to the IPFS-hosted STAC catalog.
      }
    }

    const catalog = await this.getStacCatalog(gatewayUrl);
    return resolveDatasetFromStac(
      catalog,
      collection,
      request.dataset,
      request.variant,
      request.organization
    );
  }

  async listDatasetVersions({
    collection,
    dataset,
    variant,
    organization,
    filters,
  }: DatasetVersionsRequest): Promise<DatasetVersionListing> {
    const resolved = await this.resolveDatasetDetails({
      collection,
      dataset,
      variant,
      organization,
    });
    if (!resolved.versionsApi) {
      throw new VersionHistoryUnavailableError(
        `Version history is not available for ${collection}/${dataset}/${resolved.variant}.`
      );
    }
    return listVersionsFromUrl(resolved.versionsApi, filters);
  }

  /**
   * Access the Siren REST API client (metric data, regions, metrics).
   * Namespaced so Siren stays separate from the core dataset API:
   *   `client.siren.getMetricData(...)`, `client.siren.listRegions()`, etc.
   * Requires `siren` to be configured in ClientOptions; throws otherwise.
   */
  get siren(): SirenClient {
    if (!this.sirenClient) {
      throw new SirenNotConfiguredError(
        "Siren is not configured. Pass a `siren` option to the DClimateClient constructor."
      );
    }
    return this.sirenClient;
  }

  async loadDataset({
    request,
    options = {
      returnJaxrayDataset: false,
      autoConcatenate: false,
    },
  }: {
    request: DatasetRequest;
    options?: LoadDatasetOptions;
  }): Promise<[GeoTemporalDataset, DatasetMetadata] | [Dataset, DatasetMetadata]> {
    const gatewayUrl = options.gatewayUrl ?? this.gatewayUrl;
    const ipfsElements = this.resolveIpfsElements(options, gatewayUrl);
    const zarrGroup = normalizeZarrGroup(options.zarrGroup);


    if (request.cid) {
      // Direct CID provided - bypass catalog
      const dataset = await openDatasetFromCid(request.cid, {
        gatewayUrl,
        ipfsElements,
        zarrGroup,
        shardReadMode: options.shardReadMode,
      });

      const metadata: DatasetMetadata = {
        dataset: "",
        collection: "",
        variant: "",
        organization: "",
        source: "direct_cid",
        path: "",
        cid: request.cid,
        fetchedAt: new Date(),
        ...(zarrGroup ? { zarrGroup } : {}),
      };
    if (options.returnJaxrayDataset) {
      return [dataset, metadata];
    }

    return [new GeoTemporalDataset(dataset, metadata), metadata];
    }
    if (!request.dataset) {
      throw new DatasetNotFoundError("Dataset name must be provided.");
    }

    const normalizedDatasetKey = normalizeSegment(request.dataset);
    const autoConcatenate = options.autoConcatenate;
    const resolvedOrganization = request.organization;
    let resolvedCollection = request.collection;

    if (
      resolvedOrganization &&
      resolvedCollection &&
      !resolvedCollection.startsWith(`${resolvedOrganization}_`)
    ) {
      resolvedCollection = `${resolvedOrganization}_${resolvedCollection}`;
    }

    if (!normalizedDatasetKey) {
      throw new DatasetNotFoundError("Dataset name must be provided.");
    }

    // Skip auto-concatenation if variant is provided
    if (!request.variant && autoConcatenate) {
      // Load STAC catalog to check for concatenable variants
      const catalog = await this.getStacCatalog(gatewayUrl);

      // Get all items for this collection/dataset
      const concatenableItems = getConcatenableItemsFromStac(
        catalog,
        resolvedCollection || "",
        request.dataset,
        resolvedOrganization
      );

      if (concatenableItems.length > 1) {
        const resolvedInfo = resolveDatasetFromStac(
          catalog,
          resolvedCollection || request.collection || "",
          request.dataset,
          concatenableItems[0].variant,
          resolvedOrganization
        );
        const resolvedOrganizationId =
          resolvedInfo.organizationId ?? resolvedOrganization;

        // Multiple variants with concat metadata found
        // Load and concatenate based on dclimate:concatPriority
        return this.loadAndConcatenateVariants(
          {
            ...request,
            collection: resolvedInfo.collectionId,
            organization: resolvedOrganizationId,
            variant: request.variant,
          },
          concatenableItems,
          options
        );
      }

      // Single item found - proceed with single variant loading below
      // If no items found, will error in resolution step
    }

    // Fall back to single variant loading
    const resolved = await this.resolveDatasetDetails(
      {
        ...request,
        collection: resolvedCollection || request.collection,
        organization: resolvedOrganization,
      },
      gatewayUrl
    );
    const cid = resolved.cid;
    const metadataDataset = resolved.dataset;
    const metadataCollection = resolved.collectionId;
    const metadataVariant = resolved.variant || "";
    const metadataOrganization =
      resolved.organizationId ?? resolvedOrganization;

    // Build path from resolved names
    const pathParts = [metadataCollection, metadataDataset, metadataVariant].filter(Boolean);
    const resolvedPath = pathParts.join("-");
    
    const dataset = await openDatasetFromCid(cid, {
      gatewayUrl,
      ipfsElements,
      zarrGroup,
      shardReadMode: options.shardReadMode,
    });

    const metadata: DatasetMetadata = {
      dataset: metadataDataset,
      collection: metadataCollection,
      variant: metadataVariant,
      organization: metadataOrganization,
      path: resolvedPath,
      cid: cid,
      source: "stac",
      fetchedAt: new Date(),
      ...(resolved.versionsApi ? { versionsApi: resolved.versionsApi } : {}),
      ...(resolved.provenanceApi
        ? { provenanceApi: resolved.provenanceApi }
        : {}),
      ...(resolved.citationApi ? { citationApi: resolved.citationApi } : {}),
      ...(resolved.streamId ? { streamId: resolved.streamId } : {}),
      ...(resolved.commitId ? { commitId: resolved.commitId } : {}),
      ...(resolved.versionLabel ? { versionLabel: resolved.versionLabel } : {}),
      ...(resolved.isCitable !== undefined
        ? { isCitable: resolved.isCitable }
        : {}),
      ...(resolved.retentionClass
        ? { retentionClass: resolved.retentionClass }
        : {}),
      ...(zarrGroup ? { zarrGroup } : {}),
    };

    if (!metadata.organization && metadata.collection?.includes("_")) {
      metadata.organization = metadata.collection.split("_")[0];
    }

    if (options.returnJaxrayDataset) {
      return [dataset, metadata];
    }

    return [new GeoTemporalDataset(dataset, metadata), metadata];
  }

  async selectDataset({
    request,
    selection,
    options = {
      returnJaxrayDataset: false,
    },
  }: {
    request: DatasetRequest;
    selection: GeoSelectionOptions;
    options?: LoadDatasetOptions;
  }): Promise<[GeoTemporalDataset, DatasetMetadata] | [Dataset, DatasetMetadata]> {
    const [dataset, metadata] = await this.loadDataset({ request, options });
    if (!(dataset instanceof GeoTemporalDataset)) {
      return [dataset, metadata];
    }
    return [await dataset.select(selection), metadata];
  }

  private async loadAndConcatenateVariants(
    request: DatasetRequest,
    concatVariants: ConcatenableStacItem[],
    options: LoadDatasetOptions
  ): Promise<[GeoTemporalDataset, DatasetMetadata] | [Dataset, DatasetMetadata]> {
    if (!request.dataset) {
      throw new DatasetNotFoundError("Dataset name must be provided.");
    }
    const gatewayUrl = options.gatewayUrl ?? this.gatewayUrl;
    const ipfsElements = this.resolveIpfsElements(options, gatewayUrl);
    const zarrGroup = normalizeZarrGroup(options.zarrGroup);

    // Order by concatPriority so metadata (concatenatedVariants, cid)
    // reflects the same order the data is concatenated in.
    const orderedVariants = [...concatVariants].sort(
      (a, b) => a.concatPriority - b.concatPriority
    );

    // Load all variants in parallel
    const variantsToLoad: VariantToLoad[] = await Promise.all(
      orderedVariants.map(async (variantConfig) => {
        // Load the dataset using the CID from STAC
        const dataset = await openDatasetFromCid(variantConfig.cid, {
          gatewayUrl,
          ipfsElements,
          zarrGroup,
          shardReadMode: options.shardReadMode,
        });

        return {
          variant: variantConfig,
          dataset,
        };
      })
    );

    // Concatenate the variants
    const concatenatedDataset = await concatenateVariants(variantsToLoad);

    // Build metadata for the concatenated dataset
    const pathParts = [request.collection, request.dataset].filter(Boolean);
    const metadata: DatasetMetadata = {
      dataset: request.dataset,
      collection: request.collection,
      organization: request.organization,
      concatenatedVariants: orderedVariants.map((v) => v.variant),
      concatDimension: orderedVariants[0].concatDimension,
      path: pathParts.join("-"),
      cid: variantsToLoad[0].dataset.attrs._zarr_cid as string || "concatenated",
      source: "stac_concatenated",
      fetchedAt: new Date(),
      ...(zarrGroup ? { zarrGroup } : {}),
    };

    if (options.returnJaxrayDataset) {
      return [concatenatedDataset, metadata];
    }

    return [new GeoTemporalDataset(concatenatedDataset, metadata), metadata];
  }

  private resolveIpfsElements(
    options: LoadDatasetOptions,
    gatewayUrl: string
  ): IpfsElements {
    // Priority: options.ipfsElements > clientIpfsElements > create from gatewayUrl
    if (options.ipfsElements) {
      return options.ipfsElements;
    }
    if (this.clientIpfsElements) {
      return this.clientIpfsElements;
    }
    // Cache ipfsElements based on gateway URL
    if (this.cachedIpfs && this.cachedGateway === gatewayUrl) {
      return this.cachedIpfs;
    }
    this.cachedGateway = gatewayUrl;
    this.cachedIpfs = createIpfsElements(gatewayUrl);
    return this.cachedIpfs;
  }
}
