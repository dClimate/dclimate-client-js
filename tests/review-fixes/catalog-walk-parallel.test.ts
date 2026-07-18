import { afterEach, describe, expect, it, vi } from "vitest";
import { loadStacCatalog } from "../../src/stac/stac-catalog.js";

const rootCidEndpoint = "https://ipfs-gateway.dclimate.net/stac";
const organizationCount = 2;
const collectionsPerOrganization = 3;
const itemsPerCollection = 4;

interface CollectionExpectation {
  collectionId: string;
  organizationId: string;
  itemIds: string[];
  url: string;
  itemUrls: string[];
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Internal Server Error",
    json: async () => body,
  } as Response;
}

function buildCatalogFixture(gatewayUrl: string) {
  const rootCid = "bafy-parallel-walk-root";
  const documents = new Map<string, unknown>([
    [rootCidEndpoint, { cid: rootCid }],
  ]);
  const rootLinks = [];
  const collections: CollectionExpectation[] = [];

  for (let organizationIndex = 0; organizationIndex < organizationCount; organizationIndex += 1) {
    const organizationId = `organization-${organizationIndex}`;
    const organizationCid = `bafy-${organizationId}`;
    const organizationLinks = [];

    rootLinks.push({
      rel: "child",
      href: `ipfs://${organizationCid}`,
      title: `Organization ${organizationIndex}`,
      "dclimate:id": organizationId,
    });

    for (let collectionIndex = 0; collectionIndex < collectionsPerOrganization; collectionIndex += 1) {
      const collectionId = `${organizationId}_collection-${collectionIndex}`;
      const collectionCid = `bafy-${collectionId}`;
      const collectionUrl = `${gatewayUrl}/ipfs/${collectionCid}`;
      const itemLinks = [];
      const itemIds = [];
      const itemUrls = [];

      organizationLinks.push({ rel: "child", href: `ipfs://${collectionCid}` });

      for (let itemIndex = 0; itemIndex < itemsPerCollection; itemIndex += 1) {
        const itemId = `${collectionId}-item-${itemIndex}`;
        const itemCid = `bafy-${itemId}`;
        const itemUrl = `${gatewayUrl}/ipfs/${itemCid}`;

        itemLinks.push({ rel: "item", href: `ipfs://${itemCid}` });
        itemIds.push(itemId);
        itemUrls.push(itemUrl);
        documents.set(itemUrl, {
          type: "Feature",
          stac_version: "1.0.0",
          id: itemId,
          properties: {},
          geometry: null,
          links: [],
          assets: { data: { href: `ipfs://bafy-data-${itemId}` } },
        });
      }

      documents.set(collectionUrl, {
        type: "Collection",
        stac_version: "1.0.0",
        id: collectionId,
        description: `Collection ${collectionIndex} for ${organizationId}`,
        links: itemLinks,
      });
      collections.push({
        collectionId,
        organizationId,
        itemIds,
        url: collectionUrl,
        itemUrls,
      });
    }

    documents.set(`${gatewayUrl}/ipfs/${organizationCid}`, {
      type: "Catalog",
      stac_version: "1.0.0",
      id: organizationId,
      links: organizationLinks,
    });
  }

  documents.set(`${gatewayUrl}/ipfs/${rootCid}`, {
    type: "Catalog",
    stac_version: "1.0.0",
    id: "root",
    links: rootLinks,
  });

  return { collections, documents };
}

function stubDelayedCatalogFetch(gatewayUrl: string, failingUrls = new Set<string>()) {
  const fixture = buildCatalogFixture(gatewayUrl);
  let inFlight = 0;
  let maxConcurrency = 0;

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    inFlight += 1;
    maxConcurrency = Math.max(maxConcurrency, inFlight);

    await new Promise((resolve) => setTimeout(resolve, 15));
    inFlight -= 1;

    if (failingUrls.has(url)) {
      return response({ error: "Synthetic failure" }, 500);
    }

    const document = fixture.documents.get(url);
    if (!document) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return response(document);
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    ...fixture,
    fetchMock,
    getMaxConcurrency: () => maxConcurrency,
  };
}

function expectCompleteTraversal(
  catalog: Awaited<ReturnType<typeof loadStacCatalog>>,
  expectedCollections: CollectionExpectation[],
) {
  expect(catalog.collections).toHaveLength(expectedCollections.length);
  expect(catalog.collections?.map(({ id }) => id).sort()).toEqual(
    expectedCollections.map(({ collectionId }) => collectionId).sort(),
  );

  for (const expected of expectedCollections) {
    const collection = catalog.collections?.find(({ id }) => id === expected.collectionId);
    expect(collection?.organizationId).toBe(expected.organizationId);
    expect(collection?.items?.map(({ id }) => id).sort()).toEqual([...expected.itemIds].sort());
  }
}

describe("loadStacCatalog IPFS walk", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches independent catalog branches concurrently", async () => {
    const gatewayUrl = "https://catalog-walk-concurrency.test";
    const fixture = stubDelayedCatalogFetch(gatewayUrl);

    await loadStacCatalog(gatewayUrl);

    expect(fixture.getMaxConcurrency()).toBeGreaterThanOrEqual(4);
  });

  it("attaches every item and organization id to all traversed collections", async () => {
    const gatewayUrl = "https://catalog-walk-completeness.test";
    const fixture = stubDelayedCatalogFetch(gatewayUrl);

    const catalog = await loadStacCatalog(gatewayUrl);

    expectCompleteTraversal(catalog, fixture.collections);
  });

  it("continues past failed collection and item responses", async () => {
    const gatewayUrl = "https://catalog-walk-error-tolerance.test";
    const fixture = buildCatalogFixture(gatewayUrl);
    const failedCollection = fixture.collections[0];
    const collectionWithFailedItem = fixture.collections.at(-1)!;
    const failedItemUrl = collectionWithFailedItem.itemUrls.at(-1)!;
    const failedItemId = collectionWithFailedItem.itemIds.at(-1)!;
    const failingUrls = new Set([failedCollection.url, failedItemUrl]);
    const delayedFixture = stubDelayedCatalogFetch(gatewayUrl, failingUrls);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const catalog = await loadStacCatalog(gatewayUrl);

    const expectedCollections = delayedFixture.collections
      .filter(({ collectionId }) => collectionId !== failedCollection.collectionId)
      .map((collection) => ({
        ...collection,
        itemIds:
          collection.collectionId === collectionWithFailedItem.collectionId
            ? collection.itemIds.filter((itemId) => itemId !== failedItemId)
            : collection.itemIds,
      }));
    expectCompleteTraversal(catalog, expectedCollections);
  });
});
