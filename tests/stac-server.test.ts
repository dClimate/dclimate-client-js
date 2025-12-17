import { describe, expect, it, beforeAll } from "vitest";
import {
  resolveCidFromStacServer,
  resolveDatasetCidFromStacServer,
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
