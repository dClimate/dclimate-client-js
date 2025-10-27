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
import { DatasetKey, getDatasetEndpoint, listDatasetKeys } from "./datasets.js";

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

  listAvailableDatasets(): string[] {
    return listDatasetKeys();
  }

  listCatalogEntries(): string[] {
    return this.listAvailableDatasets();
  }

  async loadDataset(
    request: DatasetRequest,
    options: LoadDatasetOptions = {},
    returnJaxrayDataset = false,
  ): Promise<GeoTemporalDataset | Dataset> {
    const gatewayUrl = options.gatewayUrl ?? this.gatewayUrl;
    const datasetKey = normalizeSegment(request.dataset);

    if (!datasetKey) {
      throw new DatasetNotFoundError("Dataset name must be provided.");
    }

    let cid: string;
    let resolvedPath: string;

    if (options.cid) {
      cid = options.cid;
      resolvedPath = datasetKey;
    } else {
      const result = await this.fetchDatasetCid(datasetKey);
      cid = result.cid;
      resolvedPath = result.path ?? datasetKey;
    }

    const dataset = await openDatasetFromCid(cid, {
      gatewayUrl,
      ipfsElements: this.getIpfsElements(gatewayUrl),
    });

    if (returnJaxrayDataset) {
      return dataset;
    }

    const metadata: DatasetMetadata = {
      dataset: request.dataset,
      collection: request.collection,
      variant: request.variant ?? "",
      path: resolvedPath,
      cid,
      fetchedAt: new Date(),
    };

    return new GeoTemporalDataset(dataset, metadata);
  }

  async selectDataset(
    request: DatasetRequest,
    selection: GeoSelectionOptions,
    options: LoadDatasetOptions = {},
    returnJaxrayDataset = false,
  ): Promise<GeoTemporalDataset | Dataset> {
    const dataset = await this.loadDataset(request, options, returnJaxrayDataset);
    if (!(dataset instanceof GeoTemporalDataset)) {
      return dataset;
    }
    return dataset.select(selection);
  }

  private async fetchDatasetCid(
    datasetKey: string
  ): Promise<{ cid: string; path: string }> {
    const endpoint = getDatasetEndpoint(datasetKey as DatasetKey);
    if (!endpoint) {
      throw new DatasetNotFoundError(
        `Dataset "${datasetKey}" is not registered in the dataset map.`
      );
    }

    const response = await fetch(endpoint);
    if (!response.ok) {
      if (response.status === 404) {
        throw new DatasetNotFoundError(
          `Dataset "${datasetKey}" was not found at "${endpoint}".`
        );
      }

      throw new DatasetNotFoundError(
        `Failed to fetch dataset "${datasetKey}" (status ${response.status}).`
      );
    }

    const payload = (await response.json()) as DatasetApiResponse;
    const cid = payload?.cid?.trim();
    if (!cid) {
      throw new DatasetNotFoundError(
        `Dataset endpoint "${endpoint}" did not provide a CID for "${datasetKey}".`
      );
    }

    const resolvedPath = payload?.dataset?.trim().toLowerCase() || datasetKey;

    return { cid, path: resolvedPath };
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
