import { describe, expect, it } from "vitest";
import { DClimateClient } from "../src/index.js";
import type { DatasetMetadata, GeoTemporalDataset } from "../src/index.js";
import { Dataset } from "@dclimate/jaxray";

describe("Dataset metadata", () => {
  it("returns correct metadata for GeoTemporalDataset with specific variant", async () => {
    const client = new DClimateClient();

    const [dataset, metadata] = await client.loadDataset({
      request: {
        collection: "era5",
        dataset: "2m_temperature",
        variant: "finalized",
      },
    }) as [GeoTemporalDataset, DatasetMetadata];

    // Verify metadata structure
    expect(metadata).toBeDefined();
    expect(metadata.dataset).toBe("2m_temperature");
    expect(metadata.collection).toBe("era5");
    expect(metadata.variant).toBe("finalized");
    expect(metadata.path).toBe("era5-2m_temperature-finalized");
    expect(metadata.cid).toBeDefined();
    expect(typeof metadata.cid).toBe("string");
    expect(metadata.cid.length).toBeGreaterThan(0);

    // Verify source metadata
    expect(metadata.source).toBe("stac");

    // Verify fetchedAt
    expect(metadata.fetchedAt).toBeInstanceOf(Date);

    // Should NOT have concatenatedVariants for specific variant
    expect(metadata.concatenatedVariants).toBeUndefined();

    // Verify dataset.info matches metadata
    expect(dataset.info).toEqual(metadata);
  }, 30000);

  it("returns correct metadata for raw Jaxray Dataset with returnJaxrayDataset option", async () => {
    const client = new DClimateClient();

    const [dataset, metadata] = await client.loadDataset({
      request: {
        collection: "era5",
        dataset: "2m_temperature",
        variant: "finalized",
      },
      options: {
        returnJaxrayDataset: true,
      },
    }) as [Dataset, DatasetMetadata];

    // Verify dataset is raw Jaxray Dataset (not wrapped in GeoTemporalDataset)
    expect(dataset).toBeInstanceOf(Dataset);
    expect(dataset.coords).toBeDefined();
    expect(dataset.dataVars).toBeDefined();

    // Verify metadata is still returned and complete
    expect(metadata).toBeDefined();
    expect(metadata.dataset).toBe("2m_temperature");
    expect(metadata.collection).toBe("era5");
    expect(metadata.variant).toBe("finalized");
    expect(metadata.path).toBe("era5-2m_temperature-finalized");
    expect(metadata.cid).toBeDefined();
    expect(metadata.source).toBe("stac");
    expect(metadata.fetchedAt).toBeInstanceOf(Date);
    expect(metadata.concatenatedVariants).toBeUndefined();
  }, 30000);

  it("returns correct metadata for auto-concatenated dataset", async () => {
    const client = new DClimateClient();

    const [dataset, metadata] = await client.loadDataset({
      request: {
        collection: "era5",
        dataset: "2m_temperature",
        // No variant specified - should auto-concatenate
      },
      options: {
        autoConcatenate: true, // Explicit, but this is the default
      },
    }) as [GeoTemporalDataset, DatasetMetadata];

    // Verify metadata structure
    expect(metadata).toBeDefined();
    expect(metadata.dataset).toBe("2m_temperature");
    expect(metadata.collection).toBe("era5");
    expect(metadata.path).toBe("era5-2m_temperature");
    expect(metadata.cid).toBeDefined();

    // Should have concatenatedVariants array
    expect(metadata.concatenatedVariants).toBeDefined();
    expect(Array.isArray(metadata.concatenatedVariants)).toBe(true);
    expect(metadata.concatenatedVariants!.length).toBeGreaterThan(0);
    expect(metadata.concatenatedVariants).toContain("finalized");
    expect(metadata.concatenatedVariants).toContain("non_finalized");

    // Verify source metadata
    expect(metadata.source).toBe("stac_concatenated");
    expect(metadata.fetchedAt).toBeInstanceOf(Date);

    // Verify dataset.info matches metadata
    expect(dataset.info).toEqual(metadata);
  }, 60000); // Longer timeout for concatenation

  it("metadata persists through point and timeRange selections", async () => {
    const client = new DClimateClient();

    const [dataset, originalMetadata] = await client.loadDataset({
      request: {
        collection: "era5",
        dataset: "2m_temperature",
        variant: "finalized",
      },
    }) as [GeoTemporalDataset, DatasetMetadata];

    // Apply point selection
    const pointDataset = await dataset.point(45, -73);
    expect(pointDataset.info).toEqual(originalMetadata);

    // Apply time range selection
    const timeDataset = await pointDataset.timeRange({
      start: "2020-01-01T00:00:00Z",
      end: "2020-01-07T00:00:00Z",
    });
    expect(timeDataset.info).toEqual(originalMetadata);
  }, 30000);

  it("metadata includes all required fields", async () => {
    const client = new DClimateClient();

    const [, metadata] = await client.loadDataset({
      request: {
        collection: "era5",
        dataset: "2m_temperature",
        variant: "finalized",
      },
    }) as [GeoTemporalDataset, DatasetMetadata];

    // Required fields that should always be present
    const requiredFields = [
      "dataset",
      "path",
      "cid",
      "source",
      "fetchedAt",
    ];

    for (const field of requiredFields) {
      expect(metadata).toHaveProperty(field);
      expect((metadata as any)[field]).toBeDefined();
    }
  }, 30000);

  it("metadata does not include timestamp field (removed in STAC migration)", async () => {
    const client = new DClimateClient();

    const [, metadata] = await client.loadDataset({
      request: {
        collection: "ifs",
        dataset: "temperature",
      },
    }) as [GeoTemporalDataset, DatasetMetadata];

    // timestamp field was removed in STAC migration
    expect((metadata as any).timestamp).toBeUndefined();

    // fetchedAt is the replacement for timestamp
    expect(metadata.fetchedAt).toBeDefined();
    expect(metadata.fetchedAt).toBeInstanceOf(Date);
  }, 30000);

  it("metadata fetchedAt is close to current time", async () => {
    const beforeFetch = new Date();

    const client = new DClimateClient();
    const [, metadata] = await client.loadDataset({
      request: {
        collection: "era5",
        dataset: "2m_temperature",
        variant: "finalized",
      },
    }) as [GeoTemporalDataset, DatasetMetadata];

    const afterFetch = new Date();

    // fetchedAt should be between beforeFetch and afterFetch
    expect(metadata.fetchedAt.getTime()).toBeGreaterThanOrEqual(beforeFetch.getTime());
    expect(metadata.fetchedAt.getTime()).toBeLessThanOrEqual(afterFetch.getTime());
  }, 30000);
});
