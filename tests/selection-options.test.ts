import { describe, expect, it } from "vitest";
import { GeoTemporalDataset } from "../src/index.js";
import { InvalidSelectionError } from "../src/errors.js";
import { createMockDataset } from "./helpers/fake-dataset.js";
import type { DatasetMetadata } from "../src/index.js";

const metadata: DatasetMetadata = {
  dataset: "precipitation",
  collection: "test",
  variant: "default",
  organization: "dclimate",
  path: "test-precipitation-default",
  cid: "bafy-test",
  source: "direct_cid",
  fetchedAt: new Date("2024-01-01T00:00:00Z"),
};

describe("GeoSelectionOptions", () => {
  it("supports bounds and time range selections in one call", async () => {
    const dataset = new GeoTemporalDataset(
      createMockDataset() as never,
      metadata,
    );

    const selected = await dataset.select({
      bounds: [-75, 40, -73, 41],
      timeRange: {
        start: "2023-01-01T00:00:00Z",
        end: "2023-01-04T00:00:00Z",
      },
    });

    const records = await selected.toRecords("precipitation");

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.value)).toEqual([10, 12]);
  });

  it("supports object bounds with coordinate key options", async () => {
    const dataset = new GeoTemporalDataset(
      createMockDataset() as never,
      metadata,
    );

    const selected = await dataset.select({
      bounds: {
        west: -75,
        south: 40,
        east: -73,
        north: 41,
        options: {
          latitudeKey: "latitude",
          longitudeKey: "longitude",
        },
      },
    });

    const records = await selected.toRecords("precipitation");

    expect(records).toHaveLength(3);
    expect(records.every((record) => record.longitude === -73.99)).toBe(true);
  });

  it("rejects ambiguous point and bounds selections", async () => {
    const dataset = new GeoTemporalDataset(
      createMockDataset() as never,
      metadata,
    );

    await expect(
      dataset.select({
        bounds: [-75, 40, -73, 41],
        point: {
          latitude: 40.75,
          longitude: -73.99,
        },
      }),
    ).rejects.toThrow(InvalidSelectionError);
  });
});
