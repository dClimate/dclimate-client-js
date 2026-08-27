import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listAvailableDatasetsFromStacServer,
  resolveCidFromStacServer,
} from "../../src/stac/stac-server.js";

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

  it("continues past an empty page when a next link is present", async () => {
    const secondPageUrl = `${serverUrl}/search?page=2`;
    const thirdPageUrl = `${serverUrl}/search?page=3`;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === thirdPageUrl) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ features: [feature(119)], links: [] }),
          text: async () => "",
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          features: url === secondPageUrl ? [] : [feature(0)],
          links: [
            {
              rel: "next",
              href: url === secondPageUrl ? thirdPageUrl : secondPageUrl,
            },
          ],
        }),
        text: async () => "",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveCidFromStacServer(collection, targetDataset, undefined, serverUrl),
    ).resolves.toMatchObject({ cid: "bafy-page-item-119" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]?.toString()).toBe(thirdPageUrl);
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
    let requestNumber = 0;
    const fetchMock = vi.fn(async () => {
      requestNumber += 1;
      return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            type: "FeatureCollection",
            features: [feature(0)],
            links: [
              {
                rel: "next",
                href: `${serverUrl}/search?page=${requestNumber + 1}`,
              },
            ],
          }),
          text: async () => "",
        } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveCidFromStacServer(collection, targetDataset, undefined, serverUrl),
    ).rejects.toThrow(/truncated/);
  });

  it("forwards header-based cursors from the next link on both GET and POST", async () => {
    const allFeatures = Array.from({ length: 150 }, (_, index) =>
      feature(index),
    );
    const cursor = "cursor:bigcoll:100";
    const seenHeaders: Array<Record<string, string>> = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        seenHeaders.push(headers);
        const isNextPage = headers["x-stac-cursor"] === cursor;
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
                  {
                    rel: "next",
                    method: "GET",
                    href: `${serverUrl}/search?page=2`,
                    headers: { "x-stac-cursor": cursor },
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
    // The header cursor from the link must reach the second request, or it
    // would re-fetch page one forever.
    expect(seenHeaders[1]?.["x-stac-cursor"]).toBe(cursor);
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

describe("listAvailableDatasetsFromStacServer /collections pagination", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces truncation instead of silently returning a partial catalogue", async () => {
    // Every /collections page advertises another next link, so the walk can
    // never terminate naturally. Returning what it had would hand back a
    // catalogue that looks complete, with the missing collections showing up
    // later as untitled or unknown datasets rather than as this failure.
    let collectionsRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/collections")) {
        collectionsRequests += 1;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            collections: [{ id: collection, title: "Big Collection" }],
            links: [
              {
                rel: "next",
                href: `${serverUrl}/collections?page=${collectionsRequests + 1}`,
              },
            ],
          }),
          text: async () => "",
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          type: "FeatureCollection",
          features: [feature(0)],
          links: [],
        }),
        text: async () => "",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listAvailableDatasetsFromStacServer(serverUrl),
    ).rejects.toThrow(/truncated/);
  });

  it("follows a next link whose host carries a fully-qualified trailing dot", async () => {
    // `https://host./x` addresses the same server as `https://host/x`, but
    // `URL.origin` compares them unequal. Normalizing is what keeps an
    // in-bounds link from being refused as if it left the server.
    const seenUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/collections")) {
        seenUrls.push(url);
        const first = !url.includes("page=2");
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            collections: [{ id: collection, title: first ? "One" : "Two" }],
            links: first
              ? [
                  {
                    rel: "next",
                    href: `https://paginated-stac.test./collections?page=2`,
                  },
                ]
              : [],
          }),
          text: async () => "",
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          type: "FeatureCollection",
          features: [feature(0)],
          links: [],
        }),
        text: async () => "",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listAvailableDatasetsFromStacServer(serverUrl),
    ).resolves.toBeDefined();
    expect(seenUrls.some((url) => url.includes("page=2"))).toBe(true);
  });
});
