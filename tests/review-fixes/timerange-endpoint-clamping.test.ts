import { DataArray, Dataset } from "@dclimate/jaxray";
import { describe, expect, it } from "vitest";
import { GeoTemporalDataset } from "../../src/geotemporal-dataset.ts";
import { InvalidSelectionError, NoDataFoundError } from "../../src/errors.ts";
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

function createNumericDataset(
  time: number[],
  coordAttrs?: Record<string, unknown>,
): GeoTemporalDataset {
  const dataset = new Dataset(
    {
      temperature: new DataArray(
        time.map((value) => value + 100),
        {
          dims: ["time"],
          coords: { time },
        },
      ),
    },
    coordAttrs ? { coordAttrs: { time: coordAttrs } } : undefined,
  );

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

  it("treats timezone-less datetime coordinates as UTC for inclusive endpoints", async () => {
    const datetimeCoords = [
      "2021-01-02T00:00:00",
      "2021-01-03T00:00:00",
      "2021-01-04T00:00:00",
    ];
    const dataset = new Dataset({
      temperature: new DataArray(values, {
        dims: ["time"],
        coords: { time: datetimeCoords },
      }),
    });

    const bareDateSelection = await new GeoTemporalDataset(
      dataset,
      metadata,
    ).timeRange({
      start: "2021-01-02",
      end: "2021-01-04",
    });
    const utcSelection = await new GeoTemporalDataset(
      dataset,
      metadata,
    ).timeRange({
      start: "2021-01-02T00:00:00Z",
      end: "2021-01-04T00:00:00Z",
    });

    expect(bareDateSelection.coords.time).toEqual(datetimeCoords);
    expect(utcSelection.coords.time).toEqual(datetimeCoords);
  });

  it("converts numeric CF coordinates to the endpoint date timeline", async () => {
    const cfCoords = Array.from({ length: 10 }, (_, index) => index);
    const dataset = () =>
      createNumericDataset(cfCoords, {
        units: "days since 1990-01-01",
        calendar: "standard",
      });

    const selected = await dataset().timeRange({
      start: "1990-01-04",
      end: "1990-01-06",
    });

    expect(selected.coords.time).toEqual([3, 4, 5]);
    expect(selected.getVariable("temperature").data).toEqual([103, 104, 105]);
    await expect(
      dataset().timeRange({
        start: "1970-01-01",
        end: "1970-01-02",
      }),
    ).rejects.toThrow(NoDataFoundError);
  });

  it("requires numeric endpoints for numeric coordinates without CF units", async () => {
    const numericCoords = [10, 20, 30];
    const selected = await createNumericDataset(numericCoords).timeRange({
      start: 15,
      end: 30,
    });

    expect(selected.coords.time).toEqual([20, 30]);
    await expect(
      createNumericDataset(numericCoords).timeRange({
        start: "2021-01-01",
        end: "2021-01-02",
      }),
    ).rejects.toThrow(InvalidSelectionError);
  });
});
