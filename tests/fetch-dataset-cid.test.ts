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
          dataset: "2m_temperature",
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
          dataset: "2m_temperature",
          variant: "finalized",
        },
      });

      if (dataset instanceof Dataset) {
        throw new Error("Expected GeoTemporalDataset");
      }

      expect(dataset.info.path).toBe("era5-2m_temperature-finalized");
      expect(dataset.info.collection).toBe("era5");
      expect(dataset.info.dataset).toBe("2m_temperature");
      expect(dataset.info.variant).toBe("finalized");
    });

    it("resolves single variant when no variant specified and only one exists", async () => {
      const client = new DClimateClient();
      const [dataset] = await client.loadDataset({
        request: {
          collection: "ifs",
          dataset: "temperature",
        },
      });

      if (dataset instanceof Dataset) {
        throw new Error("Expected GeoTemporalDataset");
      }

      // Should resolve to the single available variant
      expect(dataset.info.collection).toBe("ifs");
      expect(dataset.info.dataset).toBe("temperature");
      expect(openDatasetFromCidMock).toHaveBeenCalled();
    });

    it("throws when collection not found", async () => {
      const client = new DClimateClient();

      await expect(
        client.loadDataset({
          request: {
            collection: "unknown_collection",
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
            dataset: "2m_temperature",
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
