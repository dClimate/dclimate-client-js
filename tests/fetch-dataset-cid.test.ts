import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DClimateClient } from "../src/index.js";
import { DatasetNotFoundError } from "../src/errors.js";
import { HydrogenEndpoint } from "../src/datasets.js";

const openDatasetFromCidMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../src/ipfs/open-dataset.js", () => ({
  openDatasetFromCid: openDatasetFromCidMock,
  default: openDatasetFromCidMock,
}));

describe("fetchDatasetCid (via loadDataset)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    openDatasetFromCidMock.mockReset();
    openDatasetFromCidMock.mockResolvedValue({
      get: vi.fn(),
      keys: vi.fn().mockReturnValue([]),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  describe("successful CID fetching", () => {
    it("fetches CID successfully for valid dataset", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          dataset: "fpar",
          cid: "bafybeiabc123",
          timestamp: Date.now(),
        }),
      } as Response);

      const client = new DClimateClient();
      await client.loadDataset({ dataset: "fpar" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(`${HydrogenEndpoint}/fpar`);
      expect(openDatasetFromCidMock).toHaveBeenCalledWith(
        "bafybeiabc123",
        expect.any(Object)
      );
    });

    it("trims whitespace from CID", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          dataset: "ifs-precip",
          cid: "  bafybeiabc456  ",
          timestamp: Date.now(),
        }),
      } as Response);

      const client = new DClimateClient();
      await client.loadDataset({ dataset: "ifs-precip" });

      expect(openDatasetFromCidMock).toHaveBeenCalledWith(
        "bafybeiabc456",
        expect.any(Object)
      );
    });

    it("uses dataset key as path when payload.dataset is missing", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          cid: "bafybeiabc789",
          timestamp: Date.now(),
        }),
      } as Response);

      const client = new DClimateClient();
      const dataset = await client.loadDataset({ dataset: "aifs-single-precip" });

      expect(dataset.info.path).toBe("aifs-single-precip");
    });

    it("normalizes resolved path from payload to lowercase", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          dataset: "  AIFS-SINGLE-PRECIP  ",
          cid: "bafybeiabc999",
          timestamp: Date.now(),
        }),
      } as Response);

      const client = new DClimateClient();
      const dataset = await client.loadDataset({ dataset: "aifs-single-precip" });

      expect(dataset.info.path).toBe("aifs-single-precip");
    });
  });

  describe("error handling - invalid dataset key", () => {
    it("throws error for unregistered dataset key", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ cid: "bafytest", dataset: "unknown" }),
      } as Response);

      const client = new DClimateClient();

      await expect(
        client.loadDataset({ dataset: "invalid-dataset-key" })
      ).rejects.toThrow(DatasetNotFoundError);

      await expect(
        client.loadDataset({ dataset: "invalid-dataset-key" })
      ).rejects.toThrow('Dataset "invalid-dataset-key" is not registered in the dataset map.');
    });
  });

  describe("error handling - HTTP errors", () => {
    it("throws error when endpoint returns 404", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      } as Response);

      const client = new DClimateClient();

      await expect(
        client.loadDataset({ dataset: "fpar" })
      ).rejects.toThrow(DatasetNotFoundError);

      await expect(
        client.loadDataset({ dataset: "fpar" })
      ).rejects.toThrow(`Dataset "fpar" was not found at "${HydrogenEndpoint}/fpar".`);
    });

    it("throws error for non-404 HTTP errors", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      const client = new DClimateClient();

      await expect(
        client.loadDataset({ dataset: "ifs-temperature" })
      ).rejects.toThrow(DatasetNotFoundError);

      await expect(
        client.loadDataset({ dataset: "ifs-temperature" })
      ).rejects.toThrow('Failed to fetch dataset "ifs-temperature" (status 500).');
    });

    it("throws error for 403 Forbidden", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({}),
      } as Response);

      const client = new DClimateClient();

      await expect(
        client.loadDataset({ dataset: "aifs-ensemble-temperature" })
      ).rejects.toThrow('Failed to fetch dataset "aifs-ensemble-temperature" (status 403).');
    });
  });

  describe("error handling - missing or invalid CID", () => {
    it("throws error when CID is missing from response", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          dataset: "fpar",
          timestamp: Date.now(),
        }),
      } as Response);

      const client = new DClimateClient();

      await expect(
        client.loadDataset({ dataset: "fpar" })
      ).rejects.toThrow(DatasetNotFoundError);

      await expect(
        client.loadDataset({ dataset: "fpar" })
      ).rejects.toThrow(`Dataset endpoint "${HydrogenEndpoint}/fpar" did not provide a CID for "fpar".`);
    });

    it("throws error when CID is empty string", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          dataset: "ifs-precip",
          cid: "",
          timestamp: Date.now(),
        }),
      } as Response);

      const client = new DClimateClient();

      await expect(
        client.loadDataset({ dataset: "ifs-precip" })
      ).rejects.toThrow(DatasetNotFoundError);

      await expect(
        client.loadDataset({ dataset: "ifs-precip" })
      ).rejects.toThrow('did not provide a CID for "ifs-precip"');
    });

    it("throws error when CID is whitespace only", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          dataset: "aifs-single-wind-u",
          cid: "   ",
          timestamp: Date.now(),
        }),
      } as Response);

      const client = new DClimateClient();

      await expect(
        client.loadDataset({ dataset: "aifs-single-wind-u" })
      ).rejects.toThrow('did not provide a CID for "aifs-single-wind-u"');
    });
  });

  describe("bypassing fetchDatasetCid with cid option", () => {
    it("skips fetch when CID is provided directly", async () => {
      const client = new DClimateClient();
      await client.loadDataset(
        { dataset: "fpar" },
        { cid: "bafydirect123" }
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(openDatasetFromCidMock).toHaveBeenCalledWith(
        "bafydirect123",
        expect.any(Object)
      );
    });
  });
});
