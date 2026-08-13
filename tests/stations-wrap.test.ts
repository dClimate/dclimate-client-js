import { describe, expect, it } from "vitest";
import {
  DatasetIntegrityError,
  DatasetReaderError,
  StationDataset,
  StationSelectionError,
} from "@dclimate/tabular/reader";
import { wrapStationDataset } from "../src/stations/wrap.js";
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
const fake = (overrides: Record<string, unknown>): StationDataset =>
  Object.assign(Object.create(StationDataset.prototype), overrides);

describe("wrapStationDataset", () => {
  it("translates a rejection from a terminal method", async () => {
    // The gap the wrapper exists to close: `rows()` is where a caller most often
    // meets a reader error, and it is nowhere near `load`'s try/catch.
    const dataset = wrapStationDataset(
      fake({
        rows: () => Promise.reject(new DatasetReaderError("unknown column")),
      })
    );

    await expect(dataset.rows()).rejects.toThrow(InvalidSelectionError);
    await expect(dataset.rows()).rejects.toThrow(DClimateClientError);
  });

  it("keeps the not-found / bad-request distinction across the boundary", async () => {
    const dataset = wrapStationDataset(
      fake({
        rows: () =>
          Promise.reject(
            Object.assign(new StationSelectionError("no-match"), {
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
    const dataset = wrapStationDataset(
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
    const dataset = wrapStationDataset(
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

    const dataset = wrapStationDataset(root);

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
    const dataset = wrapStationDataset(
      fake({ nearest: () => Promise.resolve(leaf) })
    );

    const nearest = await dataset.nearest(29.98, -95.36);
    await expect(nearest.rows()).rejects.toThrow(InvalidSelectionError);
  });

  it("passes successful results through untouched", async () => {
    const rows = [{ stationId: "USW00094728", time: 0, value: 1 }];
    const plan = { fragments: 3 };
    const dataset = wrapStationDataset(
      fake({
        rows: () => Promise.resolve(rows),
        plan: () => Promise.resolve(plan),
        listStations: () => Promise.resolve([{ stationId: "USW00094728" }]),
        toQuery: () => ({ kind: "query" }),
      })
    );

    // Terminals return plain data, not datasets; the proxy must not wrap those.
    await expect(dataset.rows()).resolves.toBe(rows);
    await expect(dataset.plan()).resolves.toBe(plan);
    await expect(dataset.listStations()).resolves.toEqual([
      { stationId: "USW00094728" },
    ]);
    expect(dataset.toQuery()).toEqual({ kind: "query" });
  });

  it("forwards arguments unchanged", () => {
    const seen: unknown[][] = [];
    const dataset = wrapStationDataset(
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
    const dataset = wrapStationDataset(
      fake({ rows: () => Promise.reject(failure) })
    );

    await expect(dataset.rows()).rejects.toBe(failure);
  });

  it("exposes non-function properties as they are", () => {
    // Only methods are trapped; a plain field must read straight through rather
    // than come back as a wrapped function.
    const dataset = wrapStationDataset(fake({ rootCid: "bafyr4i" }));
    expect((dataset as unknown as { rootCid: string }).rootCid).toBe("bafyr4i");
  });
});
