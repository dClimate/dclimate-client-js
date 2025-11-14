import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dataset } from "@dclimate/jaxray";
import { DClimateClient } from "../src/index.js";
import { DatasetNotFoundError } from "../src/errors.js";
import { HydrogenEndpoint } from "../src/datasets.js";

const openDatasetFromCidMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../src/ipfs/open-dataset.js", () => ({
  openDatasetFromCid: openDatasetFromCidMock,
  default: openDatasetFromCidMock,
}));

describe("loadDataset CID resolution", () => {
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

  describe("URL-backed variants", () => {
    it("fetches the CID from the configured endpoint", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          dataset: "AIFS-SINGLE-PRECIP",
          cid: "bafyfetch123",
        }),
      } as Response);

      const client = new DClimateClient();
      await client.loadDataset({ request: {
        collection: "aifs",
        dataset: "precipitation",
        variant: "single",
      }});

      expect(fetchMock).toHaveBeenCalledWith(
        `${HydrogenEndpoint}/aifs-single-precip`
      );
      expect(openDatasetFromCidMock).toHaveBeenCalledWith(
        "bafyfetch123",
        expect.any(Object)
      );
    });

    it("uses the slug as the metadata path regardless of the payload", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ cid: "bafyfetch456" }),
      } as Response);

      const client = new DClimateClient();
      const [dataset] = await client.loadDataset({ request: {
        collection: "aifs",
        dataset: "precipitation",
        variant: "single",
      }});

      if (dataset instanceof Dataset) {
        throw new Error("Expected GeoTemporalDataset");
      }

      expect(dataset.info.path).toBe("aifs-precipitation-single");
    });
  });

  describe("CID-backed variants", () => {
    it("skips fetching when CID is provided in the catalog", async () => {
      const client = new DClimateClient();
      await client.loadDataset({ request: {
        collection: "era5",
        dataset: "2m_temperature",
        variant: "finalized",
      }});

      expect(fetchMock).not.toHaveBeenCalled();
      expect(openDatasetFromCidMock).toHaveBeenCalledWith(
        "bafyr4iacuutc5bgmirkfyzn4igi2wys7e42kkn674hx3c4dv4wrgjp2k2u",
        expect.any(Object)
      );
    });

    it("normalizes variant names before lookup", async () => {
      const client = new DClimateClient();
      const [dataset] = await client.loadDataset({ request: {
        collection: "era5",
        dataset: "10m_v_wind",
        variant: "NON_FINALIZED",
      }});

      if (dataset instanceof Dataset) {
        throw new Error("Expected GeoTemporalDataset");
      }

      expect(dataset.info.path).toBe("era5-10m_v_wind-non-finalized");
      expect(dataset.info.variant).toBe("non-finalized");
    });
  });

  describe("variant selection", () => {
    it("uses the default variant when present", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ cid: "bafyifsdefault" }),
      } as Response);

      const client = new DClimateClient();
      const [dataset] = await client.loadDataset({ request: {
        collection: "ifs",
        dataset: "temperature",
      }});

      if (dataset instanceof Dataset) {
        throw new Error("Expected GeoTemporalDataset");
      }

      expect(dataset.info.variant).toBe("default");
    });

    it("throws when a variant is required but missing", async () => {
      const client = new DClimateClient();

      await expect(
        client.loadDataset({ request: { collection: "era5", dataset: "2m_temperature" } })
      ).rejects.toThrow('Dataset "2m_temperature" requires a variant to be specified.');
    });

    it("throws when the requested variant does not exist", async () => {
      const client = new DClimateClient();

      await expect(
        client.loadDataset({
          request: {
            collection: "ifs",
            dataset: "precipitation",
            variant: "ensemble",
          }
        })
      ).rejects.toThrow('Variant "ensemble" is not available for dataset "precipitation".');
    });
  });

  describe("error handling", () => {
    it("throws when the dataset is unknown", async () => {
      const client = new DClimateClient();

      await expect(
        client.loadDataset({ request: {
          collection: "aifs",
          dataset: "unknown",
          variant: "single",
        }})
      ).rejects.toThrow(DatasetNotFoundError);
    });

    it("throws when the HTTP endpoint returns an error", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      } as Response);

      const client = new DClimateClient();

      await expect(
        client.loadDataset({ request: {
          collection: "aifs",
          dataset: "precipitation",
          variant: "single",
        }})
      ).rejects.toThrow(
        `Dataset "aifs-precipitation-single" was not found at "${HydrogenEndpoint}/aifs-single-precip".`
      );
    });

    it("throws when the endpoint omits a CID", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ dataset: "AIFS-SINGLE-PRECIP" }),
      } as Response);

      const client = new DClimateClient();

      await expect(
        client.loadDataset({ request: {
          collection: "aifs",
          dataset: "precipitation",
          variant: "single",
        }})
      ).rejects.toThrow(
        `Dataset endpoint "${HydrogenEndpoint}/aifs-single-precip" did not provide a CID for "aifs-precipitation-single".`
      );
    });
  });

  describe("explicit CID option", () => {
    it("bypasses catalog resolution", async () => {
      const client = new DClimateClient();
      await client.loadDataset({ request: { dataset: "custom", }, options: { cid: "bafydirect" } });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(openDatasetFromCidMock).toHaveBeenCalledWith(
        "bafydirect",
        expect.any(Object)
      );
    });
  });
});
