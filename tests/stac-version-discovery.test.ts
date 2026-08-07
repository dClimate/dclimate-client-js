import { afterEach, describe, expect, it, vi } from "vitest";
import { DClimateClient } from "../src/client.js";
import { VersionHistoryUnavailableError } from "../src/errors.js";
import { VersionApiError } from "../src/errors.js";
import {
  getStacZarrResolutions,
  resolveDatasetFromStac,
  type StacCatalog,
} from "../src/stac/stac-catalog.js";
import { resolveCidFromStacServer } from "../src/stac/stac-server.js";

const properties = {
  "dclimate:dataset_id": "wind_u_forecast",
  "dclimate:variant": "operational",
  "dclimate:versions_api":
    "https://hydrogen.dclimate.net/api/datasets/aigfs-wind-u/versions",
  "dclimate:provenance_api":
    "https://hydrogen.dclimate.net/api/datasets/aigfs-wind-u/versions/commit-1",
  "dclimate:citation_api":
    "https://hydrogen.dclimate.net/api/datasets/aigfs-wind-u/citation?commitId=commit-1",
  "dclimate:stream_id": "stream-1",
  "dclimate:commit_id": "commit-1",
  "dclimate:version_label": "2026-08",
  "dclimate:is_citable": true,
  "dclimate:retention_class": "permanent",
};

const item = {
  type: "Feature" as const,
  stac_version: "1.0.0",
  id: "noaa_aigfs-wind_u_forecast-operational",
  collection: "noaa_aigfs",
  properties,
  geometry: null,
  assets: {
    "data-500m": {
      href: "ipfs://bafy-current",
      "dclimate:zarr_group": "0",
      "dclimate:spatial_resolution": "500m",
    },
  },
  links: [],
};

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => "",
  } as Response;
}

