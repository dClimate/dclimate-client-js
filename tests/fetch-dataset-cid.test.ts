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
    it("uses the STAC data asset group unless the caller overrides it", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            type: "FeatureCollection",
            links: [],
            features: [
              {
                type: "Feature",
                id: "test_grouped-pyramid-default",
                collection: "test_grouped",
                properties: {
                  "dclimate:dataset_id": "pyramid",
                  "dclimate:variant": "default",
                  "dclimate:default_zarr_group": "1",
                },
                assets: {
                  data: {
                    href: "ipfs://bafygrouped",
                    "dclimate:zarr_group": "/0/",
                  },
                },
              },
            ],
          }),
        }))
      );
      const client = new DClimateClient({ stacServerUrl: "https://stac.test" });

      const [, discoveredMetadata] = await client.loadDataset({
        request: { collection: "test_grouped", dataset: "pyramid" },
      });
      expect(openDatasetFromCidMock).toHaveBeenLastCalledWith(
        "bafygrouped",
        expect.objectContaining({ zarrGroup: "0" })
      );
      expect(discoveredMetadata.zarrGroup).toBe("0");

      const [, overriddenMetadata] = await client.loadDataset({
        request: { collection: "test_grouped", dataset: "pyramid" },
        options: { zarrGroup: "/2/" },
      });
      expect(openDatasetFromCidMock).toHaveBeenLastCalledWith(
        "bafygrouped",
        expect.objectContaining({ zarrGroup: "2" })
      );
      expect(overriddenMetadata.zarrGroup).toBe("2");
    });

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
          dataset: "precipitation_total",
        },
      });

      if (dataset instanceof Dataset) {
        throw new Error("Expected GeoTemporalDataset");
      }

      expect(dataset.info.collection).toBe("ecmwf_era5");
      expect(dataset.info.dataset).toBe("precipitation_total");
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
        request: { cid: "bafydirect" },
      });

      expect(openDatasetFromCidMock).toHaveBeenCalledWith(
        "bafydirect",
        expect.any(Object)
      );
    });

    it("passes zarrGroup through and records it in metadata", async () => {
      const client = new DClimateClient();
      const [, metadata] = await client.loadDataset({
        request: { cid: "bafygrouped" },
        options: { zarrGroup: "/0/" },
      });

      expect(openDatasetFromCidMock).toHaveBeenCalledWith(
        "bafygrouped",
        expect.objectContaining({ zarrGroup: "0" })
      );
      expect(metadata.zarrGroup).toBe("0");
    });

    it("passes sparse shard decoding through to the dataset opener", async () => {
      const client = new DClimateClient();
      await client.loadDataset({
        request: { cid: "bafysparse" },
        options: { shardReadMode: "sparse" },
      });

      expect(openDatasetFromCidMock).toHaveBeenCalledWith(
        "bafysparse",
        expect.objectContaining({ shardReadMode: "sparse" })
      );
    });

    it("sets source to direct_cid in metadata", async () => {
      const client = new DClimateClient();
      const [dataset] = await client.loadDataset({
        request: { cid: "bafydirect" },
      });

      if (dataset instanceof Dataset) {
        throw new Error("Expected GeoTemporalDataset");
      }

      expect(dataset.info.source).toBe("direct_cid");
      expect(dataset.info.cid).toBe("bafydirect");
    });
  });
});
