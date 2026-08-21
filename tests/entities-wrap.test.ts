import { describe, expect, it } from "vitest";
import * as dagCbor from "@ipld/dag-cbor";
import { CID } from "multiformats/cid";
import {
  blake3Hasher,
  DatasetIntegrityError,
  DatasetReaderError,
  PredicateError,
  RangeSourceError,
  EntityDataset,
  EntitySelectionError,
} from "@dclimate/tabular/reader";
import { wrapEntityDataset } from "../src/entities/wrap.js";
import { translateEntityError } from "../src/entities/errors.js";
import {
  DatasetCorruptError,
  DClimateClientError,
  InvalidSelectionError,
  NoDataFoundError,
} from "../src/errors.js";

/**
 * A stand-in for a real dataset.
 *
 * Built by hand rather than opened over a gateway because what is under test is
 * the translation boundary, not tabular's reader: these tests need methods that
 * fail on demand, in each of the shapes the real class can fail in. It extends
 * the real class so the proxy's `instanceof` re-wrapping check sees what it
 * would see in production.
 */
const fake = (overrides: Record<string, unknown>): EntityDataset =>
  Object.assign(Object.create(EntityDataset.prototype), overrides);

describe("wrapEntityDataset", () => {
  it("translates a rejection from a terminal method", async () => {
    // The gap the wrapper exists to close: `rows()` is where a caller most often
    // meets a reader error, and it is nowhere near `load`'s try/catch.
    const dataset = wrapEntityDataset(
      fake({
        rows: () => Promise.reject(new DatasetReaderError("unknown column")),
      })
    );

    await expect(dataset.rows()).rejects.toThrow(InvalidSelectionError);
    await expect(dataset.rows()).rejects.toThrow(DClimateClientError);
  });

  it("keeps the not-found / bad-request distinction across the boundary", async () => {
    const dataset = wrapEntityDataset(
      fake({
        rows: () =>
          Promise.reject(
            Object.assign(new EntitySelectionError("no-match"), {
              reason: "not-found",
            })
          ),
      })
    );

    // A well-formed question with an empty answer stays an empty answer, rather
    // than being flattened into "you asked wrong".
    await expect(dataset.rows()).rejects.toThrow(NoDataFoundError);
  });

  it("reports corrupt data as corruption rather than a bad selection", async () => {
    // The caller cannot rephrase their way out of a damaged fragment, so
    // flattening this into InvalidSelectionError would blame the wrong party.
    const dataset = wrapEntityDataset(
      fake({
        rows: () =>
          Promise.reject(
            new DatasetIntegrityError(
              "Correction sequence does not match its fragment entry"
            )
          ),
      })
    );

    await expect(dataset.rows()).rejects.toThrow(DatasetCorruptError);
    await expect(dataset.rows()).rejects.toThrow(DClimateClientError);
    await expect(dataset.rows()).rejects.not.toThrow(InvalidSelectionError);
  });

  it("translates a synchronous throw from a selection", () => {
    const dataset = wrapEntityDataset(
      fake({
        where: () => {
          throw new DatasetReaderError("not comparable");
        },
      })
    );

    expect(() => dataset.where({} as never)).toThrow(InvalidSelectionError);
  });

  it("still translates after a chain of sync selections", async () => {
    // The regression this guards: wrapping only the dataset handed to the caller
    // leaves every dataset *derived* from it unwrapped, so translation would
    // silently stop at the first `.select()`.
    const leaf = fake({
      rows: () => Promise.reject(new DatasetReaderError("unknown column")),
    });
    const root = fake({
      select: () => leaf,
      timeRange: () => leaf,
    });

    const dataset = wrapEntityDataset(root);

    await expect(
      dataset.select("USW00094728").rows()
    ).rejects.toThrow(InvalidSelectionError);
    await expect(
      dataset.timeRange({ start: "2023-01-01", end: "2023-01-07" }).rows()
    ).rejects.toThrow(InvalidSelectionError);
  });

  it("re-wraps the dataset `nearest` resolves to", async () => {
    // `nearest` is the one chainable that is async, so it needs re-wrapping on
    // resolve rather than on return.
    const leaf = fake({
      rows: () => Promise.reject(new DatasetReaderError("unknown column")),
    });
    const dataset = wrapEntityDataset(
      fake({ nearest: () => Promise.resolve(leaf) })
    );

    const nearest = await dataset.nearest(29.98, -95.36);
    await expect(nearest.rows()).rejects.toThrow(InvalidSelectionError);
  });

  it("passes successful results through untouched", async () => {
    const rows = [{ entityId: "USW00094728", time: 0, value: 1 }];
    const plan = { fragments: 3 };
    const dataset = wrapEntityDataset(
      fake({
        rows: () => Promise.resolve(rows),
        plan: () => Promise.resolve(plan),
        listEntities: () => Promise.resolve([{ entityId: "USW00094728" }]),
        toQuery: () => ({ kind: "query" }),
      })
    );

    // Terminals return plain data, not datasets; the proxy must not wrap those.
    await expect(dataset.rows()).resolves.toBe(rows);
    await expect(dataset.plan()).resolves.toBe(plan);
    await expect(dataset.listEntities()).resolves.toEqual([
      { entityId: "USW00094728" },
    ]);
    expect(dataset.toQuery()).toEqual({ kind: "query" });
  });

  it("forwards arguments unchanged", () => {
    const seen: unknown[][] = [];
    const dataset = wrapEntityDataset(
      fake({
        select: (...args: unknown[]) => {
          seen.push(args);
          return fake({});
        },
      })
    );

    dataset.select("USW00094728", "USW00023174");
    expect(seen).toEqual([["USW00094728", "USW00023174"]]);
  });

  it("leaves non-error rejections alone", async () => {
    // A network failure from the gateway, or a TypeError from a bug, is not the
    // boundary's to reinterpret -- it should surface as itself.
    const failure = new TypeError("fetch failed");
    const dataset = wrapEntityDataset(
      fake({ rows: () => Promise.reject(failure) })
    );

    await expect(dataset.rows()).rejects.toBe(failure);
  });

  it("exposes non-function properties as they are", () => {
    // Only methods are trapped; a plain field must read straight through rather
    // than come back as a wrapped function.
    const dataset = wrapEntityDataset(fake({ rootCid: "bafyr4i" }));
    expect((dataset as unknown as { rootCid: string }).rootCid).toBe("bafyr4i");
  });
});

