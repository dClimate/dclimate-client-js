import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  resolveCidFromStacServer,
  resolveDatasetCidFromStacServer,
  listAvailableDatasetsFromStacServer,
  DEFAULT_STAC_SERVER_URL,
} from "../src/stac/stac-server.js";

const STAC_SERVER_URL = process.env.STAC_SERVER_URL ?? DEFAULT_STAC_SERVER_URL;

// Helper to check if STAC server is available
async function isStacServerAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${STAC_SERVER_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 1 }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Helper to get an available dataset from the server
async function getAvailableDataset(): Promise<{
  collection: string;
  dataset: string;
  variant: string | undefined;
  itemId: string;
} | null> {
  try {
    const response = await fetch(`${STAC_SERVER_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 10 }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const features = data.features || [];

    if (features.length === 0) return null;

    const item = features[0];
    const collection = item.collection;
    const itemId = item.id || "";
    const variant = item.properties?.["dclimate:variant"];

    // Extract dataset from item ID (format: {collection}-{dataset}-{variant})
    if (!collection || !itemId.startsWith(`${collection}-`)) return null;

    const remainder = itemId.slice(collection.length + 1);
    const parts = remainder.split("-");
    const dataset = parts[0];

    if (!dataset) return null;

    return { collection, dataset, variant, itemId };
  } catch {
    return null;
  }
}

describe("STAC Server", () => {
  let serverAvailable = false;
  let availableDataset: Awaited<ReturnType<typeof getAvailableDataset>> = null;

  beforeAll(async () => {
    serverAvailable = await isStacServerAvailable();
    if (serverAvailable) {
      availableDataset = await getAvailableDataset();
    }
  });

  describe("constants", () => {
    it("has correct default server URL", () => {
      expect(DEFAULT_STAC_SERVER_URL).toBe("https://api.stac.dclimate.net");
    });
  });

  describe("exact dataset matching", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function mockSearchResponse(features: unknown[]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            type: "FeatureCollection",
            features,
          }),
          text: async () => "",
        }))
      );
    }

    it("does not resolve a base ERA5 dataset to a *_land prefix collision", async () => {
      mockSearchResponse([
        {
          type: "Feature",
          id: "ecmwf_era5-precipitation_total_land-finalized",
          collection: "ecmwf_era5",
          properties: {
            "dclimate:dataset_id": "precipitation_total_land",
            "dclimate:variant": "finalized",
          },
          assets: {
            data: {
              href: "ipfs://bafy-era5-land-precip-finalized",
            },
          },
        },
        {
          type: "Feature",
          id: "ecmwf_era5-precipitation_total-finalized",
          collection: "ecmwf_era5",
          properties: {
            "dclimate:dataset_id": "precipitation_total",
            "dclimate:variant": "finalized",
          },
          assets: {
            data: {
              href: "ipfs://bafy-era5-precip-finalized",
            },
          },
        },
      ]);

      const result = await resolveCidFromStacServer(
        "ecmwf_era5",
        "precipitation_total",
        "finalized",
        "https://example.test"
      );

      expect(result.cid).toBe("bafy-era5-precip-finalized");
    });

    it("rejects a request when only a prefix-related land dataset exists", async () => {
      mockSearchResponse([
        {
          type: "Feature",
          id: "ecmwf_era5-wind_u_10m_land-finalized",
          collection: "ecmwf_era5",
          properties: {
            "dclimate:dataset_id": "wind_u_10m_land",
            "dclimate:variant": "finalized",
          },
          assets: {
            data: {
              href: "ipfs://bafy-era5-land-wind-u",
            },
          },
        },
      ]);

      await expect(
        resolveCidFromStacServer(
          "ecmwf_era5",
          "wind_u_10m",
          "finalized",
          "https://example.test"
        )
      ).rejects.toThrow(/No items found/);
    });

    it("keeps legacy item-id fallback exact", async () => {
      mockSearchResponse([
        {
          type: "Feature",
          id: "ecmwf_era5-temperature_2m_land-finalized",
          collection: "ecmwf_era5",
          properties: {
            "dclimate:variant": "finalized",
          },
          assets: {
            data: {
              href: "ipfs://bafy-era5-land-t2m",
            },
          },
        },
        {
          type: "Feature",
          id: "ecmwf_era5-temperature_2m-finalized",
          collection: "ecmwf_era5",
          properties: {
            "dclimate:variant": "finalized",
          },
          assets: {
            data: {
              href: "ipfs://bafy-era5-t2m",
            },
          },
        },
      ]);

      const result = await resolveCidFromStacServer(
        "ecmwf_era5",
        "temperature_2m",
        "finalized",
        "https://example.test"
      );

      expect(result.cid).toBe("bafy-era5-t2m");
    });
  });

  describe("resolveCidFromStacServer", () => {
    it("returns CID as string without ipfs:// prefix", async () => {
      if (!serverAvailable || !availableDataset) {
        console.log("Skipping: STAC server not available");
        return;
      }

      const result = await resolveCidFromStacServer(
        availableDataset.collection,
        availableDataset.dataset,
        undefined,
        STAC_SERVER_URL
      );

      expect(typeof result.cid).toBe("string");
      expect(result.cid.length).toBeGreaterThan(0);
      expect(result.cid).not.toMatch(/^ipfs:\/\//);
    });

    it("returns valid IPFS CID format", async () => {
      if (!serverAvailable || !availableDataset) {
        console.log("Skipping: STAC server not available");
        return;
      }

      const result = await resolveCidFromStacServer(
        availableDataset.collection,
        availableDataset.dataset,
        undefined,
        STAC_SERVER_URL
      );

      // IPFS CIDs typically start with these prefixes
      expect(result.cid).toMatch(/^(Qm|bafy|bafk|bafz|bafyr)/);
    });

    it("resolves with specific variant", async () => {
      if (!serverAvailable || !availableDataset || !availableDataset.variant) {
        console.log("Skipping: STAC server not available or no variant");
        return;
      }

      const result = await resolveCidFromStacServer(
        availableDataset.collection,
        availableDataset.dataset,
        availableDataset.variant,
        STAC_SERVER_URL
      );

      expect(result.cid).toBeDefined();
      expect(result.variant).toBe(availableDataset.variant);
    });

    it("resolves without variant specified", async () => {
      if (!serverAvailable || !availableDataset) {
        console.log("Skipping: STAC server not available");
        return;
      }

      const result = await resolveCidFromStacServer(
        availableDataset.collection,
        availableDataset.dataset,
        undefined,
        STAC_SERVER_URL
      );

      expect(result.cid).toBeDefined();
      expect(result.variant).toBeDefined();
    });

    it("returns correct metadata", async () => {
      if (!serverAvailable || !availableDataset) {
        console.log("Skipping: STAC server not available");
        return;
      }

      const result = await resolveCidFromStacServer(
        availableDataset.collection,
        availableDataset.dataset,
        undefined,
        STAC_SERVER_URL
      );

      expect(result.collectionId).toBe(availableDataset.collection);
      expect(result.dataset).toBe(availableDataset.dataset);
      expect(typeof result.variant).toBe("string");
    });

    it("throws error for invalid collection", async () => {
      if (!serverAvailable) {
        console.log("Skipping: STAC server not available");
        return;
      }

      await expect(
        resolveCidFromStacServer(
          "nonexistent_collection_xyz_12345",
          "nonexistent_dataset",
          undefined,
          STAC_SERVER_URL
        )
      ).rejects.toThrow(/No items found/);
    });

    it("throws error for invalid dataset", async () => {
      if (!serverAvailable || !availableDataset) {
        console.log("Skipping: STAC server not available");
        return;
      }

      await expect(
        resolveCidFromStacServer(
          availableDataset.collection,
          "nonexistent_dataset_xyz_12345",
          undefined,
          STAC_SERVER_URL
        )
      ).rejects.toThrow(/No items found/);
    });

    it("throws error for invalid variant", async () => {
      if (!serverAvailable || !availableDataset) {
        console.log("Skipping: STAC server not available");
        return;
      }

      await expect(
        resolveCidFromStacServer(
          availableDataset.collection,
          availableDataset.dataset,
          "nonexistent_variant_xyz_12345",
          STAC_SERVER_URL
        )
      ).rejects.toThrow(/Variant.*not found/);
    });

    it("returns consistent results across multiple calls", async () => {
      if (!serverAvailable || !availableDataset) {
        console.log("Skipping: STAC server not available");
        return;
      }

      const result1 = await resolveCidFromStacServer(
        availableDataset.collection,
        availableDataset.dataset,
        undefined,
        STAC_SERVER_URL
      );

      const result2 = await resolveCidFromStacServer(
        availableDataset.collection,
        availableDataset.dataset,
        undefined,
        STAC_SERVER_URL
      );

      expect(result1.cid).toBe(result2.cid);
    });
  });

  describe("resolveDatasetCidFromStacServer", () => {
    it("returns just the CID string", async () => {
      if (!serverAvailable || !availableDataset) {
        console.log("Skipping: STAC server not available");
        return;
      }

      const cid = await resolveDatasetCidFromStacServer(
        availableDataset.collection,
        availableDataset.dataset,
        undefined,
        STAC_SERVER_URL
      );

      expect(typeof cid).toBe("string");
      expect(cid.length).toBeGreaterThan(0);
      expect(cid).not.toMatch(/^ipfs:\/\//);
    });
  });

  describe("error handling", () => {
    it("throws on unreachable server", async () => {
      await expect(
        resolveCidFromStacServer(
          "any",
          "any",
          undefined,
          "http://127.0.0.1:59999"
        )
      ).rejects.toThrow();
    });
  });
});

describe("listAvailableDatasetsFromStacServer pagination", () => {
  it("follows rel=next instead of keeping only the first page", async () => {
    // The failure this guards: `/collections` paginates, and a single unpaged
    // request returns a well-formed but short list. The collections past the
    // first page are not missing anything obvious -- they simply arrive with no
    // title or organization, because this endpoint is the only source of both.
    // That surfaced as a parity test failing on the 11th collection of 14.
    const pages: Record<string, unknown> = {
      "https://stac.example/collections": {
        collections: [{ id: "a_one", title: "One" }],
        links: [{ rel: "next", href: "https://stac.example/collections?offset=1" }],
        numberMatched: 2,
        numberReturned: 1,
      },
      "https://stac.example/collections?offset=1": {
        collections: [{ id: "b_two", title: "Two" }],
        links: [],
        numberMatched: 2,
        numberReturned: 1,
      },
    };
    const seen: string[] = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        seen.push(url);
        if (url in pages) {
          return new Response(JSON.stringify(pages[url]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        // The concurrent item search; empty is enough to reach the assertions.
        return new Response(JSON.stringify({ features: [], links: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

    try {
      await listAvailableDatasetsFromStacServer("https://stac.example");
      expect(seen).toContain("https://stac.example/collections");
      expect(seen).toContain("https://stac.example/collections?offset=1");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("throws rather than following rel=next to another origin", async () => {
    // A `next` pointing off-origin would walk the client out of the server it
    // was configured with, so it is never followed. But it is not dropped
    // silently either: that would end the walk exactly like a server saying it
    // was finished, returning a truncated catalogue that looks whole. Refusing
    // the link keeps the boundary; throwing keeps the truncation visible.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url === "https://stac.example/collections") {
          return new Response(
            JSON.stringify({
              collections: [{ id: "a_one", title: "One" }],
              links: [{ rel: "next", href: "https://evil.example/collections" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.startsWith("https://evil.example")) {
          throw new Error(`followed next off-origin: ${url}`);
        }
        return new Response(JSON.stringify({ features: [], links: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

    try {
      await expect(
        listAvailableDatasetsFromStacServer("https://stac.example")
      ).rejects.toThrow(/configured server origin/);
      // The boundary held: the off-origin href was reported, never fetched.
      // (Had it been requested, the mock would have thrown its own error.)
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0] instanceof Request ? call[0].url : call[0]).startsWith(
            "https://evil.example"
          )
        )
      ).toBe(false);
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe("listAvailableDatasetsFromStacServer layout", () => {
  it("carries dclimate:layout onto each variant", async () => {
    // Without this the listing describes every dataset as the same kind, and a
    // caller can only discover that GHCND needs `loadEntities` rather than
    // `loadDataset` by opening it and being refused.
    const collections = {
      collections: [
        { id: "noaa_ghcnd", title: "GHCNd" },
        { id: "ecmwf_era5", title: "ERA5" },
      ],
    };
    const search = {
      features: [
        {
          id: "noaa_ghcnd-station_observations-default",
          collection: "noaa_ghcnd",
          properties: {
            "dclimate:dataset_id": "station_observations",
            "dclimate:variant": "default",
            "dclimate:layout": "tabular",
            "dclimate:latest_dataset_cid": "bafyrtabular",
          },
        },
        {
          id: "ecmwf_era5-precipitation_total-default",
          collection: "ecmwf_era5",
          properties: {
            "dclimate:dataset_id": "precipitation_total",
            "dclimate:variant": "default",
            "dclimate:layout": "zarr",
            "dclimate:latest_dataset_cid": "bafyrzarr",
          },
        },
      ],
      links: [],
    };

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        const body = url.includes("/collections") ? collections : search;
        void init;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

    try {
      const rows = await listAvailableDatasetsFromStacServer("https://stac.test");
      const layoutOf = (collection: string) =>
        rows
          .find((row) => row.collection === collection)
          ?.datasets[0]?.variants?.[0]?.layout;

      expect(layoutOf("noaa_ghcnd")).toBe("tabular");
      expect(layoutOf("ecmwf_era5")).toBe("zarr");
    } finally {
      fetchMock.mockRestore();
    }
  });
});
