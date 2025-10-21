import { createIpfsElements } from "@dclimate/jaxray";
import { CatalogResolver } from "./catalog/cid-resolver.js";
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
import { buildCatalogCandidates } from "./utils.js";

function inferPathFromRequest(
  request: DatasetRequest
): string {
  return buildCatalogCandidates(request, {})[0] ?? request.dataset;
}

export class DClimateClient {
  private readonly resolver: CatalogResolver;
  private gatewayUrl: string;
  private cachedGateway?: string;
  private cachedIpfs?: IpfsElements;

  constructor(options: ClientOptions = {}) {
    this.gatewayUrl = options.gatewayUrl ?? DEFAULT_IPFS_GATEWAY;
    this.resolver = new CatalogResolver(options);
  }

  setGatewayUrl(nextGateway: string) {
    this.gatewayUrl = nextGateway;
    this.cachedGateway = undefined;
    this.cachedIpfs = undefined;
  }

  listCatalogEntries(): string[] {
    return this.resolver.listKnownDatasets();
  }

  clearCatalogCache() {
    this.resolver.clearCache();
  }

  async loadDataset(
    request: DatasetRequest,
    options: LoadDatasetOptions = {}
  ): Promise<GeoTemporalDataset> {
    const gatewayUrl = options.gatewayUrl ?? this.gatewayUrl;

    let cid: string;
    let path: string;

    if (options.cid) {
      cid = options.cid;
      path = options.path ?? inferPathFromRequest(request);
    } else {
      const result = await this.resolver.resolveDataset(request, {
        path: options.path,
        signal: options.signal,
      });
      cid = result.cid;
      path = result.path;
    }

    if (!cid) {
      throw new DatasetNotFoundError(
        `Unable to resolve CID for dataset "${request.dataset}".`
      );
    }

    const dataset = await openDatasetFromCid(cid, {
      gatewayUrl,
      ipfsElements: this.getIpfsElements(gatewayUrl),
    });

    const metadata: DatasetMetadata = {
      dataset: request.dataset,
      collection: request.collection,
      variant: request.variant ?? "",
      path,
      cid,
      fetchedAt: new Date(),
    };

    return new GeoTemporalDataset(dataset, metadata);
  }

  async selectDataset(
    request: DatasetRequest,
    selection: GeoSelectionOptions,
    options: LoadDatasetOptions = {}
  ): Promise<GeoTemporalDataset> {
    const dataset = await this.loadDataset(request, options);
    return dataset.select(selection);
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
