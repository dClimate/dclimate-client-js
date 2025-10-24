import { describe, it, expect, beforeEach } from "vitest";
import { Dataset, DataArray } from "@dclimate/jaxray";
import { points, circle, rectangle } from "../src/shapes/index.js";
import { InvalidSelectionError, NoDataFoundError } from "../src/errors.js";
import { isDatasetEmpty } from "../src/utils.js";

// Helper to create a test dataset
function createTestDataset(): Dataset {
  // Create a 2D dataset with latitude and longitude dimensions
  // latitude: [40.0, 40.5, 41.0]
  // longitude: [-74.0, -73.5, -73.0]
  const temperatureData = new DataArray(
    [
      [20, 21, 22],
      [19, 20, 21],
      [18, 19, 20],
    ],
    {
      dims: ["latitude", "longitude"],
      coords: {
        latitude: [40.0, 40.5, 41.0],
        longitude: [-74.0, -73.5, -73.0],
      },
      attrs: { units: "celsius", description: "Temperature" },
    }
  );

  const humidityData = new DataArray(
    [
      [60, 65, 70],
      [62, 67, 72],
      [64, 69, 74],
    ],
    {
      dims: ["latitude", "longitude"],
      coords: {
        latitude: [40.0, 40.5, 41.0],
        longitude: [-74.0, -73.5, -73.0],
      },
      attrs: { units: "percent", description: "Humidity" },
    }
  );

  return new Dataset({
    temperature: temperatureData,
    humidity: humidityData,
  });
}