/**
 * A CID that resolves, to bytes that are not an entity dataset.
 *
 * The tests above drive translation with hand-built errors, which proves the
 * mapping but assumes the right errors arrive. These drive it through tabular's
 * real decode path instead, so the error classes are whatever the reader
 * genuinely throws -- the assumption is what is under test.
 *
 * Injected at the `RangeSource` seam rather than through `client.entities.load`
 * because the gateway between them contributes nothing here: it would only
 * re-fetch the same bytes over a stub `fetch`, and its retry backoff makes the
 * test slow enough to time out.
 */
const sourceServing = (bytes: Uint8Array) => ({
  cid: CID.createV1(0x71, blake3Hasher.digest(bytes)),
  source: {
    getBlock: async () => bytes,
    getRange: async (_cid: unknown, offset: number, length: number) =>
      bytes.slice(offset, offset + length),
  } as never,
});

/** Mirrors `EntitiesClient.load`'s try/catch, minus the gateway. */
const openLike = async (bytes: Uint8Array): Promise<never> => {
  const { cid, source } = sourceServing(bytes);
  try {
    return (await EntityDataset.open(source, cid)) as never;
  } catch (cause) {
    return translateEntityError(cause);
  }
};

describe("translateEntityError on a valid CID holding non-entity data", () => {
  it("reports a well-formed block that is not a dataset root as corruption", async () => {
    // A `WireError`: the CBOR decodes, but nothing in it says "dataset root".
    const caught = await openLike(dagCbor.encode({ hello: "world" })).catch(
      (error: unknown) => error
    );

    expect(caught).toBeInstanceOf(DatasetCorruptError);
    // The tabular class survives in the text. It is the only thing that
    // distinguishes these cases once they share a client-side type, and it is
    // what a publisher needs to debug the CID they published.
    expect((caught as Error).message).toContain("WireError");
  });

  it("reports a CID pointing at non-CBOR bytes as corruption", async () => {
    // A `CodecError` rather than a `WireError`: this fails in the dag-cbor
    // decode, before any field is looked at. A CID naming a UnixFS file --
    // pasting the CID of a CSV instead of its dataset -- lands here.
    const caught = await openLike(new Uint8Array([0xff, 0xff, 0xff, 0xff])).catch(
      (error: unknown) => error
    );

    expect(caught).toBeInstanceOf(DatasetCorruptError);
    expect((caught as Error).message).toContain("CodecError");
  });

  it("keeps every tabular error inside the client's own hierarchy", async () => {
    // The promise this boundary exists to make: catching `DClimateClientError`
    // is enough, and a caller never has to also know tabular's hierarchy.
    for (const bytes of [
      dagCbor.encode({ hello: "world" }),
      dagCbor.encode({ version: 1, schema: "nope" }),
      new Uint8Array([0xff, 0xff, 0xff, 0xff]),
    ]) {
      const caught = await openLike(bytes).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(DClimateClientError);
    }
  });
});

