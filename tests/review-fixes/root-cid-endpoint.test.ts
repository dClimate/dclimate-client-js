import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DClimateClient } from "../../src/index.js";
import type { ClientOptions, IpfsElements } from "../../src/types.js";
import {
  getRootCatalogCid,
  loadStacCatalog,
} from "../../src/stac/stac-catalog.js";

const publicDiscoveryEndpoint = "https://ipfs-gateway.dclimate.net/stac";
const openDatasetFromCidMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/ipfs/open-dataset.js", () => ({
  openDatasetFromCid: openDatasetFromCidMock,
  default: openDatasetFromCidMock,
}));

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function requestUrl(input: string | URL | Request): string {
  return input instanceof Request ? input.url : input.toString();
}

describe("root catalog CID discovery", () => {
  beforeEach(() => {
    openDatasetFromCidMock.mockReset();
    openDatasetFromCidMock.mockResolvedValue({ attrs: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a caller-provided discovery endpoint", async () => {
    const discoveryEndpoint = "https://catalog.private.test/root-cid";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url === discoveryEndpoint) {
        return jsonResponse({ cid: "bafy-private-root" });
      }
      if (url === publicDiscoveryEndpoint) {
        return jsonResponse({ cid: "bafy-public-root" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const getRootCid = getRootCatalogCid as unknown as (
      endpoint?: string,
    ) => Promise<string>;
    const cid = await getRootCid(discoveryEndpoint);

    expect.soft(cid).toBe("bafy-private-root");
    expect.soft(fetchMock).toHaveBeenCalledWith(discoveryEndpoint);
    expect(fetchMock).not.toHaveBeenCalledWith(publicDiscoveryEndpoint);
  });

  it("[passing invariant] defaults discovery to the current public endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ cid: "bafy-default-root" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getRootCatalogCid()).resolves.toBe("bafy-default-root");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(publicDiscoveryEndpoint);
  });

  it("[passing invariant] skips discovery when loadStacCatalog receives a root CID", async () => {
    const gatewayUrl = "https://explicit-root.private.test";
    const rootCid = "bafy-explicit-root";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url === `${gatewayUrl}/ipfs/${rootCid}`) {
        return jsonResponse({
          type: "Catalog",
          stac_version: "1.0.0",
          id: "explicit-root",
          links: [],
        });
      }
      if (url === publicDiscoveryEndpoint) {
        return jsonResponse({ cid: "bafy-unwanted-discovery-root" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadStacCatalog(gatewayUrl, rootCid)).resolves.toMatchObject({
      id: "explicit-root",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(`${gatewayUrl}/ipfs/${rootCid}`);
    expect(fetchMock).not.toHaveBeenCalledWith(publicDiscoveryEndpoint);
  });

  it("threads ClientOptions.rootCid through loadDataset without public discovery", async () => {
    const gatewayUrl = "https://client-root-cid.private.test";
    const pinnedRootCid = "bafy-pinned";
    const discoveredRootCid = "bafy-public-discovered";
    const organization = "privateorg";
    const collection = "privateorg_weather";
    const dataset = "temperature";

    const rootCatalog = {
      type: "Catalog",
      stac_version: "1.0.0",
      id: "root",
      links: [
        {
          rel: "child",
          href: "ipfs://bafy-private-organization",
          "dclimate:id": organization,
        },
      ],
    };
    const documents = new Map<string, unknown>([
      [publicDiscoveryEndpoint, { cid: discoveredRootCid }],
      [`${gatewayUrl}/ipfs/${pinnedRootCid}`, rootCatalog],
      [`${gatewayUrl}/ipfs/${discoveredRootCid}`, rootCatalog],
      [
        `${gatewayUrl}/ipfs/bafy-private-organization`,
        {
          type: "Catalog",
          stac_version: "1.0.0",
          id: organization,
          links: [
            { rel: "child", href: "ipfs://bafy-private-collection" },
          ],
        },
      ],
      [
        `${gatewayUrl}/ipfs/bafy-private-collection`,
        {
          type: "Collection",
          stac_version: "1.0.0",
          id: collection,
          description: "Private catalog fixture",
          links: [{ rel: "item", href: "ipfs://bafy-private-item" }],
        },
      ],
      [
        `${gatewayUrl}/ipfs/bafy-private-item`,
        {
          type: "Feature",
          stac_version: "1.0.0",
          id: `${collection}-${dataset}`,
          properties: {},
          geometry: null,
          links: [],
          assets: { data: { href: "ipfs://bafy-private-data" } },
        },
      ],
    ]);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      const document = documents.get(url);
      if (!document) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      return jsonResponse(document);
    });
    vi.stubGlobal("fetch", fetchMock);

    const clientOptions = {
      gatewayUrl,
      stacServerUrl: null,
      rootCid: pinnedRootCid,
      ipfsElements: {} as IpfsElements,
    } as unknown as ClientOptions;
    const client = new DClimateClient(clientOptions);

    await expect(
      client.loadDataset({
        request: { organization, collection: "weather", dataset },
        options: { returnJaxrayDataset: true },
      }),
    ).resolves.toBeDefined();

    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      requestUrl(input),
    );
    expect.soft(requestedUrls).toContain(
      `${gatewayUrl}/ipfs/${pinnedRootCid}`,
    );
    expect(requestedUrls).not.toContain(publicDiscoveryEndpoint);

    vi.unstubAllGlobals();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);

    // A pinned client must not consult the STAC server either — it serves
    // only the latest catalog, silently bypassing the pin. Same fixture, but
    // WITHOUT stacServerUrl: null: no request may leave the private gateway.
    const pinnedDefaultServerClient = new DClimateClient({
      gatewayUrl,
      rootCid: pinnedRootCid,
      ipfsElements: {} as IpfsElements,
    } as unknown as ClientOptions);

    await expect(
      pinnedDefaultServerClient.loadDataset({
        request: { organization, collection: "weather", dataset },
        options: { returnJaxrayDataset: true },
      }),
    ).resolves.toBeDefined();

    const pinnedUrls = fetchMock.mock.calls.map(([input]) =>
      requestUrl(input),
    );
    for (const url of pinnedUrls) {
      expect.soft(url.startsWith(gatewayUrl)).toBe(true);
    }
  });
});
