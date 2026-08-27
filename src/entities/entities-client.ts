import { CID } from "multiformats/cid";
import type {
  EntityDataset,
  NearestEntity,
  TableField,
} from "@dclimate/tabular/reader";
import { DatasetNotFoundError } from "../errors.js";

/**
 * Entity (point-observation) datasets, as opposed to the gridded Zarr datasets
 * `loadDataset` serves.
 *
 * "Entity" is tabular's word for the thing a row belongs to -- a weather station
 * in GHCND, a buoy in NDBC -- and this namespace follows it rather than keeping
 * an older `station` vocabulary the layer beneath no longer uses.
 *
 * The two are different enough underneath -- irregular entities with per-entity
 * time coverage, versus a regular lat/lon/time grid -- that sharing one loader
 * would help nobody. What they do share is how a caller wants to *ask*: degrees,
 * ISO timestamps, chained selections. `EntityDataset` provides that surface, so
 * this namespace stays thin: resolve a root, hand back the dataset.
 *
 * Resolution here is by CID only. Catalog resolution lives one level up, in
 * `DClimateClient.loadEntities`, which resolves a collection/dataset through
 * STAC and then calls this. Keeping it there rather than adding a second form
 * here leaves this class with one job, and leaves the direct-CID path as the
 * way to pin an exact snapshot rather than taking whatever the catalog calls
 * latest.
 */
export interface EntitiesClientOptions {
  gatewayUrl: string;
  fetch?: typeof globalThis.fetch;
}

export interface LoadEntitiesRequest {
  /** Root CID of a published entity dataset. */
  cid: string;
  /** Override the client's gateway for this dataset only. */
  gatewayUrl?: string;
  /**
   * Map each schema field to the column name queries and results use.
   *
   * A dataset's published column names are a property of its profile, not of
   * the stored blocks: GHCND stores a field named `tmax` and publishes it as
   * `TMAX`, NDBC preserves mixed case like `SwH`. The reader's default is the
   * identity -- the schema's own field names -- so without the dataset's
   * mapping, the published names are unreachable: `elements("TMAX")` is an
   * unknown element even though every GHCND doc names it that way.
   *
   * For GHCND, pass `(field) => field.name.toUpperCase()`.
   */
  columnKey?: (field: TableField) => string;
}

export interface NearestEntityRequest extends LoadEntitiesRequest {
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
  /**
   * Narrow `columns` to a time range, so a station qualifies only if it reported
   * them *then*.
   *
   * Without it, presence means "has ever reported": a station whose TMAX ended in
   * 1987 satisfies a 2024 query and then yields nothing but nulls. Real datasets
   * do this -- GHCND's ACW00011647 lists TMAX on the strength of readings that
   * only start in 2025.
   *
   * Resolution is per fragment (whole years, for GHCND), so a range landing
   * anywhere in a year that has the column matches it.
   */
  within?: { start: Date | string | number; end: Date | string | number };
}

export class EntitiesClient {
  constructor(private readonly options: EntitiesClientOptions) {}

  /**
   * Open an entity dataset by root CID.
   *
   * Reads go through the IPFS HTTP gateway, so this needs no local daemon and
   * works unchanged in a browser.
   */
  async load(request: LoadEntitiesRequest): Promise<EntityDataset> {
    if (!request.cid) {
      throw new DatasetNotFoundError(
        "An entity dataset CID is required. To address a dataset by name instead, use client.loadEntities({ request: { collection, dataset } })."
      );
    }

    let root: CID;
    try {
      root = CID.parse(request.cid);
    } catch (cause) {
      const detail = cause instanceof Error ? `: ${cause.message}` : "";
      throw new DatasetNotFoundError(`Not a valid CID: ${request.cid}${detail}`);
    }

    // Imported here, not at the top of the module: tabular's reader brings
    // hyparquet and its compressors with it, and a static chain from the main
    // client entry would make every consumer -- browser bundles included -- pay
    // for entity support they may never touch. `client.entities` constructing
    // lazily saves nothing if the modules loaded anyway. After the CID check,
    // so a typo still fails instantly without loading the stack.
    const [{ EntityDataset, GatewayRangeSource }, { translateEntityError }, { wrapEntityDataset }] =
      await Promise.all([
        import("@dclimate/tabular/reader"),
        import("./errors.js"),
        import("./wrap.js"),
      ]);

    const source = new GatewayRangeSource({
      gatewayUrl: request.gatewayUrl ?? this.options.gatewayUrl,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
    // Opening reads and parses the dataset's manifest, so a well-formed CID that
    // points at something else fails here rather than at query time. Translated
    // like any other reader failure: a caller catching `DClimateClientError`
    // should not have to also know `@dclimate/tabular`'s error hierarchy.
    //
    // The dataset is wrapped on the way out so that guarantee holds for the
    // whole chain, not just this call: `select`, `where`, and `rows` raise
    // tabular's errors too, and a caller has no reason to expect the boundary to
    // stop at `open`.
    try {
      return wrapEntityDataset(
        // `root` is a multiformats v13 CID -- this package pins ^13 so it shares
        // a single copy with @dclimate/jaxray, whose shard decoder identifies
        // CIDs with `instanceof`. Two copies in the tree make that check fail
        // and every zarr read dies with "Shard entry ... is not a CID or null".
        // tabular resolves its own v14 copy; the classes are structurally
        // identical and v14's `CID.asCID()` accepts a v13 instance, so this is
        // safe at runtime and only the nominal types differ. Drop the cast once
        // both sides sit on the same multiformats major.
        await EntityDataset.open(source, root as unknown as Parameters<typeof EntityDataset.open>[1], {
          ...(request.columnKey ? { columnKey: request.columnKey } : {}),
        })
      );
    } catch (cause) {
      return translateEntityError(cause);
    }
  }

  /**
   * The entity nearest a point that actually has the data you asked for.
   *
   * Resolves the dataset and the entity in one call, because "which station
   * should I use for this location" is the question most callers open an entity
   * dataset to ask, and answering it through `load` means knowing that `nearest`
   * needs `columns` to avoid picking a station full of nulls.
   *
   * Returns the distance alongside the entity: a dataset with no coverage near
   * the queried point still has a nearest entity, and the only way to tell that
   * apart from a good match is how far away it is.
   */
  async nearest(request: NearestEntityRequest): Promise<NearestEntity> {
    // No translation boundary of its own: `load` returns the dataset already
    // wrapped, so `findNearestEntity`'s failures come back translated.
    const dataset = await this.load(request);
    return dataset.findNearestEntity(request.latitude, request.longitude, {
      ...(request.columns ? { requireColumns: request.columns } : {}),
      ...(request.maxKm === undefined ? {} : { maxKm: request.maxKm }),
      ...(request.within === undefined ? {} : { withinRange: request.within }),
    });
  }
}
