import { createIpfsElements, Dataset } from "@dclimate/jaxray";
import { GeoTemporalDataset } from "./geotemporal-dataset.js";
import {
  ClientOptions,
  DatasetMetadata,
  DatasetRequest,
  DatasetVersionRequest,
  DatasetVersionsRequest,
  EntityDatasetRequest,
  GeoSelectionOptions,
  LoadDatasetOptions,
  LoadEntitiesOptions,
} from "./types.js";
import { DEFAULT_IPFS_GATEWAY, ENTITY_DATASET_LAYOUT } from "./constants.js";
// Type-only, like `TableField` in types.ts: naming `EntityDataset` as a return
// type must not statically pull tabular's reader into every consumer's bundle,
// which is the whole reason `entities.load` imports it dynamically.
import type { EntityDataset, TableField } from "@dclimate/tabular/reader";
import { openDatasetFromCid, IpfsElements } from "./ipfs/open-dataset.js";
import {
  DatasetNotFoundError,
  ConflictingResolutionSelectionError,
  MultiresolutionSelectionRequiredError,
  ResolutionNotAvailableError,
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
  type StacZarrResolution,
} from "./stac/index.js";
import { DatasetCatalog } from "./stac/stac-catalog.js";
import {
  resolveCidFromStacServer,
  listAvailableDatasetsFromStacServer,
  DEFAULT_STAC_SERVER_URL,
} from "./stac/stac-server.js";
import { SirenClient } from "./siren/siren-client.js";
import { EntitiesClient } from "./entities/entities-client.js";
import {
  getExactVersionFromUrl,
  listVersionsFromUrl,
} from "./versions/version-client.js";
import type {
  DatasetVersion,
  DatasetVersionListing,
} from "./versions/types.js";

function normalizeZarrGroup(group?: string): string | undefined {
  const normalized = group?.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized || undefined;
}

function resolveZarrSelection(
  choices: StacZarrResolution[],
  resolution?: string,
  zarrGroup?: string
): { zarrGroup?: string; resolution?: string } {
  if (resolution && zarrGroup) {
    throw new ConflictingResolutionSelectionError(
      "Pass either request.resolution or options.zarrGroup, not both."
    );
  }
  if (resolution) {
    const match = choices.find((choice) => choice.resolution === resolution);
    if (!match) {
      const available = choices.map((choice) => choice.resolution);
      throw new ResolutionNotAvailableError(
        `Resolution '${resolution}' is not available.` +
          (available.length ? ` Choose one of: ${available.join(", ")}.` : "")
      );
    }
    return { zarrGroup: match.group, resolution: match.resolution };
  }
  if (zarrGroup) {
    const normalized = normalizeZarrGroup(zarrGroup);
    const match = choices.find((choice) => choice.group === normalized);
    if (choices.length && !match) {
      throw new ResolutionNotAvailableError(
        `Zarr group '${normalized}' is not available. Choose one of: ${choices
          .map((choice) => choice.group)
          .join(", ")}.`
      );
    }
    return { zarrGroup: normalized, resolution: match?.resolution };
  }
  if (choices.length > 1) {
    throw new MultiresolutionSelectionRequiredError(
      `This dataset has multiple resolutions; pass request.resolution or options.zarrGroup. Available resolutions: ${choices
        .map((choice) => choice.resolution)
        .join(", ")}.`,
      choices.map((choice) => choice.resolution),
      choices.map((choice) => choice.group)
    );
  }
  if (choices.length === 1) {
    return { zarrGroup: choices[0].group, resolution: choices[0].resolution };
  }
  return {};
}

/**
 * Published column names are upper case across this catalog's entity datasets
 * while their schema fields are lower case (`tmax` stored, `TMAX` published).
 * Hoisted to module scope rather than inlined so every call shares one function
 * identity -- the reader keys nothing on it today, but a per-call closure would
 * be a needless difference if it ever did.
 */
