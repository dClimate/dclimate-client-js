import { describe, expect, it } from "vitest";
import { DClimateClient } from "../src/index.js";
import type { DatasetMetadata, GeoTemporalDataset } from "../src/index.js";
import { Dataset } from "@dclimate/jaxray";

describe("Dataset concatenation", () => {
  it("concatenated dataset matches data from individual finalized + non-finalized variants", async () => {
    const client = new DClimateClient();

    // Load finalized variant only
    const [finalized] = await client.loadDataset({
      request: {
        collection: "era5",
        dataset: "2m_temperature",
        variant: "finalized",
      },
      options: {
        returnJaxrayDataset: true,
      },
    }) as [Dataset, DatasetMetadata];

    // Load non-finalized variant only
    const [nonFinalized] = await client.loadDataset({
      request: {
        collection: "era5",
        dataset: "2m_temperature",
        variant: "non-finalized",
      },
      options: {
        returnJaxrayDataset: true,
      },
    }) as [Dataset, DatasetMetadata];

    // Load concatenated version (auto-concat by not specifying variant)
    const [concatenated] = await client.loadDataset({
      request: {
        collection: "era5",
        dataset: "2m_temperature",
      },
      options: {
        autoConcatenate: true, // Explicit, but this is the default
        returnJaxrayDataset: true,
      },
    }) as [Dataset, DatasetMetadata];

    // 


    // Get time coordinates from each dataset
    const finalizedTimeCoords = finalized.coords.time;
    const nonFinalizedTimeCoords = nonFinalized.coords.time;
    const concatenatedTimeCoords = concatenated.coords.time;

    // Verify concatenated has more time points than finalized alone
    expect(concatenatedTimeCoords.length).toBeGreaterThan(finalizedTimeCoords.length);

    // Get the last time coordinate from finalized
    const lastFinalizedTime = finalizedTimeCoords[finalizedTimeCoords.length - 1];

    // Test a point in the finalized range
    const pointLat = 45;
    const pointLon = -73;

    // Select a time point that exists in finalized data
    const finalizedTimePoint = finalizedTimeCoords[Math.floor(finalizedTimeCoords.length / 2)];

    const finalizedValue = await finalized
      .sel({
        time: finalizedTimePoint,
        latitude: pointLat,
        longitude: pointLon,
      });

    const concatenatedValueFromFinalizedRange = await concatenated
      .sel({
        time: finalizedTimePoint,
        latitude: pointLat,
        longitude: pointLon,
      });

    // Values from finalized range should match
    const finalizedData = await finalizedValue.getVariable("2m_temperature").compute();
    const concatenatedData = await concatenatedValueFromFinalizedRange.getVariable("2m_temperature").compute();

    expect(concatenatedData.values).toEqual(finalizedData.values);

    console.log("Finalized and concatenated data match for finalized time point.");

    // Find a time point in non-finalized that's AFTER last finalized time
    const nonFinalizedAfterSplit = nonFinalizedTimeCoords.find((t) => {
      const tDate = new Date(t as Date);
      const lastFinalizedDate = new Date(lastFinalizedTime as Date);
      return tDate > lastFinalizedDate;
    });

    if (nonFinalizedAfterSplit) {
      const nonFinalizedValue = await nonFinalized
        .sel({
          time: nonFinalizedAfterSplit,
          latitude: pointLat,
          longitude: pointLon,
        });

      const concatenatedValueFromNonFinalizedRange = await concatenated
        .sel({
          time: nonFinalizedAfterSplit,
          latitude: pointLat,
          longitude: pointLon,
        });

      const nonFinalizedData = await nonFinalizedValue.getVariable("2m_temperature").compute();
      const concatenatedNonFinalizedData = await concatenatedValueFromNonFinalizedRange.getVariable("2m_temperature").compute();

      // Values from non-finalized range should match
      expect(concatenatedNonFinalizedData.values).toEqual(nonFinalizedData.values);
    }
  }, 60000); // 60 second timeout for IPFS loading

  it("loading with specific variant does NOT concatenate", async () => {
    const client = new DClimateClient();

    const [finalizedOnly] = await client.loadDataset({
      request: {
        collection: "era5",
        dataset: "2m_temperature",
        variant: "finalized",
      },
    }) as [GeoTemporalDataset, DatasetMetadata];

    // Should NOT have concatenatedVariants in metadata
    expect(finalizedOnly.info.concatenatedVariants).toBeUndefined();
    expect(finalizedOnly.info.variant).toBe("finalized");
  }, 30000);
});
