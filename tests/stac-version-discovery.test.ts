import { afterEach, describe, expect, it, vi } from "vitest";
import { DClimateClient } from "../src/client.js";
import { VersionHistoryUnavailableError } from "../src/errors.js";
import {
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
  "dclimate:default_zarr_group": "1",
};

const item = {
  type: "Feature" as const,
  stac_version: "1.0.0",
  id: "noaa_aigfs-wind_u_forecast-operational",
  collection: "noaa_aigfs",
  properties,
  geometry: null,
  assets: {
    data: {
      href: "ipfs://bafy-current",
      "dclimate:zarr_group": "/0/",
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
      zarrGroup: "/0/",
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
    expect(resolved.zarrGroup).toBe("/0/");
  });

  it("falls back to the item default when the data asset has no group", () => {
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
      ).zarrGroup
    ).toBe("1");
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
  });
});
