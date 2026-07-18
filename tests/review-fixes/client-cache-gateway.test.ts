import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DClimateClient } from "../../src/index.js";
import type { IpfsElements } from "../../src/types.js";

const openDatasetFromCidMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/ipfs/open-dataset.js", () => ({
  openDatasetFromCid: openDatasetFromCidMock,
  default: openDatasetFromCidMock,
}));

const gatewayA = "https://gateway-a.client-cache.test";
const gatewayB = "https://gateway-b.client-cache.test";
const rootCatalogCid = "bafy-client-cache-root";
const organization = "testorg";
const collection = "testorg_weather";
const dataset = "temperature";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as Response;
}

function catalogDocuments(gatewayUrl: string, dataCid: string) {
  return new Map<string, unknown>([
    [
      `${gatewayUrl}/ipfs/${rootCatalogCid}`,
      {
        type: "Catalog",
        stac_version: "1.0.0",
        id: "root",
        links: [
          {
            rel: "child",
            href: "ipfs://bafy-client-cache-organization",
            "dclimate:id": organization,
          },
        ],
      },
    ],
    [
      `${gatewayUrl}/ipfs/bafy-client-cache-organization`,
      {
        type: "Catalog",
        stac_version: "1.0.0",
        id: organization,
        links: [
          {
            rel: "child",
            href: "ipfs://bafy-client-cache-collection",
          },
        ],
      },
    ],
    [
      `${gatewayUrl}/ipfs/bafy-client-cache-collection`,
      {
        type: "Collection",
        stac_version: "1.0.0",
        id: collection,
        description: `Catalog served by ${gatewayUrl}`,
        links: [
          {
            rel: "item",
            href: "ipfs://bafy-client-cache-item",
          },
        ],
      },
    ],
    [
      `${gatewayUrl}/ipfs/bafy-client-cache-item`,
      {
        type: "Feature",
        stac_version: "1.0.0",
        id: `${collection}-${dataset}`,
        properties: {},
        geometry: null,
        links: [],
        assets: { data: { href: `ipfs://${dataCid}` } },
      },
    ],
  ]);
}

describe("DClimateClient STAC catalog cache", () => {
  beforeEach(() => {
    openDatasetFromCidMock.mockReset();
    openDatasetFromCidMock.mockImplementation(async (cid: string) => ({
      attrs: { _zarr_cid: cid },
    }));

    const documents = new Map<string, unknown>([
      ["https://ipfs-gateway.dclimate.net/stac", { cid: rootCatalogCid }],
      ...catalogDocuments(gatewayA, "cid-A"),
      ...catalogDocuments(gatewayB, "cid-B"),
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : input.toString();
        const document = documents.get(url);
        if (!document) {
          throw new Error(`Unexpected fetch: ${url}`);
        }
        return jsonResponse(document);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a fresh catalog when a request targets a different gateway", async () => {
    const ipfsElements = {} as IpfsElements;
    const client = new DClimateClient({
      stacServerUrl: null,
      ipfsElements,
    });
    const request = {
      organization,
      collection: "weather",
      dataset,
    };

    await client.loadDataset({
      request,
      options: {
        gatewayUrl: gatewayA,
        ipfsElements,
        returnJaxrayDataset: true,
      },
    });
    await client.loadDataset({
      request,
      options: {
        gatewayUrl: gatewayB,
        ipfsElements,
        returnJaxrayDataset: true,
      },
    });

    expect.soft(openDatasetFromCidMock).toHaveBeenNthCalledWith(
      2,
      "cid-B",
      expect.objectContaining({ gatewayUrl: gatewayB }),
    );
    expect.soft(fetch).toHaveBeenCalledWith(
      `${gatewayB}/ipfs/${rootCatalogCid}`,
    );
  });
});
