import { CID } from "multiformats/cid";
import {
  GatewayRangeSource,
  StationDataset,
  type NearestStation,
} from "@dclimate/tabular/reader";
import { DatasetNotFoundError } from "../errors.js";
import { translateStationError } from "./errors.js";

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

export interface NearestStationRequest extends LoadStationsRequest {
  latitude: number;
  longitude: number;
  /**
   * Only consider stations that actually report every one of these columns.
   *
   * Without it, "nearest" means nearest *station*, not nearest *data* -- a
   * station 40 km away that has never recorded TMAX wins over one 3,000 km away
   * that has. Presence means the station reported the column at some point, not
   * that it reported it recently.
   */
  columns?: readonly string[];
  /** Reject the match when the closest qualifying station is further than this. */
  maxKm?: number;
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

  /**
   * The station nearest a point that actually has the data you asked for.
   *
   * Resolves the dataset and the station in one call, because "which station
   * should I use for this location" is the question most callers open a station
   * dataset to ask, and answering it through `load` means knowing that `nearest`
   * needs `columns` to avoid picking a station full of nulls.
   *
   * Returns the distance alongside the station: a dataset with no coverage near
   * the queried point still has a nearest station, and the only way to tell that
   * apart from a good match is how far away it is.
   */
  async nearest(request: NearestStationRequest): Promise<NearestStation> {
    const dataset = await this.load(request);
    try {
      return await dataset.findNearestStation(request.latitude, request.longitude, {
        ...(request.columns ? { requireColumns: request.columns } : {}),
        ...(request.maxKm === undefined ? {} : { maxKm: request.maxKm }),
      });
    } catch (cause) {
      return translateStationError(cause);
    }
  }
}