describe("translateEntityError classification", () => {
  it("leaves a transport failure untranslated", () => {
    // `RangeSourceError` descends from the same base as the corruption classes,
    // so the base-class branch would swallow it as corruption if it were not
    // checked first. A gateway blip is retryable and says nothing about the
    // dataset; calling it corruption sends the caller to the publisher.
    const failure = new RangeSourceError("Range exceeds block length");
    expect(() => translateEntityError(failure)).toThrow(RangeSourceError);
    expect(() => translateEntityError(failure)).not.toThrow(DatasetCorruptError);
  });

  it("reports a bad predicate as a bad selection, not corruption", () => {
    // Comparing `gt` against a text column is an ordinary caller mistake --
    // rewording the query fixes it -- so it must not be blamed on the data.
    const failure = new PredicateError(
      "Cannot apply 'gt' to non-numeric column NAME"
    );
    expect(() => translateEntityError(failure)).toThrow(InvalidSelectionError);
    expect(() => translateEntityError(failure)).not.toThrow(DatasetCorruptError);
  });

  it("passes gap data through the proxy untouched", async () => {
    // `gapsFor` and the `gaps` on every info row are the surface that tells a
    // caller a window is *unknown* rather than empty. They resolve to plain
    // arrays, so the proxy's `instanceof EntityDataset` check must let them by
    // rather than treating them as a chainable to re-wrap -- the same path
    // `columnsFor` takes, and a method the wrapper was never told about.
    const gaps = [
      { beginUs: 830_390_400_000_000, endUs: 847_065_599_999_999, reason: "awdb: HTTP 500" },
    ];
    const dataset = wrapEntityDataset(
      fake({
        gapsFor: () => Promise.resolve(gaps),
        infoFor: () => Promise.resolve({ entityId: "2001:NE:SCAN", gaps }),
      })
    );

    await expect(dataset.gapsFor("2001:NE:SCAN")).resolves.toBe(gaps);
    await expect(dataset.infoFor("2001:NE:SCAN")).resolves.toEqual({
      entityId: "2001:NE:SCAN",
      gaps,
    });
  });

  it("translates a rejection from gapsFor like any other terminal", async () => {
    // An unknown entity id is a caller mistake, and must arrive as this
    // library's error rather than tabular's -- the whole point of the wrapper.
    const dataset = wrapEntityDataset(
      fake({
        gapsFor: () => Promise.reject(new EntitySelectionError("no such entity", "not-found")),
      })
    );

    await expect(dataset.gapsFor("NOPE")).rejects.toThrow(NoDataFoundError);
    await expect(dataset.gapsFor("NOPE")).rejects.toThrow(DClimateClientError);
  });

  it("still rethrows errors that are not tabular's at all", () => {
    // The base-class branch must not become a catch-all: a TypeError from a bug
    // in this client is not a statement about the dataset.
    const bug = new TypeError("x is not a function");
    expect(() => translateEntityError(bug)).toThrow(TypeError);
    expect(() => translateEntityError(bug)).not.toThrow(DClimateClientError);
  });
});
