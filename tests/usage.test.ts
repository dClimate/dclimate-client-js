import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DClimateClient } from "../src/index.js";
import {
  DEFAULT_IPFS_GATEWAY,
} from "../src/constants.js";
import { createMockDataset, SAMPLE_RECORDS } from "./helpers/fake-dataset.js";
import { HydrogenEndpoint } from "../src/datasets.js";

const openDatasetFromCidMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../src/ipfs/open-dataset.js", () => ({
  openDatasetFromCid: openDatasetFromCidMock,
  default: openDatasetFromCidMock,
}));

describe("DClimateClient usage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        dataset: "aifs-ensemble-temperature",
        cid: "bafy-ensemble-cid",
        timestamp: 1761003843556,
      }),
    } as Response);

    openDatasetFromCidMock.mockReset();
    openDatasetFromCidMock.mockImplementation(async () => createMockDataset());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a dataset and supports point + time selection workflow", async () => {
    const client = new DClimateClient();

    const datasetName = "aifs-ensemble-temperature";
    const dataset = await client.loadDataset({ dataset: datasetName });
    const point = await dataset.point(40.75, -73.99);
    const slice = await point.timeRange({
      start: "2023-01-01T00:00:00Z",
      end: "2023-01-07T00:00:00Z",
    });
    const records = await slice.toRecords("precipitation");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${HydrogenEndpoint}/${datasetName}`
    );

    expect(openDatasetFromCidMock).toHaveBeenCalledTimes(1);
    expect(openDatasetFromCidMock).toHaveBeenCalledWith(
      "bafy-ensemble-cid",
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
    expect(slice.info.path).toBe(datasetName);
  });
});
