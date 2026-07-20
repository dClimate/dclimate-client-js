import { DataArray, Dataset } from "@dclimate/jaxray";
import { describe, expect, it } from "vitest";
import { GeoTemporalDataset } from "../../src/geotemporal-dataset.ts";
import type { DatasetMetadata } from "../../src/types.ts";

const metadata: DatasetMetadata = {
  dataset: "cf-calendar",
  path: "cf-calendar",
  cid: "bafy-cf-calendar",
  source: "direct_cid",
  fetchedAt: new Date("1990-01-01T00:00:00Z"),
};

function calendarDataset(
  time: number[],
  units: string,
  calendar: string,
): GeoTemporalDataset {
  const dataset = new Dataset(
    {
      temperature: new DataArray(
        time.map((value) => value + 100),
        { dims: ["time"], coords: { time } },
      ),
    },
    { coordAttrs: { time: { units, calendar } } },
  );

  return new GeoTemporalDataset(dataset, metadata);
}

// In a 360_day calendar with "days since 1990-01-01": days 30..59 map to
// Feb 1..30 (Feb 30 exists in this calendar), day 60 = Mar 1. Days 58 and 59
// decode to Feb 29 / Feb 30 — dates JS Date cannot represent, which previously
// made cfTimeToDate return null and every timeRange() call throw, even for
// ranges that excluded them. Comparison now runs on the CF ordinal timeline.
describe("GeoTemporalDataset.timeRange() on non-Gregorian calendars", () => {
  const units = "days since 1990-01-01";
  const calendar = "360_day";

  it("selects a range spanning dates JS Date cannot represent (Feb 29/30)", async () => {
    const selected = await calendarDataset([58, 59, 60], units, calendar).timeRange({
      start: "1990-02-01",
      end: "1990-03-01",
    });

    expect(selected.coords.time).toEqual([58, 59, 60]);
    expect(selected.getVariable("temperature").data).toEqual([158, 159, 160]);
  });

  it("resolves a range that excludes the unrepresentable coordinates", async () => {
    const selected = await calendarDataset([58, 59, 60], units, calendar).timeRange({
      start: "1990-03-01",
      end: "1990-03-10",
    });

    expect(selected.coords.time).toEqual([60]);
    expect(selected.getVariable("temperature").data).toEqual([160]);
  });

  it("accepts raw numeric CF ordinals as range endpoints", async () => {
    const selected = await calendarDataset([58, 59, 60], units, calendar).timeRange({
      start: 59,
      end: 60,
    });

    expect(selected.coords.time).toEqual([59, 60]);
  });
});