const defaultEntityColumnKey = (field: TableField): string =>
  field.name.toUpperCase();

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
  private entitiesClient?: EntitiesClient;

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

  async getDatasetVersion({
    collection,
    dataset,
    commitId,
    variant,
    organization,
  }: DatasetVersionRequest): Promise<DatasetVersion> {
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
    return getExactVersionFromUrl(resolved.versionsApi, commitId);
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

  /**
   * Access entity (point-observation) datasets -- weather stations, buoys:
   *   `client.entities.load({ cid })`
   *
   * Unlike `client.siren`, this needs no configuration -- it reads over the
   * client's own IPFS gateway -- so it is constructed on first use rather than
   * requiring an option and throwing when absent.
   */
  get entities(): EntitiesClient {
    if (!this.entitiesClient) {
      this.entitiesClient = new EntitiesClient({ gatewayUrl: this.gatewayUrl });
    }
    return this.entitiesClient;
  }

  /**
   * Open an entity (point-observation) dataset by catalog name.
   *
   * The entity counterpart to `loadDataset`, and deliberately a separate method
   * rather than a layout branch inside it. The two return different types with
   * different query surfaces -- `EntityDataset` has no `point()`, its `nearest()`
   * is async and can find nothing -- so folding them together would widen
   * `loadDataset`'s return to a union and make every existing gridded caller
   * narrow before it could call a Zarr method. Callers know which kind they
   * want; the entry point says so.
   *
   * Resolution is the same STAC lookup `loadDataset` performs, so a dataset is
   * addressed the same way here as anywhere else in the library, and the release
   * metadata comes back alongside it. That matters more for entity data than for
   * gridded: `commitId` and `streamId` identify the exact snapshot a query ran
   * against, which is what lets a caller re-resolve it later rather than
   * silently getting whatever is newest.
   *
   * @throws {DatasetNotFoundError} if the resolved item is not tabular -- a
   * gridded collection named here is a caller mistake worth reporting in terms
   * of the fix, not a manifest parse failure deep inside the reader.
   */
  async loadEntities({
    request,
    options = {},
  }: {
    request: EntityDatasetRequest;
    options?: LoadEntitiesOptions;
  }): Promise<[EntityDataset, DatasetMetadata]> {
    const gatewayUrl = options.gatewayUrl ?? this.gatewayUrl;

    const resolved = await this.resolveDatasetDetails(
      {
        collection: request.collection,
        dataset: request.dataset,
        ...(request.variant ? { variant: request.variant } : {}),
        ...(request.organization
          ? { organization: request.organization }
          : {}),
      },
      gatewayUrl
    );

    // Checked rather than assumed: the catalog holds both kinds, and the CID of
    // a Zarr store handed to the entity reader fails as a corrupt-dataset error
    // that says nothing about the actual mistake.
    //
    // Positive match, not "absent or tabular". Entity support postdates
    // `dclimate:layout`, so an item without the field is a gridded one from
    // before the convention -- treating absence as permission would admit
    // exactly the Zarr items this guard exists to catch, in order to accommodate
    // legacy entity items that cannot exist.
    if (resolved.layout !== ENTITY_DATASET_LAYOUT) {
      const found = resolved.layout ?? "gridded";
      throw new DatasetNotFoundError(
        `${request.collection}/${request.dataset} is a '${found}' dataset, not an entity dataset. Use loadDataset() for gridded data.`
      );
    }

    const metadataVariant = resolved.variant || "";
    const dataset = await this.entities.load({
      cid: resolved.cid,
      gatewayUrl,
      // Published column names are a property of the dataset's profile, not of
      // the stored blocks: the schema field is `tmax` and the published column
      // is `TMAX`. The reader's default is the identity, so without this the
      // published names are unreachable -- `elements("TMAX")` is an unknown
      // column on a dataset every document describes that way. Every dataset
      // this catalog serves is published upper case, so it is the default here
      // rather than a rule each caller has to know; an override stays available
      // for a profile that does otherwise.
      columnKey: request.columnKey ?? defaultEntityColumnKey,
    });

    const pathParts = [
      resolved.collectionId,
      resolved.dataset,
      metadataVariant,
    ].filter(Boolean);

    const metadata: DatasetMetadata = {
      dataset: resolved.dataset,
      collection: resolved.collectionId,
      variant: metadataVariant,
      path: pathParts.join("-"),
      cid: resolved.cid,
      source: "stac",
      fetchedAt: new Date(),
      ...(resolved.organizationId
        ? { organization: resolved.organizationId }
        : {}),
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
    };

    if (!metadata.organization && metadata.collection?.includes("_")) {
      metadata.organization = metadata.collection.split("_")[0];
    }

    return [dataset, metadata];
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
    const explicitZarrGroup = normalizeZarrGroup(options.zarrGroup);


    if (request.cid) {
      if (request.resolution && explicitZarrGroup) {
        throw new ConflictingResolutionSelectionError(
          "Pass either request.resolution or options.zarrGroup, not both."
        );
      }
      if (request.resolution) {
        throw new ResolutionNotAvailableError(
          "request.resolution requires STAC metadata; pass options.zarrGroup for a direct CID."
        );
      }
      // Direct CID provided - bypass catalog
      const dataset = await openDatasetFromCid(request.cid, {
        gatewayUrl,
        ipfsElements,
        zarrGroup: explicitZarrGroup,
        shardReadMode: options.shardReadMode,
      });
      const openedZarrGroup =
        explicitZarrGroup ??
        normalizeZarrGroup(dataset.attrs?._ipfs_zarr_group as string | undefined);

      const metadata: DatasetMetadata = {
        dataset: "",
        collection: "",
        variant: "",
        organization: "",
        source: "direct_cid",
        path: "",
        cid: request.cid,
        fetchedAt: new Date(),
        ...(openedZarrGroup ? { zarrGroup: openedZarrGroup } : {}),
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
    const zarrSelection = resolveZarrSelection(
      resolved.zarrResolutions,
      request.resolution,
      explicitZarrGroup
    );
    const zarrGroup = zarrSelection.zarrGroup;

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
      ...(zarrSelection.resolution
        ? { resolution: zarrSelection.resolution }
        : {}),
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
    const explicitZarrGroup = normalizeZarrGroup(options.zarrGroup);

    // Order by concatPriority so metadata (concatenatedVariants, cid)
    // reflects the same order the data is concatenated in.
    const orderedVariants = [...concatVariants].sort(
      (a, b) => a.concatPriority - b.concatPriority
    );

    // Load all variants in parallel
    const loadedVariants = await Promise.all(
      orderedVariants.map(async (variantConfig) => {
        const zarrSelection = resolveZarrSelection(
          variantConfig.zarrResolutions,
          request.resolution,
          explicitZarrGroup
        );
        const zarrGroup = zarrSelection.zarrGroup;
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
          zarrSelection,
        };
      })
    );
    const variantsToLoad: VariantToLoad[] = loadedVariants;

    // Concatenate the variants
    const concatenatedDataset = await concatenateVariants(variantsToLoad);
    const firstSelection = loadedVariants[0].zarrSelection;
    const commonZarrGroup = loadedVariants.every(
      ({ zarrSelection }) => zarrSelection.zarrGroup === firstSelection.zarrGroup
    )
      ? firstSelection.zarrGroup
      : undefined;
    const commonResolution = loadedVariants.every(
      ({ zarrSelection }) =>
        zarrSelection.resolution === firstSelection.resolution
    )
      ? firstSelection.resolution
      : undefined;

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
      ...(commonZarrGroup ? { zarrGroup: commonZarrGroup } : {}),
      ...(commonResolution ? { resolution: commonResolution } : {}),
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
