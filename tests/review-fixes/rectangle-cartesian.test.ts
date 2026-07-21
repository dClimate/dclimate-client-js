import { describe, expect, it } from "vitest";
import { Dataset, DataArray } from "@dclimate/jaxray";
import { rectangle } from "../../src/shapes/rectangle.ts";

describe("rectangle()", () => {
  it("should not cartesian-product duplicate latitude and longitude selections", async () => {
    const dataset = new Dataset({
      temperature: new DataArray(
        [
          [11, 12, 13],
          [21, 22, 23],
          [31, 32, 33],
        ],
        {
          dims: ["latitude", "longitude"],
          coords: {
            latitude: [40.0, 40.5, 41.0],
            longitude: [-74.0, -73.5, -73.0],
          },
        }
      ),
    });

    const result = await rectangle(dataset, 40.0, -74.0, 40.5, -73.5);
    const temperature = result.getVariable("temperature");

    expect(temperature.shape).toEqual([2, 2]);
    expect(temperature.coords.latitude).toEqual([40.0, 40.5]);
    expect(temperature.coords.longitude).toEqual([-74.0, -73.5]);
    expect(temperature.data).toEqual([
      [11, 12],
      [21, 22],
    ]);
  });

  it("should preserve descending grid order instead of sorting", async () => {
    const dataset = new Dataset({
      temperature: new DataArray(
        [
          [11, 12, 13],
          [21, 22, 23],
          [31, 32, 33],
        ],
        {
          dims: ["latitude", "longitude"],
          coords: {
            latitude: [41.0, 40.5, 40.0],
            longitude: [-74.0, -73.5, -73.0],
          },
        }
      ),
    });

    const result = await rectangle(dataset, 40.0, -74.0, 40.5, -73.5);
    const temperature = result.getVariable("temperature");

    expect(temperature.coords.latitude).toEqual([40.5, 40.0]);
    expect(temperature.coords.longitude).toEqual([-74.0, -73.5]);
    expect(temperature.data).toEqual([
      [21, 22],
      [31, 32],
    ]);
  });

  it("should return an empty dataset when only one axis has coordinates in range", async () => {
    const dataset = new Dataset({
      temperature: new DataArray(
        [
          [11, 12],
          [21, 22],
        ],
        {
          dims: ["latitude", "longitude"],
          coords: {
            latitude: [40.0, 40.5],
            longitude: [-74.0, -73.5],
          },
        }
      ),
    });

    // Latitudes are in range but no longitude falls inside the box
    const result = await rectangle(dataset, 40.0, -60.0, 40.5, -59.0);
    expect(result.dataVars).toEqual([]);
  });
});
