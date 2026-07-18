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
});
