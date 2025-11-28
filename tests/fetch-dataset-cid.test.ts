import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dataset } from "@dclimate/jaxray";
import { DClimateClient } from "../src/index.js";
import { StacResolutionError } from "../src/stac/index.js";

const openDatasetFromCidMock = vi.hoisted(() => vi.fn());

vi.mock("../src/ipfs/open-dataset.js", () => ({
  openDatasetFromCid: openDatasetFromCidMock,
  default: openDatasetFromCidMock,
}));

describe("loadDataset CID resolution", () => {
  beforeEach(() => {
    openDatasetFromCidMock.mockReset();
    openDatasetFromCidMock.mockResolvedValue({
      get: vi.fn(),
      keys: vi.fn().mockReturnValue([]),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("STAC catalog resolution", () => {
    it("resolves CID from STAC for known dataset", async () => {
      const client = new DClimateClient();
      await client.loadDataset({
        request: {
          collection: "era5",
          organization: "ecmwf",
          dataset: "temperature_2m",
          variant: "finalized",
        },
      });

      // Should have called openDatasetFromCid with a real CID from STAC
      expect(openDatasetFromCidMock).toHaveBeenCalledWith(
        expect.stringMatching(/^bafy/), // IPFS CID pattern
        expect.any(Object)
      );
    });

    it("uses correct metadata path from STAC", async () => {
      const client = new DClimateClient();
      const [dataset] = await client.loadDataset({
        request: {
          collection: "era5",
          organization: "ecmwf",
          dataset: "temperature_2m",
          variant: "finalized",
        },
      });

      if (dataset instanceof Dataset) {
        throw new Error("Expected GeoTemporalDataset");
      }

      expect(dataset.info.path).toBe("ecmwf_era5-temperature_2m-finalized");
      expect(dataset.info.collection).toBe("ecmwf_era5");
      expect(dataset.info.dataset).toBe("temperature_2m");
      expect(dataset.info.variant).toBe("finalized");
      expect(dataset.info.organization).toBe("ecmwf");
    });

    it("resolves single variant when no variant specified and only one exists", async () => {
      const client = new DClimateClient();
      const [dataset] = await client.loadDataset({
        request: {
          collection: "era5",
          organization: "ecmwf",
          dataset: "precipitation_total_land",
        },
      });

      if (dataset instanceof Dataset) {
        throw new Error("Expected GeoTemporalDataset");
      }

      expect(dataset.info.collection).toBe("ecmwf_era5");
      expect(dataset.info.dataset).toBe("precipitation_total_land");
      expect(dataset.info.variant).toBeDefined();
      expect(openDatasetFromCidMock).toHaveBeenCalled();
    });

    it("throws when collection not found", async () => {
      const client = new DClimateClient();

      await expect(
        client.loadDataset({
          request: {
            collection: "unknown_collection",
            organization: "ecmwf",
            dataset: "test",
            variant: "test",
          },
        })
      ).rejects.toThrow(StacResolutionError);
    });

    it("throws when dataset not found", async () => {
      const client = new DClimateClient();

      await expect(
        client.loadDataset({
          request: {
            collection: "era5",
            organization: "ecmwf",
            dataset: "unknown_dataset",
            variant: "test",
          },
        })
      ).rejects.toThrow(StacResolutionError);
    });

    it("throws when variant not found", async () => {
      const client = new DClimateClient();

      await expect(
        client.loadDataset({
          request: {
            collection: "era5",
            organization: "ecmwf",
            dataset: "temperature_2m",
            variant: "unknown_variant",
          },
        })
      ).rejects.toThrow(StacResolutionError);
    });
  });

  describe("explicit CID option", () => {
    it("bypasses catalog resolution", async () => {
      const client = new DClimateClient();
      await client.loadDataset({
        request: { dataset: "custom" },
        options: { cid: "bafydirect" },
      });

      expect(openDatasetFromCidMock).toHaveBeenCalledWith(
        "bafydirect",
        expect.any(Object)
      );
    });

    it("sets source to direct_cid in metadata", async () => {
      const client = new DClimateClient();
      const [dataset] = await client.loadDataset({
        request: { dataset: "custom" },
        options: { cid: "bafydirect" },
      });

      if (dataset instanceof Dataset) {
        throw new Error("Expected GeoTemporalDataset");
      }

      expect(dataset.info.source).toBe("direct_cid");
      expect(dataset.info.cid).toBe("bafydirect");
    });
  });
});
