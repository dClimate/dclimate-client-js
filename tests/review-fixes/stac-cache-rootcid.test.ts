import { afterEach, describe, expect, it, vi } from "vitest";
import { loadStacCatalog } from "../../src/stac/stac-catalog.js";

const rootCidEndpoint = "https://ipfs-gateway.dclimate.net/stac";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as Response;
}

function stubCatalogFetch(gatewayUrl: string) {
  const documents = new Map<string, unknown>([
    [rootCidEndpoint, { cid: "bafy-latest" }],
    [
      `${gatewayUrl}/ipfs/bafy-latest`,
      {
        type: "Catalog",
        stac_version: "1.0.0",
        id: "latest-catalog",
        links: [],
      },
    ],
    [
      `${gatewayUrl}/ipfs/bafy-pinned`,
      {
        type: "Catalog",
        stac_version: "1.0.0",
        id: "pinned-catalog",
        links: [],
      },
    ],
  ]);

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    const document = documents.get(url);
    if (!document) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return jsonResponse(document);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("loadStacCatalog root CID cache isolation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("honors an explicit root CID after the latest catalog was cached", async () => {
    const gatewayUrl = "https://latest-then-pinned.stac-cache.test";
    const fetchMock = stubCatalogFetch(gatewayUrl);

    const latest = await loadStacCatalog(gatewayUrl);
    expect(latest.id).toBe("latest-catalog");

    const pinned = await loadStacCatalog(gatewayUrl, "bafy-pinned");

    expect.soft(pinned.id).toBe("pinned-catalog");
    expect(fetchMock).toHaveBeenCalledWith(
      `${gatewayUrl}/ipfs/bafy-pinned`,
    );
  });

  it("loads the latest root CID after a pinned catalog was cached", async () => {
    const gatewayUrl = "https://pinned-then-latest.stac-cache.test";
    const fetchMock = stubCatalogFetch(gatewayUrl);

    const pinned = await loadStacCatalog(gatewayUrl, "bafy-pinned");
    expect(pinned.id).toBe("pinned-catalog");

    const latest = await loadStacCatalog(gatewayUrl);

    expect.soft(latest.id).toBe("latest-catalog");
    expect.soft(fetchMock).toHaveBeenCalledWith(rootCidEndpoint);
    expect(fetchMock).toHaveBeenCalledWith(
      `${gatewayUrl}/ipfs/bafy-latest`,
    );
  });
});
