import { CID } from "multiformats/cid";
import {
  GatewayRangeSource,
  StationDataset,
} from "@dclimate/tabular/reader";
import { DatasetNotFoundError } from "../errors.js";

/**
 * Station (point-observation) datasets, as opposed to the gridded Zarr datasets
 * `loadDataset` serves.
 *
 * The two are different enough underneath -- irregular stations with per-station
 * time coverage, versus a regular lat/lon/time grid -- that sharing one loader
 * would help nobody. What they do share is how a caller wants to *ask*: degrees,
 * ISO timestamps, chained selections. `StationDataset` provides that surface, so
 * this namespace stays thin: resolve a root, hand back the dataset.
 *
 * Resolution is by CID only for now. There is no STAC equivalent for station
 * data yet; when there is, `load` grows a `{ collection, dataset }` form
 * alongside the CID and the rest of this file is unaffected.
 */
export interface StationsClientOptions {
  gatewayUrl: string;
  fetch?: typeof globalThis.fetch;
}

export interface LoadStationsRequest {
  /** Root CID of a published station dataset. */
  cid: string;
  /** Override the client's gateway for this dataset only. */
  gatewayUrl?: string;
}

export class StationsClient {
  constructor(private readonly options: StationsClientOptions) {}

  /**
   * Open a station dataset by root CID.
   *
   * Reads go through the IPFS HTTP gateway, so this needs no local daemon and
   * works unchanged in a browser.
   */
  async load(request: LoadStationsRequest): Promise<StationDataset> {
    if (!request.cid) {
      throw new DatasetNotFoundError(
        "A station dataset CID is required. Catalog resolution is not available yet."
      );
    }

    let root: CID;
    try {
      root = CID.parse(request.cid);
    } catch (cause) {
      const detail = cause instanceof Error ? `: ${cause.message}` : "";
      throw new DatasetNotFoundError(`Not a valid CID: ${request.cid}${detail}`);
    }

    const source = new GatewayRangeSource({
      gatewayUrl: request.gatewayUrl ?? this.options.gatewayUrl,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
    return StationDataset.open(source, root);
  }
}
