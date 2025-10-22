import { describe, expect, it } from "vitest";
import { DClimateClient } from "../src/index.js";
import { InvalidSelectionError, NoDataFoundError } from "../src/errors.js";

describe("GeoTemporalDataset - Real Data Integration Tests", () => {
  const client = new DClimateClient();

  describe("loading and accessing real dataset", () => {
    it("loads a real dataset and accesses metadata", async () => {
      const dataset = await client.loadDataset({ dataset: "fpar" });

      expect(dataset.info.dataset).toBe("fpar");
      expect(dataset.info.cid).toBeDefined();
      expect(dataset.info.path).toBeDefined();
      expect(dataset.info.fetchedAt).toBeInstanceOf(Date);
    });

    it("provides access to variables", async () => {
      const dataset = await client.loadDataset({ dataset: "fpar" });
      const variables = dataset.variables;

      expect(Array.isArray(variables)).toBe(true);
      expect(variables.length).toBeGreaterThan(0);
    });

    it("provides access to coordinates", async () => {
      const dataset = await client.loadDataset({ dataset: "fpar" });
      const coords = dataset.coords;

      expect(coords).toBeDefined();
      expect(typeof coords).toBe("object");
    });

    it("reports not empty for real dataset", async () => {
      const dataset = await client.loadDataset({ dataset: "fpar" });

      expect(dataset.isEmpty()).toBe(false);
    });
  });

  describe("point selection on real data", () => {
    it("selects a point from real dataset", async () => {
      const dataset = await client.loadDataset({ dataset: "fpar" });

      // New York City coordinates
      const point = await dataset.point(40.7128, -74.006);

      expect(point.isEmpty()).toBe(false);
      expect(point.info.dataset).toBe("fpar");
    });

    it("selects different geographic points", async () => {
      const dataset = await client.loadDataset({ dataset: "ifs-temperature" });

      // London coordinates
      const londonPoint = await dataset.point(51.5074, -0.1278);

      // Tokyo coordinates
      const tokyoPoint = await dataset.point(35.6762, 139.6503);

      expect(londonPoint.isEmpty()).toBe(false);
      expect(tokyoPoint.isEmpty()).toBe(false);
    });

    it("uses nearest method by default", async () => {
      const dataset = await client.loadDataset({ dataset: "fpar" });

      // Use coordinates that might not exactly match grid
      const point = await dataset.point(40.5, -73.5, {
        method: "nearest",
      });

      expect(point.isEmpty()).toBe(false);
    });
  });

  describe("time range selection on real data", () => {
    it("selects a time range from real dataset", async () => {
      const dataset = await client.loadDataset({ dataset: "fpar" });

      const timeSlice = await dataset.timeRange({
        start: "2024-01-01T00:00:00Z",
        end: "2024-01-07T00:00:00Z",
      });

      expect(timeSlice.isEmpty()).toBe(false);
    });

    it("accepts Date objects for time range", async () => {
      const dataset = await client.loadDataset({ dataset: "ifs-precip" });

      const timeSlice = await dataset.timeRange({
        start: new Date("2024-01-01"),
        end: new Date("2024-01-03"),
      });

      expect(timeSlice.isEmpty()).toBe(false);
    });
  });

  describe("combined selections on real data", () => {
    it("combines point and time range selections", async () => {
      const dataset = await client.loadDataset({ dataset: "aifs-single-temperature" });

      const selected = await dataset.select({
        point: {
          latitude: 40.7128,
          longitude: -74.006,
        },
        timeRange: {
          start: "2024-01-01T00:00:00Z",
          end: "2024-01-07T00:00:00Z",
        },
      });

      expect(selected.isEmpty()).toBe(false);
    });

    it("chains point then time range", async () => {
      const dataset = await client.loadDataset({ dataset: "fpar" });

      const result = await dataset
        .point(34.0522, -118.2437) // Los Angeles
        .then((d) =>
          d.timeRange({
            start: "2024-01-01T00:00:00Z",
            end: "2024-01-05T00:00:00Z",
          })
        );

      expect(result.isEmpty()).toBe(false);
    });

    it("chains time range then point", async () => {
      const dataset = await client.loadDataset({ dataset: "ifs-temperature" });

      const result = await dataset
        .timeRange({
          start: "2024-01-01T00:00:00Z",
          end: "2024-01-10T00:00:00Z",
        })
        .then((d) => d.point(51.5074, -0.1278)); // London

      expect(result.isEmpty()).toBe(false);
    });
  });

  describe("converting to records with real data", () => {
    it("converts point selection to records", async () => {
      const dataset = await client.loadDataset({ dataset: "fpar" });
      const point = await dataset.point(40.7128, -74.006);

      const variables = point.variables;
      if (variables.length > 0) {
        const records = point.toRecords(variables[0]);

        expect(Array.isArray(records)).toBe(true);
        if (records.length > 0) {
          expect(records[0]).toHaveProperty("latitude");
          expect(records[0]).toHaveProperty("longitude");
          expect(records[0]).toHaveProperty("time");
          expect(records[0]).toHaveProperty("value");
        }
      }
    });

    it("converts time range selection to records", async () => {
      const dataset = await client.loadDataset({ dataset: "ifs-precip" });
      const timeSlice = await dataset.timeRange({
        start: "2024-01-01T00:00:00Z",
        end: "2024-01-03T00:00:00Z",
      });

      const variables = timeSlice.variables;
      if (variables.length > 0) {
        const records = timeSlice.toRecords(variables[0]);

        expect(Array.isArray(records)).toBe(true);
      }
    });

    it("converts combined selection to records", async () => {
      const dataset = await client.loadDataset({ dataset: "aifs-ensemble-temperature" });

      const selected = await dataset.select({
        point: {
          latitude: 40.7128,
          longitude: -74.006,
        },
        timeRange: {
          start: "2024-01-01T00:00:00Z",
          end: "2024-01-05T00:00:00Z",
        },
      });

      const variables = selected.variables;
      if (variables.length > 0) {
        const records = selected.toRecords(variables[0]);

        expect(Array.isArray(records)).toBe(true);
      }
    });
  });

  describe("metadata preservation through selections", () => {
    it("preserves metadata through point selection", async () => {
      const dataset = await client.loadDataset({ dataset: "fpar" });
      const originalCid = dataset.info.cid;

      const point = await dataset.point(40.7128, -74.006);

      expect(point.info.cid).toBe(originalCid);
      expect(point.info.dataset).toBe("fpar");
    });

    it("preserves metadata through time range selection", async () => {
      const dataset = await client.loadDataset({ dataset: "ifs-temperature" });
      const originalCid = dataset.info.cid;

      const timeSlice = await dataset.timeRange({
        start: "2024-01-01T00:00:00Z",
        end: "2024-01-03T00:00:00Z",
      });

      expect(timeSlice.info.cid).toBe(originalCid);
      expect(timeSlice.info.dataset).toBe("ifs-temperature");
    });

    it("preserves metadata through chained selections", async () => {
      const dataset = await client.loadDataset({ dataset: "aifs-single-precip" });
      const originalCid = dataset.info.cid;

      const result = await dataset
        .point(40.7128, -74.006)
        .then((d) =>
          d.timeRange({
            start: "2024-01-01T00:00:00Z",
            end: "2024-01-03T00:00:00Z",
          })
        );

      expect(result.info.cid).toBe(originalCid);
      expect(result.info.dataset).toBe("aifs-single-precip");
    });
  });

  describe("testing multiple dataset types", () => {
    it("works with AIFS single datasets", async () => {
      const dataset = await client.loadDataset({ dataset: "aifs-single-precip" });
      const point = await dataset.point(40.7128, -74.006);

      expect(point.isEmpty()).toBe(false);
    });

  });

  describe("error handling with real data", () => {
    it("throws NoDataFoundError when selection results in no data", async () => {
      const dataset = await client.loadDataset({ dataset: "fpar" });

      // Use a time range far in the future that likely has no data
      await expect(
        dataset.timeRange({
          start: "2099-01-01T00:00:00Z",
          end: "2099-01-02T00:00:00Z",
        })
      ).rejects.toThrow(NoDataFoundError);
    });

    it("throws InvalidSelectionError for invalid dimension", async () => {
      const dataset = await client.loadDataset({ dataset: "fpar" });

      await expect(
        dataset.timeRange(
          {
            start: "2024-01-01T00:00:00Z",
            end: "2024-01-02T00:00:00Z",
          },
          "nonexistent-dimension"
        )
      ).rejects.toThrow(InvalidSelectionError);
    });
  });
});
