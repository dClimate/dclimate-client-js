import { describe, expect, it } from "vitest";
import { DataArray, Dataset } from "@dclimate/jaxray";
import { NoDataFoundError } from "../../src/errors.js";
import { points } from "../../src/shapes/points.ts";

function createTestDataset(): Dataset {
  const coords = {
    latitude: [40.0, 40.5, 41.0],
    longitude: [-74.0, -73.5, -73.0],
  };

  return new Dataset({
    temperature: new DataArray(
      [
        [101, 102, 103],
        [201, 202, 203],
        [301, 302, 303],
      ],
      { dims: ["latitude", "longitude"], coords }
    ),
    humidity: new DataArray(
      [
        [901, 902, 903],
        [801, 802, 803],
        [701, 702, 703],
      ],
      { dims: ["latitude", "longitude"], coords }
    ),
  });
}

describe("points() vectorized selection", () => {
  it("selects paired grid cells into a point dimension and preserves their coordinates", async () => {
    const result = await points(
      createTestDataset(),
      [40.0, 41.0],
      [-73.0, -73.5]
    );

    const expectedData = {
      temperature: [103, 302],
      humidity: [903, 702],
    };

    for (const [name, data] of Object.entries(expectedData)) {
      const variable = result.getVariable(name);
      expect.soft(variable.dims).toEqual(["point"]);
      expect.soft(variable.shape).toEqual([2]);
      expect.soft(variable.data).toEqual(data);
    }

    expect.soft(result.coords.latitude).toEqual([40.0, 41.0]);
    expect.soft(result.coords.longitude).toEqual([-73.0, -73.5]);
  });

  it("snaps off-grid points to the nearest grid cell by default", async () => {
    const result = await points(createTestDataset(), [40.2], [-73.6]);
    const temperature = result.getVariable("temperature");

    expect.soft(temperature.dims).toEqual(["point"]);
    expect.soft(temperature.data).toEqual([102]);
    expect.soft(result.coords.latitude).toEqual([40.0]);
    expect.soft(result.coords.longitude).toEqual([-73.5]);
  });

  it("rejects an off-grid point when snapToGrid is false", async () => {
    await expect(
      points(createTestDataset(), [40.2], [-74.0], { snapToGrid: false })
    ).rejects.toThrow(NoDataFoundError);
  });

  it("still resolves exact grid points when snapToGrid is false", async () => {
    const result = await points(createTestDataset(), [40.5], [-73.0], {
      snapToGrid: false,
    });
    const temperature = result.getVariable("temperature");

    expect.soft(temperature.dims).toEqual(["point"]);
    expect.soft(temperature.data).toEqual([203]);
    expect.soft(result.coords.latitude).toEqual([40.5]);
    expect.soft(result.coords.longitude).toEqual([-73.0]);
  });
});