describe("STAC release discovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([true, false])(
    "treats transitional data alias=%s as three choices",
    (includeAlias) => {
      const namedAssets = {
        "data-500m": {
          href: "ipfs://bafy-fpar",
          "dclimate:zarr_group": "0",
          "dclimate:spatial_resolution": "500m",
        },
        "data-2km": {
          href: "ipfs://bafy-fpar",
          "dclimate:zarr_group": "1",
          "dclimate:spatial_resolution": "2km",
        },
        "data-8km": {
          href: "ipfs://bafy-fpar",
          "dclimate:zarr_group": "2",
          "dclimate:spatial_resolution": "8km",
        },
      };
      const assets = includeAlias
        ? { data: { ...namedAssets["data-500m"] }, ...namedAssets }
        : namedAssets;

      expect(getStacZarrResolutions(assets)).toHaveLength(3);
    }
  );

  it("rejects selectable resolution assets with different CIDs", () => {
    expect(() =>
      getStacZarrResolutions({
        "data-500m": {
          href: "ipfs://bafy-fpar-500m",
          "dclimate:zarr_group": "0",
          "dclimate:spatial_resolution": "500m",
        },
        "data-2km": {
          href: "ipfs://bafy-fpar-2km",
          "dclimate:zarr_group": "1",
          "dclimate:spatial_resolution": "2km",
        },
      })
    ).toThrow("Selectable resolution assets must use the same dataset CID");
  });

  it("extracts release metadata from the hosted STAC server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({ type: "FeatureCollection", features: [item], links: [] })
      )
    );

    const resolved = await resolveCidFromStacServer(
      "noaa_aigfs",
      "wind_u_forecast",
      "operational",
      "https://stac.test"
    );

    expect(resolved).toMatchObject({
      cid: "bafy-current",
      versionsApi: properties["dclimate:versions_api"],
      commitId: "commit-1",
      isCitable: true,
      retentionClass: "permanent",
      zarrResolutions: [
        { assetKey: "data-500m", resolution: "500m", group: "0" },
      ],
    });
  });

  it("extracts equivalent metadata from the IPFS STAC representation", () => {
    const catalog: StacCatalog = {
      type: "Catalog",
      stac_version: "1.0.0",
      id: "root",
      links: [],
      collections: [
        {
          type: "Collection",
          stac_version: "1.0.0",
          id: "noaa_aigfs",
          organizationId: "noaa",
          links: [],
          items: [item],
        },
      ],
    };

    const resolved = resolveDatasetFromStac(
      catalog,
      "noaa_aigfs",
      "wind_u_forecast",
      "operational",
      "noaa"
    );

    expect(resolved.versionsApi).toBe(properties["dclimate:versions_api"]);
    expect(resolved.provenanceApi).toBe(properties["dclimate:provenance_api"]);
    expect(resolved.citationApi).toBe(properties["dclimate:citation_api"]);
    expect(resolved.zarrResolutions).toEqual([
      { assetKey: "data-500m", resolution: "500m", group: "0" },
    ]);
  });

  it("keeps flat data assets ungrouped", () => {
    const unannotatedAssetItem = {
      ...item,
      assets: { data: { href: "ipfs://bafy-current" } },
    };
    const catalog: StacCatalog = {
      type: "Catalog",
      stac_version: "1.0.0",
      id: "root",
      links: [],
      collections: [
        {
          type: "Collection",
          stac_version: "1.0.0",
          id: "noaa_aigfs",
          organizationId: "noaa",
          links: [],
          items: [unannotatedAssetItem],
        },
      ],
    };

    expect(
      resolveDatasetFromStac(
        catalog,
        "noaa_aigfs",
        "wind_u_forecast",
        "operational",
        "noaa"
      ).zarrResolutions
    ).toEqual([]);
  });

  it("lists versions using the full URL advertised by STAC", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === "https://stac.test/search") {
        return response({ type: "FeatureCollection", features: [item], links: [] });
      }
      if (url.startsWith(properties["dclimate:versions_api"])) {
        return response({ dataset: "aigfs-wind-u", versions: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new DClimateClient({ stacServerUrl: "https://stac.test" });

    const result = await client.listDatasetVersions({
      collection: "noaa_aigfs",
      dataset: "wind_u_forecast",
      variant: "operational",
      filters: { anchored: true },
    });

    expect(result.dataset).toBe("aigfs-wind-u");
    expect(fetchMock.mock.calls[1][0].toString()).toBe(
      `${properties["dclimate:versions_api"]}?anchored=true`
    );
  });

  it.each([
    "https://hydrogen.dclimate.net/api/datasets/aigfs-wind-u/versions",
    "https://tritium.dclimate.net/api/datasets/aigfs-wind-u/versions",
  ])("gets an exact version through the STAC-directed service %s", async (versionsApi) => {
    const commitId = "commit/with spaces?and=query#fragment";
    const routedItem = {
      ...item,
      properties: { ...properties, "dclimate:versions_api": versionsApi },
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === "https://stac.test/search") {
        return response({
          type: "FeatureCollection",
          features: [routedItem],
          links: [],
        });
      }
      return response({ dataset: "aigfs-wind-u", cid: "bafy-exact" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new DClimateClient({ stacServerUrl: "https://stac.test" });

    const result = await client.getDatasetVersion({
      collection: "noaa_aigfs",
      dataset: "wind_u_forecast",
      variant: "operational",
      commitId,
    });

    expect(result.cid).toBe("bafy-exact");
    expect(fetchMock.mock.calls[1][0].toString()).toBe(
      `${versionsApi}/commit%2Fwith%20spaces%3Fand%3Dquery%23fragment`
    );
  });

  it("propagates exact-version service errors", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (input.toString() === "https://stac.test/search") {
        return response({ type: "FeatureCollection", features: [item], links: [] });
      }
      return {
        ...response({ detail: "unavailable" }),
        ok: false,
        status: 503,
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new DClimateClient({ stacServerUrl: "https://stac.test" });

    await expect(
      client.getDatasetVersion({
        collection: "noaa_aigfs",
        dataset: "wind_u_forecast",
        variant: "operational",
        commitId: "commit-1",
      })
    ).rejects.toMatchObject<Partial<VersionApiError>>({ status: 503 });
  });

  it("reports when a STAC item has no version-history capability", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          type: "FeatureCollection",
          features: [{ ...item, properties: {
            "dclimate:dataset_id": "wind_u_forecast",
            "dclimate:variant": "operational",
          } }],
          links: [],
        })
      )
    );
    const client = new DClimateClient({ stacServerUrl: "https://stac.test" });

    await expect(
      client.listDatasetVersions({
        collection: "noaa_aigfs",
        dataset: "wind_u_forecast",
        variant: "operational",
      })
    ).rejects.toBeInstanceOf(VersionHistoryUnavailableError);

    await expect(
      client.getDatasetVersion({
        collection: "noaa_aigfs",
        dataset: "wind_u_forecast",
        variant: "operational",
        commitId: "commit-1",
      })
    ).rejects.toBeInstanceOf(VersionHistoryUnavailableError);
  });
});
