import { DataArray, Dataset } from "@dclimate/jaxray";
import { describe, expect, it } from "vitest";
import { NoDataFoundError } from "../../src/errors.ts";
import { GeoTemporalDataset } from "../../src/geotemporal-dataset.ts";
import type { DatasetMetadata } from "../../src/types.ts";

const metadata: DatasetMetadata = {
  dataset: "empty-dataset-regression",
  path: "empty-dataset-regression",
  cid: "bafy-empty-dataset-regression",
  source: "direct_cid",
  fetchedAt: new Date("2026-01-01T00:00:00Z"),
};

function createSpatialDataset(): GeoTemporalDataset {
  const dataset = new Dataset({
    temperature: new DataArray(
      [
        [20, 21],
        [22, 23],
      ],
      {
        dims: ["latitude", "longitude"],
        coords: {
          latitude: [40, 41],
          longitude: [-74, -73],
        },
      },
    ),
  });

  return new GeoTemporalDataset(dataset, metadata);
}

describe("GeoTemporalDataset empty Dataset regression", () => {
  it("treats a Dataset with no data variables as empty", () => {
    const empty = new GeoTemporalDataset(new Dataset({}), metadata);

    expect(empty.isEmpty()).toBe(true);
  });

  it("throws NoDataFoundError for a Dataset with no data variables", () => {
    const empty = new GeoTemporalDataset(new Dataset({}), metadata);

    expect(() => empty.ensureHasData()).toThrow(NoDataFoundError);
  });

  it("rejects an out-of-range bounds selection with NoDataFoundError", async () => {
    await expect(
      createSpatialDataset().select({
        bounds: [-80, 50, -79, 51],
      }),
    ).rejects.toThrow(NoDataFoundError);
  });
});
