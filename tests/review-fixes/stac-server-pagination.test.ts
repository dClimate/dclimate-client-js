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

  it("resolves a relative next link against the /search endpoint, not the server root", async () => {
    const allFeatures = Array.from({ length: 150 }, (_, index) =>
      feature(index),
    );
    // A bare query-string href must resolve against the request URL
    // (`${serverUrl}/search`), yielding `.../search?token=abc`. Resolving it
    // against the server root would wrongly target `.../?token=abc`.
    const relativeNext = "?token=abc";
    const expectedNextUrl = `${serverUrl}/search?token=abc`;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      const isNextPage = url === expectedNextUrl;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          type: "FeatureCollection",
          features: isNextPage
            ? allFeatures.slice(100)
            : allFeatures.slice(0, 100),
          links: isNextPage ? [] : [{ rel: "next", href: relativeNext }],
        }),
        text: async () => "",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveCidFromStacServer(collection, targetDataset, undefined, serverUrl),
    ).resolves.toMatchObject({ cid: "bafy-page-item-119" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]?.toString()).toBe(expectedNextUrl);
  });

  it("surfaces truncation instead of silently returning a partial page set", async () => {
    // Every page advertises another next link, so the walk can never terminate
    // naturally. Rather than silently truncating (and reporting the target as
    // missing), it must throw so callers can fall back to the full catalog.
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            type: "FeatureCollection",
            features: [feature(0)],
            links: [{ rel: "next", href: `${serverUrl}/search?page=next` }],
          }),
          text: async () => "",
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveCidFromStacServer(collection, targetDataset, undefined, serverUrl),
    ).rejects.toThrow(/truncated/);
  });

  it("re-POSTs token-style next links as the production server requires", async () => {
    // The dClimate STAC server paginates with
    // {rel: "next", method: "POST", href: ".../search", body: {limit, token}}.
    const allFeatures = Array.from({ length: 150 }, (_, index) =>
      feature(index),
    );
    const token = "next:bigcoll:100";
    const postBodies: unknown[] = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();
        expect(url).toBe(`${serverUrl}/search`);
        const parsedBody = init?.body
          ? JSON.parse(init.body as string)
          : undefined;
        postBodies.push(parsedBody);
        const isNextPage = parsedBody?.token === token;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            type: "FeatureCollection",
            features: isNextPage
              ? allFeatures.slice(100)
              : allFeatures.slice(0, 100),
            links: isNextPage
              ? []
              : [
                  // Null entries must be tolerated, not crash the walk.
                  null,
                  {
                    rel: "next",
                    method: "POST",
                    href: `${serverUrl}/search`,
                    body: { limit: 100, token },
                  },
                ],
          }),
          text: async () => "",
        } as Response;
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveCidFromStacServer(collection, targetDataset, undefined, serverUrl),
    ).resolves.toMatchObject({ cid: "bafy-page-item-119" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(postBodies[1]).toEqual({ limit: 100, token });
  });
});
