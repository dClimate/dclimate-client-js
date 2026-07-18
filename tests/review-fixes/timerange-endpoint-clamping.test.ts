import { DataArray, Dataset } from "@dclimate/jaxray";
import { describe, expect, it } from "vitest";
import { GeoTemporalDataset } from "../../src/geotemporal-dataset.ts";
import { NoDataFoundError } from "../../src/errors.ts";
import type { DatasetMetadata } from "../../src/types.ts";

const times = ["2021-01-02", "2021-01-03", "2021-01-04"];
const values = [12, 13, 14];

const metadata: DatasetMetadata = {
  dataset: "time-range-clamping",
  path: "time-range-clamping",
  cid: "bafy-time-range-clamping",
  source: "direct_cid",
  fetchedAt: new Date("2021-01-01T00:00:00Z"),
};

function createDataset(): GeoTemporalDataset {
  const dataset = new Dataset({
    temperature: new DataArray(values, {
      dims: ["time"],
      coords: { time: times },
    }),
  });

  return new GeoTemporalDataset(dataset, metadata);
}

describe("GeoTemporalDataset.timeRange() endpoint clamping", () => {
  it("clamps both requested endpoints to the available time axis", async () => {
    const selected = await createDataset().timeRange({
      start: "2021-01-01",
      end: "2021-01-05",
    });

    expect(selected.coords.time).toEqual(times);
    expect(selected.getVariable("temperature").data).toEqual(values);
  });

  it("clamps an end after the available time axis", async () => {
    const selected = await createDataset().timeRange({
      start: "2021-01-03",
      end: "2021-01-05",
    });

    expect(selected.coords.time).toEqual(["2021-01-03", "2021-01-04"]);
    expect(selected.getVariable("temperature").data).toEqual([13, 14]);
  });

  it("reports no data when the requested range is entirely before the time axis", async () => {
    await expect(
      createDataset().timeRange({
        start: "2020-06-01",
        end: "2020-06-05",
      }),
    ).rejects.toThrow(NoDataFoundError);
  });
});