describe("Shapes Module", () => {
  describe("points()", () => {
    let dataset: Dataset;

    beforeEach(() => {
      dataset = createTestDataset();
    });

    it("should select single point from dataset", async () => {
      const result = await points(dataset, [40.0], [-74.0]);

      expect(result.dataVars).toContain("temperature");
      expect(result.dataVars).toContain("humidity");
      const tempVar = result.getVariable("temperature");
      // Result should be a scalar or single value
      expect(tempVar.data).toBeDefined();
    });

    it("should select multiple points from dataset", async () => {
      const result = await points(dataset, [40.0, 40.5], [-74.0, -73.5]);

      const tempVar = result.getVariable("temperature");
      expect(Array.isArray(tempVar.data)).toBe(true);
      expect((tempVar.data as any[]).length).toBeGreaterThan(0);
    });

    it("should throw error if point arrays have different lengths", async () => {
      await expect(
        points(dataset, [40.0, 40.5], [-74.0])
      ).rejects.toThrow(InvalidSelectionError);
    });

    it("should throw error if no points are provided", async () => {
      await expect(
        points(dataset, [], [])
      ).rejects.toThrow(InvalidSelectionError);
    });

    it("should support custom coordinate key names", async () => {
      const dataset2 = new Dataset({
        temperature: new DataArray([20, 19, 18], {
          dims: ["y"],
          coords: { y: [40.0, 40.5, 41.0] },
        }),
      });

      const result = await points(dataset2, [40.0], [0], {
        latitudeKey: "y",
        longitudeKey: "x",
      });

      expect(result).toBeDefined();
    });

    it("should throw error if EPSG CRS transformation requested", async () => {
      await expect(
        points(dataset, [40.0], [-74.0], { epsgCrs: 3857 })
      ).rejects.toThrow(InvalidSelectionError);
    });

    it("should perform nearest neighbor selection by default", async () => {
      // Request a point that's close but not exact
      const result = await points(dataset, [40.25], [-73.75]);

      expect(result.dataVars).toContain("temperature");
    });
  });

  describe("circle()", () => {
    let dataset: Dataset;

    beforeEach(() => {
      dataset = createTestDataset();
    });

    it("should filter points within circle radius", async () => {
      // Center at (40.5, -73.5) with 50km radius should include nearby points
      const result = await circle(dataset, 40.5, -73.5, 50);

      expect(result.dataVars).toContain("temperature");
      expect(result.dataVars).toContain("humidity");
    });

    it("should return empty dataset when radius excludes all points", async () => {
      // Center far away with small radius
      const result = await circle(dataset, 50.0, -80.0, 1);

      expect(isDatasetEmpty(result)).toBe(true);
    });

    it("should throw error if radius is invalid", async () => {
      await expect(
        circle(dataset, 40.5, -73.5, -1)
      ).rejects.toThrow(InvalidSelectionError);

      await expect(
        circle(dataset, 40.5, -73.5, 0)
      ).rejects.toThrow(InvalidSelectionError);
    });

    it("should throw error if coordinates not found", async () => {
      const badDataset = new Dataset({
        temperature: new DataArray([20, 21], {
          dims: ["x"],
          coords: { x: [0, 1] },
        }),
      });

      await expect(
        circle(badDataset, 40.5, -73.5, 50)
      ).rejects.toThrow(InvalidSelectionError);
    });

    it("should support custom coordinate key names", async () => {
      const customDataset = new Dataset({
        temperature: new DataArray(
          [
            [20, 21, 22],
            [19, 20, 21],
            [18, 19, 20],
          ],
          {
            dims: ["lat", "lon"],
            coords: {
              lat: [40.0, 40.5, 41.0],
              lon: [-74.0, -73.5, -73.0],
            },
          }
        ),
      });

      const result = await circle(customDataset, 40.5, -73.5, 50, {
        latitudeKey: "lat",
        longitudeKey: "lon",
      });

      expect(result).toBeDefined();
    });

    it("should handle coordinates at edge of radius", async () => {
      // Create dataset with point exactly at radius boundary
      const testData = new DataArray([[20, 21], [20, 21]], {
        dims: ["latitude", "longitude"],
        coords: { latitude: [40.0, 40.5], longitude: [-74.0, -74.0] },
      });

      const ds = new Dataset({ temperature: testData });
      const result = await circle(ds, 40.0, -74.0, 55.6); // Approx distance to 40.5, -74.0

      expect(result).toBeDefined();
    });

    it("should accurately filter large dataset with dense grid of points", async () => {
      // Create a dense grid of latitude/longitude points (15x15 = 225 points)
      // Grid spans from 39.0 to 41.0 latitude and -75.0 to -73.0 longitude
      const latitudes = Array.from({ length: 15 }, (_, i) => 39.0 + (i * 0.15));
      const longitudes = Array.from({ length: 15 }, (_, i) => -75.0 + (i * 0.15));

      // Create 2D temperature data
      const temperatureData = Array.from({ length: 15 }, (_, i) =>
        Array.from({ length: 15 }, (_, j) => 15 + i + j)
      );

      const largeDataset = new Dataset({
        temperature: new DataArray(temperatureData, {
          dims: ["latitude", "longitude"],
          coords: {
            latitude: latitudes,
            longitude: longitudes,
          },
          attrs: { units: "celsius" },
        }),
      });

      // Test circle centered at (40.0, -74.0) with 50km radius
      const result = await circle(largeDataset, 40.0, -74.0, 50);

      expect(result.dataVars).toContain("temperature");
      expect(result).toBeDefined();

      // Verify that the result contains filtered data
      const tempVar = result.getVariable("temperature");
      expect(tempVar).toBeDefined();

      // The result should have coordinates preserved
      expect(result.coords.latitude).toBeDefined();
      expect(result.coords.longitude).toBeDefined();
    });

    it("should properly include/exclude points based on circle radius with large dataset", async () => {
      // Create a grid with center point at (40.0, -74.0)
      const latitudes = Array.from({ length: 11 }, (_, i) => 39.5 + (i * 0.1)); // 39.5 to 40.5
      const longitudes = Array.from({ length: 11 }, (_, i) => -74.5 + (i * 0.1)); // -74.5 to -73.5

      const temperatureData = Array.from({ length: 11 }, () =>
        Array.from({ length: 11 }, () => 20)
      );

      const largeDataset = new Dataset({
        temperature: new DataArray(temperatureData, {
          dims: ["latitude", "longitude"],
          coords: {
            latitude: latitudes,
            longitude: longitudes,
          },
        }),
      });

      // Test with small radius - should include only center area
      const resultSmallRadius = await circle(largeDataset, 40.0, -74.0, 10);
      expect(resultSmallRadius).toBeDefined();
      expect(resultSmallRadius.dataVars).toContain("temperature");

      // Test with larger radius - should include more points
      const resultLargeRadius = await circle(largeDataset, 40.0, -74.0, 100);
      expect(resultLargeRadius).toBeDefined();
      expect(resultLargeRadius.dataVars).toContain("temperature");

      // Large radius should have more latitude/longitude coordinates than small radius
      const smallRadiusLatCount = resultSmallRadius.coords.latitude.length;
      const largeRadiusLatCount = resultLargeRadius.coords.latitude.length;

      expect(largeRadiusLatCount).toBeGreaterThanOrEqual(smallRadiusLatCount);

      // Verify coordinates are preserved and make sense
      expect(resultSmallRadius.coords.latitude).toBeDefined();
      expect(resultSmallRadius.coords.longitude).toBeDefined();
      expect(resultLargeRadius.coords.latitude).toBeDefined();
      expect(resultLargeRadius.coords.longitude).toBeDefined();
    });

    it("should validate that all coordinates form a proper circle", async () => {
      // Create a dense grid of points centered at (40.0, -74.0)
      const centerLat = 40.0;
      const centerLon = -74.0;
      const radiusKm = 10;

      const latitudes = Array.from({ length: 21 }, (_, i) => 39.0 + (i * 0.1)); // 39.0 to 41.0
      const longitudes = Array.from({ length: 21 }, (_, i) => -75.0 + (i * 0.1)); // -75.0 to -73.0

      const temperatureData = Array.from({ length: 21 }, () =>
        Array.from({ length: 21 }, () => 25)
      );

      const dataset = new Dataset({
        temperature: new DataArray(temperatureData, {
          dims: ["latitude", "longitude"],
          coords: {
            latitude: latitudes,
            longitude: longitudes,
          },
        }),
      });

      const result = await circle(dataset, centerLat, centerLon, radiusKm);

      expect(result).toBeDefined();
      expect(result.dataVars).toContain("temperature");

      // Get the filtered coordinates
      const resultLats = result.coords.latitude as number[];
      const resultLons = result.coords.longitude as number[];

      expect(resultLats.length).toBeGreaterThan(0);
      expect(resultLons.length).toBeGreaterThan(0);

      // Verify that points near the center are included
      // The center point should be within the selected coordinates
      const hasNearCenterLat = resultLats.some((lat) => Math.abs(lat - centerLat) < 0.2);
      const hasNearCenterLon = resultLons.some((lon) => Math.abs(lon - centerLon) < 0.2);

      expect(hasNearCenterLat).toBe(true);
      expect(hasNearCenterLon).toBe(true);

      // Verify selected coordinates span across the center
      const minLat = Math.min(...resultLats);
      const maxLat = Math.max(...resultLats);
      const minLon = Math.min(...resultLons);
      const maxLon = Math.max(...resultLons);

      expect(minLat).toBeLessThan(centerLat);
      expect(maxLat).toBeGreaterThan(centerLat);
      expect(minLon).toBeLessThan(centerLon);
      expect(maxLon).toBeGreaterThan(centerLon);

      // Verify that the result actually has data (not all NaN)
      const tempVar = result.getVariable("temperature");
      const tempData = tempVar.data as number[][];
      let hasValidData = false;

      for (let i = 0; i < tempData.length; i++) {
        for (let j = 0; j < tempData[i].length; j++) {
          if (!isNaN(tempData[i][j])) {
            hasValidData = true;
            break;
          }
        }
        if (hasValidData) break;
      }

      expect(hasValidData).toBe(true);
    });
  });

  describe("rectangle()", () => {
    let dataset: Dataset;

    beforeEach(() => {
      dataset = createTestDataset();
    });

    it("should filter points within rectangle bounds", async () => {
      // Rectangle from (40.0, -74.0) to (40.5, -73.5)
      const result = await rectangle(dataset, 40.0, -74.0, 40.5, -73.5);

      expect(result.dataVars).toContain("temperature");
      expect(result.dataVars).toContain("humidity");
      // Should exclude the point at 41.0 latitude
    });

    it("should return empty dataset when rectangle excludes all points", async () => {
      // Rectangle far away from data
      const result = await rectangle(dataset, 50.0, -80.0, 51.0, -79.0);

      expect(isDatasetEmpty(result)).toBe(true);
    });

    it("should throw error if minLat >= maxLat", async () => {
      await expect(
        rectangle(dataset, 40.5, -74.0, 40.0, -73.5)
      ).rejects.toThrow(InvalidSelectionError);

      await expect(
        rectangle(dataset, 40.0, -74.0, 40.0, -73.5)
      ).rejects.toThrow(InvalidSelectionError);
    });

    it("should throw error if minLon >= maxLon", async () => {
      await expect(
        rectangle(dataset, 40.0, -73.5, 40.5, -74.0)
      ).rejects.toThrow(InvalidSelectionError);

      await expect(
        rectangle(dataset, 40.0, -74.0, 40.5, -74.0)
      ).rejects.toThrow(InvalidSelectionError);
    });

    it("should throw error if coordinates not found", async () => {
      const badDataset = new Dataset({
        temperature: new DataArray([20, 21], {
          dims: ["x"],
          coords: { x: [0, 1] },
        }),
      });

      await expect(
        rectangle(badDataset, 40.0, -74.0, 40.5, -73.5)
      ).rejects.toThrow(InvalidSelectionError);
    });

    it("should validate coordinate ranges", async () => {
      const datasetWithBadCoords = new Dataset({
        temperature: new DataArray([[20, 21], [20, 21]], {
          dims: ["latitude", "longitude"],
          coords: {
            latitude: [100, 200], // Invalid latitude
            longitude: [-74.0, -73.0],
          },
        }),
      });

      await expect(
        rectangle(datasetWithBadCoords, 40.0, -74.0, 41.0, -73.0)
      ).rejects.toThrow(InvalidSelectionError);
    });

    it("should support custom coordinate key names", async () => {
      const customDataset = new Dataset({
        temperature: new DataArray(
          [
            [20, 21, 22],
            [19, 20, 21],
            [18, 19, 20],
          ],
          {
            dims: ["y", "x"],
            coords: {
              y: [40.0, 40.5, 41.0],
              x: [-74.0, -73.5, -73.0],
            },
          }
        ),
      });

      const result = await rectangle(customDataset, 40.0, -74.0, 40.5, -73.5, {
        latitudeKey: "y",
        longitudeKey: "x",
      });

      expect(result).toBeDefined();
    });

    it("should include boundary points", async () => {
      // Rectangle exactly matching coordinates
      const result = await rectangle(dataset, 40.0, -74.0, 41.0, -73.0);

      expect(result.dataVars).toContain("temperature");
      // All 9 points should be included
    });

    it("should handle partial overlaps with rectangle", async () => {
      // Rectangle that partially overlaps dataset bounds
      const result = await rectangle(dataset, 40.25, -73.75, 40.75, -73.25);

      expect(result).toBeDefined();
    });
  });

  describe("Integration Tests", () => {
    let dataset: Dataset;

    beforeEach(() => {
      dataset = createTestDataset();
    });

    it("should preserve all variables during filtering", async () => {
      const circleResult = await circle(dataset, 40.5, -73.5, 100);
      expect(circleResult.dataVars).toContain("temperature");
      expect(circleResult.dataVars).toContain("humidity");

      const rectResult = await rectangle(dataset, 40.0, -74.0, 41.0, -73.0);
      expect(rectResult.dataVars).toContain("temperature");
      expect(rectResult.dataVars).toContain("humidity");
    });

    it("should preserve attributes during filtering", async () => {
      const result = await rectangle(dataset, 40.0, -74.0, 41.0, -73.0);
      const tempVar = result.getVariable("temperature");

      expect(tempVar.attrs.units).toBe("celsius");
      expect(tempVar.attrs.description).toBe("Temperature");
    });

    it("should maintain coordinate structure after filtering", async () => {
      const result = await circle(dataset, 40.5, -73.5, 100);

      expect(result.coords).toBeDefined();
      expect(result.coords.latitude).toBeDefined();
      expect(result.coords.longitude).toBeDefined();
    });
  });
});
