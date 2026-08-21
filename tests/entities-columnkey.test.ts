import { describe, expect, it } from "vitest";
import { CID } from "multiformats/cid";
import {
  DatasetWriter,
  MemoryBlockStore,
  type DatasetProfile,
  type TableField,
} from "@dclimate/tabular";
import { EntitiesClient } from "../src/entities/entities-client.js";
import { InvalidSelectionError } from "../src/errors.js";

/**
 * End to end through the real reader: a dataset published under GHCND's
 * convention (schema field `tmax`, column published as `TMAX`) must be
 * queryable by its published names when the caller passes the profile's
 * `columnKey` -- and must reject them without it, because the reader's default
 * is the schema's own names.
 *
 * This is the regression test for the loader neither forwarding nor exposing a
 * mapping: every documented `TMAX` query failed as an unknown element against a
 * real GHCND root, while the lowercase names worked -- an API that contradicted
 * its own README.
 */

const upper = (field: TableField): string => field.name.toUpperCase();

const profile: DatasetProfile = {
  schema: {
    schemaId: 0,
    fields: [
      { fieldId: 1, name: "entity_id", type: "string", nullable: false },
      { fieldId: 2, name: "ts", type: "int64", nullable: false },
      { fieldId: 10, name: "tmax", type: "int32", nullable: true, units: "degC_tenths" },
    ],
  },
  columnKey: upper,
  fragmentBucket: "year",
};

const DAY_US = 24 * 60 * 60 * 1_000_000;
const START = Date.UTC(2024, 0, 1) * 1_000;

const publish = async (): Promise<{ store: MemoryBlockStore; root: string }> => {
  const store = new MemoryBlockStore();
  const published = await new DatasetWriter(store, { profile }).publish({
    datasetId: "columnkey-e2e",
    createdUs: START,
    message: "fixture",
    writer: "test/0",
    entities: [
      {
        meta: {
          entityId: "USW00094728",
          name: "NYC",
          geo: { latMicro: 40_779_000, lonMicro: -73_969_000 },
          elevCm: 0,
        },
        rows: [0, 1, 2].map((day) => ({
          entityId: "USW00094728",
          ts: START + day * DAY_US,
          values: new Map([["TMAX", 250 + day]]),
        })),
      },
    ],
  });
  return { store, root: published.root.toString() };
};

/**
 * Serves the in-memory store over the gateway's own HTTP shapes: whole blocks
 * as 200s (hash-verified by the source, so the bytes must be the store's own)
 * and byte ranges as 206s. What makes this an end-to-end test rather than a
 * mock -- the client reads through the same `GatewayRangeSource` a browser
 * would, it just never touches a socket.
 */
const gatewayFetch = (store: MemoryBlockStore): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const cidText = new URL(url).pathname.replace("/ipfs/", "");
    let bytes: Uint8Array;
    try {
      bytes = await store.get(CID.parse(cidText));
    } catch {
      return new Response(null, { status: 404 });
    }
    const range = new Headers(init?.headers).get("range");
    if (range !== null) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) return new Response(null, { status: 416 });
      const slice = bytes.slice(Number(match[1]), Number(match[2]) + 1);
      return new Response(new Uint8Array(slice), { status: 206 });
    }
    return new Response(new Uint8Array(bytes), { status: 200 });
  }) as typeof fetch;

describe("entity columnKey end to end", () => {
  it("answers published column names when the profile's columnKey is passed", async () => {
    const { store, root } = await publish();
    const entities = new EntitiesClient({
      gatewayUrl: "http://gateway.test",
      fetch: gatewayFetch(store),
    });

    const dataset = await entities.load({ cid: root, columnKey: upper });

    expect(dataset.columns()).toEqual([{ name: "TMAX", units: "degC_tenths" }]);
    const records = await dataset.select("USW00094728").toRecords("TMAX");
    expect(records.map((record) => record.value)).toEqual([250, 251, 252]);
  });

  it("rejects published names without the mapping, as an invalid selection", async () => {
    const { store, root } = await publish();
    const entities = new EntitiesClient({
      gatewayUrl: "http://gateway.test",
      fetch: gatewayFetch(store),
    });

    // Without the profile's mapping the vocabulary is the schema's own names.
    const dataset = await entities.load({ cid: root });
    expect(dataset.columns()).toEqual([{ name: "tmax", units: "degC_tenths" }]);

    // Wrapped in an async closure so it covers the rejection wherever it is
    // raised -- eagerly at selection or lazily at read -- and asserts it comes
    // back translated to this library's own error type either way.
    await expect(
      (async () => dataset.elements("TMAX").rows())()
    ).rejects.toThrow(InvalidSelectionError);

    // The schema's own names still work; the mapping changes naming, not data.
    const records = await dataset.select("USW00094728").toRecords("tmax");
    expect(records.map((record) => record.value)).toEqual([250, 251, 252]);
  });

  it("rejects out-of-range coordinates as an invalid selection", async () => {
    // The validation itself lives in tabular >= 0.9.1 (`findNearestEntity`
    // bounds-checks; the geo filter paths always did) -- the client deliberately
    // delegates query validation and translates at the boundary rather than
    // duplicating checks. This pins that contract from the caller's side: a
    // latitude of 100 must surface as this library's InvalidSelectionError, not
    // as a plausible-looking station for a point that does not exist.
    const { store, root } = await publish();
    const entities = new EntitiesClient({
      gatewayUrl: "http://gateway.test",
      fetch: gatewayFetch(store),
    });

    await expect(
      entities.nearest({ cid: root, latitude: 100, longitude: 0 })
    ).rejects.toThrow(InvalidSelectionError);
    await expect(
      entities.nearest({ cid: root, latitude: 40.78, longitude: 250 })
    ).rejects.toThrow(InvalidSelectionError);

    // In range still resolves -- the fixture's one station, with its distance.
    const nearest = await entities.nearest({
      cid: root,
      latitude: 40.78,
      longitude: -73.97,
    });
    expect(nearest.entityId).toBe("USW00094728");
  });
});
