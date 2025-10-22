import { describe, expect, it } from "vitest";
import {
  getDatasetEndpoint,
  listDatasetKeys,
  HydrogenEndpoint,
  DATASET_ENDPOINTS,
  type DatasetKey,
} from "../src/datasets.js";

describe("datasets", () => {
  describe("getDatasetEndpoint", () => {
    it("returns the correct endpoint for a valid dataset key", () => {
      const endpoint = getDatasetEndpoint("fpar");
      expect(endpoint).toBe(`${HydrogenEndpoint}/fpar`);
    });

    it("returns the correct endpoint for aifs-single-precip", () => {
      const endpoint = getDatasetEndpoint("aifs-single-precip");
      expect(endpoint).toBe(`${HydrogenEndpoint}/aifs-single-precip`);
    });

    it("returns the correct endpoint for ifs-temperature", () => {
      const endpoint = getDatasetEndpoint("ifs-temperature");
      expect(endpoint).toBe(`${HydrogenEndpoint}/ifs-temperature`);
    });

    it("returns the correct endpoint for all dataset keys", () => {
      const keys: DatasetKey[] = [
        "fpar",
        "aifs-single-precip",
        "aifs-single-temperature",
        "aifs-single-wind-u",
        "aifs-single-wind-v",
        "aifs-single-solar-radiation",
        "aifs-ensemble-precip",
        "aifs-ensemble-temperature",
        "aifs-ensemble-wind-u",
        "aifs-ensemble-wind-v",
        "aifs-ensemble-solar-radiation",
        "ifs-precip",
        "ifs-temperature",
        "ifs-wind-u",
        "ifs-wind-v",
        "ifs-soil-moisture-l3",
        "ifs-solar-radiation",
      ];

      keys.forEach((key) => {
        const endpoint = getDatasetEndpoint(key);
        expect(endpoint).toBe(`${HydrogenEndpoint}/${key}`);
        expect(endpoint).toBe(DATASET_ENDPOINTS[key]);
      });
    });
  });

  describe("listDatasetKeys", () => {
    it("returns an array of all dataset keys", () => {
      const keys = listDatasetKeys();
      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBeGreaterThan(0);
    });

    it("returns all expected dataset keys", () => {
      const keys = listDatasetKeys();
      const expectedKeys: DatasetKey[] = [
        "fpar",
        "aifs-single-precip",
        "aifs-single-temperature",
        "aifs-single-wind-u",
        "aifs-single-wind-v",
        "aifs-single-solar-radiation",
        "aifs-ensemble-precip",
        "aifs-ensemble-temperature",
        "aifs-ensemble-wind-u",
        "aifs-ensemble-wind-v",
        "aifs-ensemble-solar-radiation",
        "ifs-precip",
        "ifs-temperature",
        "ifs-wind-u",
        "ifs-wind-v",
        "ifs-soil-moisture-l3",
        "ifs-solar-radiation",
      ];

      expect(keys).toEqual(expect.arrayContaining(expectedKeys));
      expect(keys.length).toBe(expectedKeys.length);
    });

    it("returns keys that match DATASET_ENDPOINTS keys", () => {
      const keys = listDatasetKeys();
      const endpointKeys = Object.keys(DATASET_ENDPOINTS);
      expect(keys.sort()).toEqual(endpointKeys.sort());
    });

    it("each key returned should have a corresponding endpoint", () => {
      const keys = listDatasetKeys();
      keys.forEach((key) => {
        const endpoint = getDatasetEndpoint(key);
        expect(endpoint).toBeDefined();
        expect(typeof endpoint).toBe("string");
        expect(endpoint).toContain(HydrogenEndpoint);
      });
    });
  });
});
