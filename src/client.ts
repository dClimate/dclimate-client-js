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
import {
  listDatasetCatalog,
  resolveDatasetSource,
  getConcatenableVariants,
  type DatasetCatalog,
  DatasetVariantConfig,
} from "./datasets.js";
import { concatenateVariants, type VariantToLoad } from "./actions/concatenate-variants.js";

interface DatasetApiResponse {
  dataset?: string;
  cid?: string;
  timestamp?: number;
}

export class DClimateClient {
  private gatewayUrl: string;
  private cachedGateway?: string;
  private cachedIpfs?: IpfsElements;
  private clientIpfsElements?: IpfsElements;

  constructor(options: ClientOptions = {}) {
    this.gatewayUrl = options.gatewayUrl ?? DEFAULT_IPFS_GATEWAY;
    this.clientIpfsElements = options.ipfsElements;
  }

  listAvailableDatasets(): DatasetCatalog {
    return listDatasetCatalog();
  }

  listCatalogEntries(): DatasetCatalog {
    return listDatasetCatalog();
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

    // Skip auto-concatenation if explicit CID is provided
    if (!options.cid && autoConcatenate) {
      // Try to get concatenable variants
      const concatVariants = getConcatenableVariants({
        dataset: request.dataset,
        collection: request.collection,
      });

      if (concatVariants.length > 1) {
        // Load and concatenate multiple variants
        return this.loadAndConcatenateVariants(
          request,
          concatVariants,
          options
        );
      }
    }

    // Fall back to single variant loading
    let cid: string;
    let resolvedPath: string;
    let metadataDataset = request.dataset;
    let metadataCollection = request.collection;
    let metadataVariant = request.variant ?? "";
    let urlFetchResult: DatasetApiResponse | undefined;
    let sourceUrl: string | undefined;

    if (options.cid) {
      cid = options.cid;
      resolvedPath = normalizedDatasetKey;
    } else {
      const resolved = resolveDatasetSource(request);

      resolvedPath = resolved.path;
      metadataDataset = resolved.dataset;
      metadataCollection = resolved.collection;
      metadataVariant = resolved.variant ?? "";

      if (resolved.source.type === "cid") {
        cid = resolved.source.cid;
      } else {
        sourceUrl = resolved.source.url;
        urlFetchResult = await this.fetchDatasetCidFromEndpoint(
          resolved.slug,
          resolved.source.url
        );
        cid = urlFetchResult.cid!.trim();
      }
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
      url: sourceUrl,
      timestamp: urlFetchResult?.timestamp,
      source: options.cid ? "direct_cid" : "catalog",
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
    concatVariants: DatasetVariantConfig[],
    options: LoadDatasetOptions
  ): Promise<[GeoTemporalDataset, DatasetMetadata] | [Dataset, DatasetMetadata]> {
    const gatewayUrl = options.gatewayUrl ?? this.gatewayUrl;
    const ipfsElements = this.resolveIpfsElements(options, gatewayUrl);

    // Load all variants in parallel
    const variantsToLoad: VariantToLoad[] = await Promise.all(
      concatVariants.map(async (variantConfig) => {
        // Resolve the variant to get CID
        const resolved = resolveDatasetSource({
          ...request,
          variant: variantConfig.variant,
        });

        let cid: string;
        if (resolved.source.type === "cid") {
          cid = resolved.source.cid;
        } else {
          const apiResponse = await this.fetchDatasetCidFromEndpoint(
            resolved.slug,
            resolved.source.url
          );
          cid = apiResponse.cid!.trim();
        }

        // Load the dataset
        const dataset = await openDatasetFromCid(cid, {
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
    const metadata: DatasetMetadata = {
      dataset: request.dataset,
      collection: request.collection,
      concatenatedVariants: concatVariants.map((v) => v.variant),
      path: `${request.collection ?? ""}/${request.dataset}`,
      cid: variantsToLoad[0].dataset.attrs._zarr_cid as string || "concatenated",
      source: "catalog",
      fetchedAt: new Date(),
    };

    if (options.returnJaxrayDataset) {
      return [concatenatedDataset, metadata];
    }

    return [new GeoTemporalDataset(concatenatedDataset, metadata), metadata];
  }

  private async fetchDatasetCidFromEndpoint(
    slug: string,
    endpoint: string
  ): Promise<DatasetApiResponse> {
    const response = await fetch(endpoint);
    if (!response.ok) {
      if (response.status === 404) {
        throw new DatasetNotFoundError(
          `Dataset "${slug}" was not found at "${endpoint}".`
        );
      }

      throw new DatasetNotFoundError(
        `Failed to fetch dataset "${slug}" (status ${response.status}).`
      );
    }

    const payload = (await response.json()) as DatasetApiResponse;
    const cid = payload?.cid?.trim();
    if (!cid) {
      throw new DatasetNotFoundError(
        `Dataset endpoint "${endpoint}" did not provide a CID for "${slug}".`
      );
    }

    return payload;
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
