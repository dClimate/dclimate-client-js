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
  type DatasetCatalog,
} from "./datasets.js";

interface DatasetApiResponse {
  dataset?: string;
  cid?: string;
  timestamp?: number;
}

export class DClimateClient {
  private gatewayUrl: string;
  private cachedGateway?: string;
  private cachedIpfs?: IpfsElements;

  constructor(options: ClientOptions = {}) {
    this.gatewayUrl = options.gatewayUrl ?? DEFAULT_IPFS_GATEWAY;
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
    },
  }: {
    request: DatasetRequest;
    options?: LoadDatasetOptions;
  }): Promise<GeoTemporalDataset | Dataset> {
    const gatewayUrl = options.gatewayUrl ?? this.gatewayUrl;
    const normalizedDatasetKey = normalizeSegment(request.dataset);

    if (!normalizedDatasetKey) {
      throw new DatasetNotFoundError("Dataset name must be provided.");
    }

    let cid: string;
    let resolvedPath: string;
    let metadataDataset = request.dataset;
    let metadataCollection = request.collection;
    let metadataVariant = request.variant ?? "";

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
        cid = await this.fetchDatasetCidFromEndpoint(
          resolved.slug,
          resolved.source.url
        );
      }
    }

    const dataset = await openDatasetFromCid(cid, {
      gatewayUrl,
      ipfsElements: this.getIpfsElements(gatewayUrl),
    });

    if (options.returnJaxrayDataset) {
      return dataset;
    }

    const metadata: DatasetMetadata = {
      dataset: metadataDataset,
      collection: metadataCollection,
      variant: metadataVariant,
      path: resolvedPath,
      cid,
      fetchedAt: new Date(),
    };

    return new GeoTemporalDataset(dataset, metadata);
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
  }): Promise<GeoTemporalDataset | Dataset> {
    const dataset = await this.loadDataset({ request, options });
    if (!(dataset instanceof GeoTemporalDataset)) {
      return dataset;
    }
    return dataset.select(selection);
  }

  private async fetchDatasetCidFromEndpoint(
    slug: string,
    endpoint: string
  ): Promise<string> {
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

    return cid;
  }

  private getIpfsElements(gatewayUrl: string): IpfsElements {
    if (this.cachedIpfs && this.cachedGateway === gatewayUrl) {
      return this.cachedIpfs;
    }
    this.cachedGateway = gatewayUrl;
    this.cachedIpfs = createIpfsElements(gatewayUrl);
    return this.cachedIpfs;
  }
}
