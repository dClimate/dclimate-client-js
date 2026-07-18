import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCidFromStacServer } from "../../src/stac/stac-server.js";

const serverUrl = "https://paginated-stac.test";
const collection = "bigcoll";
const targetDataset = "wanted_dataset";

function feature(index: number) {
  const dataset = index === 119 ? targetDataset : `dataset_${index}`;
  return {
    type: "Feature" as const,
    id: `${collection}-${dataset}-default`,
    collection,
    properties: {
      "dclimate:dataset_id": dataset,
      "dclimate:variant": "default",
    },
    assets: { data: { href: `ipfs://bafy-page-item-${index}` } },
  };
}

describe("resolveCidFromStacServer pagination", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows the STAC next link to find an item beyond the first page", async () => {
    const allFeatures = Array.from({ length: 150 }, (_, index) =>
      feature(index),
    );
    const nextPageUrl = `${serverUrl}/search?page=2`;
    const fetchMock = vi.fn(
      async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : input.toString();
        const isNextPage = url === nextPageUrl;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            type: "FeatureCollection",
            features: isNextPage
              ? allFeatures.slice(100)
              : allFeatures.slice(0, 100),
            numberMatched: allFeatures.length,
            numberReturned: isNextPage ? 50 : 100,
            links: isNextPage
              ? []
              : [{ rel: "next", href: nextPageUrl }],
          }),
          text: async () => "",
        } as Response;
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveCidFromStacServer(
        collection,
        targetDataset,
        undefined,
        serverUrl,
      ),
    ).resolves.toMatchObject({
      cid: "bafy-page-item-119",
      collectionId: collection,
      dataset: targetDataset,
      variant: "default",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]?.toString()).toBe(nextPageUrl);
  });
});
