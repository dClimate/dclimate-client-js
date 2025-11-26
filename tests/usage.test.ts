import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DClimateClient, GeoTemporalDataset } from "../src/index.js";
import {
  DEFAULT_IPFS_GATEWAY,
} from "../src/constants.js";
import { createMockDataset, SAMPLE_RECORDS } from "./helpers/fake-dataset.js";

const openDatasetFromCidMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../src/ipfs/open-dataset.js", () => ({
  openDatasetFromCid: openDatasetFromCidMock,
  default: openDatasetFromCidMock,
}));

describe("DClimateClient usage", () => {
  beforeEach(() => {
    // Don't mock fetch - let STAC resolve naturally
    openDatasetFromCidMock.mockReset();
    openDatasetFromCidMock.mockImplementation(async () => createMockDataset());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a dataset and supports point + time selection workflow", async () => {
    const client = new DClimateClient();

    const request = {
      collection: "aifs",
      dataset: "temperature",
      variant: "single",
    } as const;
    const [dataset, metadata] = await client.loadDataset({ request });

    // Check metadata (using STAC resolution now)
    expect(metadata.cid).toBeDefined();
    expect(metadata.cid).toMatch(/^bafy/); // Real CID from STAC
    expect(metadata.source).toBe("stac");
    // timestamp and url fields removed in STAC migration
    expect((metadata as any).timestamp).toBeUndefined();
    expect((metadata as any).url).toBeUndefined();

    const point = await (dataset as GeoTemporalDataset).point(40.75, -73.99);
    const slice = await point.timeRange({
      start: "2023-01-01T00:00:00Z",
      end: "2023-01-07T00:00:00Z",
    });
    const records = await slice.toRecords("precipitation");

    // STAC loads the catalog from real API (not mocked)

    expect(openDatasetFromCidMock).toHaveBeenCalledTimes(1);
    expect(openDatasetFromCidMock).toHaveBeenCalledWith(
      expect.stringMatching(/^bafy/), // Real CID from STAC
      expect.objectContaining({ gatewayUrl: DEFAULT_IPFS_GATEWAY })
    );

    expect(records).toHaveLength(3);
    expect(records.map((record) => record.value)).toEqual(
      SAMPLE_RECORDS.slice(0, 3).map((record) => record.value)
    );
    expect(records[0]).toMatchObject({
      latitude: 40.75,
      longitude: -73.99,
      time: "2023-01-01T00:00:00.000Z",
    });
    expect(slice.info.path).toBe("aifs-temperature-single");
    expect(slice.info.variant).toBe("single");
  });
});
