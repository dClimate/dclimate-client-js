import { describe, expect, it, vi } from "vitest";
import { DClimateClient } from "../src/index.js";
import { DatasetNotFoundError } from "../src/errors.js";

/**
 * `loadEntities` is the entity counterpart to `loadDataset`: it resolves a
 * collection/dataset through STAC and opens the result as an `EntityDataset`.
 *
 * These tests stub `resolveDatasetDetails` rather than the network. What is
 * being tested is the dispatch this method adds -- the layout guard, the
 * `columnKey` default, and the metadata it assembles -- not STAC resolution,
 * which `stac-server.test.ts` already covers against the live server.
 */
const resolved = (over: Record<string, unknown> = {}) => ({
  cid: "bafyr4ieoihgvnl5rvu6eh2fqduapjtz7wjp3e7kdtfxjospmavi5lgkoq4",
  collectionId: "noaa_ghcnd",
  dataset: "station_observations",
  variant: "default",
  zarrResolutions: [],
  layout: "tabular",
  commitId: "k1commit",
  streamId: "kjstream",
  versionLabel: "2026-08-26",
  ...over,
});

const stubResolution = (client: DClimateClient, over?: Record<string, unknown>) =>
  vi
    .spyOn(
      client as unknown as {
        resolveDatasetDetails: (...a: unknown[]) => unknown;
      },
      "resolveDatasetDetails"
    )
    .mockResolvedValue(resolved(over));

describe("client.loadEntities", () => {
  it("refuses a gridded dataset instead of handing its CID to the entity reader", async () => {
    // The failure mode this prevents: a Zarr CID opened as an entity dataset
    // dies inside a manifest parse as a corruption error, which sends the
    // caller looking at the publisher rather than at their own call.
    const client = new DClimateClient();
    stubResolution(client, { layout: "zarr" });

    await expect(
      client.loadEntities({
        request: { collection: "ecmwf_era5", dataset: "reanalysis" },
      })
    ).rejects.toThrow(/not an entity dataset.*loadDataset/s);
    await expect(
      client.loadEntities({
        request: { collection: "ecmwf_era5", dataset: "reanalysis" },
      })
    ).rejects.toThrow(DatasetNotFoundError);
  });

  it("refuses an item that declares no layout at all", async () => {
    // Absence is not permission. Entity support postdates `dclimate:layout`, so
    // an item without the field is a gridded one from before the convention --
    // there is no such thing as a legacy entity dataset to accommodate. Opening
    // it would hand a Zarr CID to the entity reader, which is the exact
    // misleading failure this guard exists to prevent.
    const client = new DClimateClient();
    stubResolution(client, { layout: undefined });
    const load = vi
      .spyOn(client.entities, "load")
      .mockResolvedValue({} as never);

    await expect(
      client.loadEntities({
        request: { collection: "ecmwf_era5", dataset: "reanalysis" },
      })
    ).rejects.toThrow(/is a 'gridded' dataset.*loadDataset/s);
    expect(load).not.toHaveBeenCalled();
  });

  it("defaults columnKey to the upper-case published names", async () => {
    // Without this the reader defaults to the schema's own lower-case field
    // names and `TMAX` -- the name every GHCND document uses -- is unknown.
    const client = new DClimateClient();
    stubResolution(client);
    const load = vi
      .spyOn(client.entities, "load")
      .mockResolvedValue({} as never);

    await client.loadEntities({
      request: { collection: "noaa_ghcnd", dataset: "station_observations" },
    });

    const { columnKey } = load.mock.calls[0]![0]!;
    expect(columnKey?.({ name: "tmax" } as never)).toBe("TMAX");
  });

  it("lets a caller override columnKey for a profile that differs", async () => {
    const client = new DClimateClient();
    stubResolution(client);
    const load = vi
      .spyOn(client.entities, "load")
      .mockResolvedValue({} as never);

    await client.loadEntities({
      request: {
        collection: "noaa_ndbc",
        dataset: "buoy_observations",
        columnKey: (field) => field.name,
      },
    });

    const { columnKey } = load.mock.calls[0]![0]!;
    expect(columnKey?.({ name: "SwH" } as never)).toBe("SwH");
  });

  it("returns the snapshot identity a caller needs to re-resolve this exact read", async () => {
    // The reason entity metadata carries these at all: a settlement or citation
    // has to be able to say which snapshot it ran against, not just "whatever
    // was newest that day".
    const client = new DClimateClient();
    stubResolution(client);
    vi.spyOn(client.entities, "load").mockResolvedValue({} as never);

    const [, metadata] = await client.loadEntities({
      request: { collection: "noaa_ghcnd", dataset: "station_observations" },
    });

    expect(metadata).toMatchObject({
      collection: "noaa_ghcnd",
      dataset: "station_observations",
      variant: "default",
      organization: "noaa",
      source: "stac",
      commitId: "k1commit",
      streamId: "kjstream",
      versionLabel: "2026-08-26",
    });
    expect(metadata.path).toBe("noaa_ghcnd-station_observations-default");
  });

  it("passes a per-request gateway through to the reader", async () => {
    const client = new DClimateClient({ gatewayUrl: "https://default.example" });
    stubResolution(client);
    const load = vi
      .spyOn(client.entities, "load")
      .mockResolvedValue({} as never);

    await client.loadEntities({
      request: { collection: "noaa_ghcnd", dataset: "station_observations" },
      options: { gatewayUrl: "https://override.example" },
    });

    expect(load.mock.calls[0]![0]!.gatewayUrl).toBe("https://override.example");
  });
});
