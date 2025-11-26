import { createIpfsElements, Dataset } from "@dclimate/jaxray";
import { GeoTemporalDataset } from "./geotemporal-dataset.js";
import {
  ClientOptions,
  DatasetMetadata,
  DatasetRequest,
  GeoSelectionOptions,
  LoadDatasetOptions,
} from "./types.js";
import { DEFAULT_IPFS_GATEWAY } from "./constants.js";
import { openDatasetFromCid, IpfsElements } from "./ipfs/open-dataset.js";
import { DatasetNotFoundError } from "./errors.js";
import { normalizeSegment } from "./utils.js";

import { concatenateVariants, type VariantToLoad } from "./actions/concatenate-variants.js";
import {
  loadStacCatalog,
  resolveDatasetCidFromStac,
  getConcatenableItemsFromStac,
  listAvailableDatasetsFromStac,
  type StacCatalog,
  type ConcatenableStacItem,
} from "./stac/index.js";
import { DatasetCatalog } from "./stac/stac-catalog.js";

export class DClimateClient {
  private gatewayUrl: string;
  private cachedGateway?: string;
  private cachedIpfs?: IpfsElements;
  private clientIpfsElements?: IpfsElements;
  private stacCatalog?: StacCatalog;
  private stacCatalogTimestamp?: number;
  private stacCacheTtl: number = 3600000; // 1 hour

  constructor(options: ClientOptions = {}) {
    this.gatewayUrl = options.gatewayUrl ?? DEFAULT_IPFS_GATEWAY;
    this.clientIpfsElements = options.ipfsElements;
  }

  private async getStacCatalog(gatewayUrl: string): Promise<StacCatalog> {
    // Check if cached catalog is still valid
    if (this.stacCatalog && this.stacCatalogTimestamp) {
      const age = Date.now() - this.stacCatalogTimestamp;
      if (age < this.stacCacheTtl) {
        return this.stacCatalog;
      }
    }

    // Load fresh catalog
    this.stacCatalog = await loadStacCatalog(gatewayUrl);
    this.stacCatalogTimestamp = Date.now();
    return this.stacCatalog;
  }

  async listAvailableDatasets(): Promise<DatasetCatalog> {
    const catalog = await this.getStacCatalog(this.gatewayUrl);
    return listAvailableDatasetsFromStac(catalog);
  }

  async listCatalogEntries(): Promise<DatasetCatalog> {
    return this.listAvailableDatasets();
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
    const normalizedDatasetKey = normalizeSegment(request.dataset);
    const autoConcatenate = options.autoConcatenate;

    if (!normalizedDatasetKey) {
      throw new DatasetNotFoundError("Dataset name must be provided.");
    }

    // Skip auto-concatenation if explicit CID or variant is provided
    if (!options.cid && !request.variant && autoConcatenate) {
      // Load STAC catalog to check for concatenable variants
      const catalog = await this.getStacCatalog(gatewayUrl);

      // Get all items for this collection/dataset
      const concatenableItems = getConcatenableItemsFromStac(
        catalog,
        request.collection || "",
        request.dataset
      );

      if (concatenableItems.length > 1) {
        // Multiple variants with concat metadata found
        // Load and concatenate based on dclimate:concatPriority
        return this.loadAndConcatenateVariants(
          request,
          concatenableItems,
          options
        );
      }

      // Single item found - proceed with single variant loading below
      // If no items found, will error in resolution step
    }

    // Fall back to single variant loading
    let cid: string;
    let resolvedPath: string;
    let metadataDataset = request.dataset;
    let metadataCollection = request.collection;
    let metadataVariant = request.variant ?? "";

    if (options.cid) {
      // Direct CID provided - bypass catalog
      cid = options.cid;
      resolvedPath = normalizedDatasetKey;
    } else {
      // Use STAC catalog resolution
      const catalog = await this.getStacCatalog(gatewayUrl);

      // Resolve CID from STAC
      cid = resolveDatasetCidFromStac(
        catalog,
        request.collection || "",
        request.dataset,
        request.variant
      );

      // Update metadata with resolved values
      metadataCollection = request.collection || "";
      metadataDataset = request.dataset;
      metadataVariant = request.variant || "";

      // Build path from resolved names
      const pathParts = [metadataCollection, metadataDataset, metadataVariant].filter(Boolean);
      resolvedPath = pathParts.join("-");
    }
    const dataset = await openDatasetFromCid(cid, {
      gatewayUrl,
      ipfsElements,
    });

    const metadata: DatasetMetadata = {
      dataset: metadataDataset,
      collection: metadataCollection,
      variant: metadataVariant,
      path: resolvedPath,
      cid: cid,
      source: options.cid ? "direct_cid" : "stac",
      fetchedAt: new Date(),
    };

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
    const gatewayUrl = options.gatewayUrl ?? this.gatewayUrl;
    const ipfsElements = this.resolveIpfsElements(options, gatewayUrl);

    // Load all variants in parallel
    const variantsToLoad: VariantToLoad[] = await Promise.all(
      concatVariants.map(async (variantConfig) => {
        // Load the dataset using the CID from STAC
        const dataset = await openDatasetFromCid(variantConfig.cid, {
          gatewayUrl,
          ipfsElements,
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
      concatenatedVariants: concatVariants.map((v) => v.variant),
      path: pathParts.join("-"),
      cid: variantsToLoad[0].dataset.attrs._zarr_cid as string || "concatenated",
      source: "stac_concatenated",
      fetchedAt: new Date(),
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
