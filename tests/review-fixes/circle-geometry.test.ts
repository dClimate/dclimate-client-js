import { describe, expect, it } from "vitest";
import { DataArray, Dataset } from "@dclimate/jaxray";
import { circle } from "../../src/shapes/circle.ts";
import {
  EARTH_RADIUS_KM,
  haversine,
} from "../../src/math/haversine.ts";

function gridValues(latitudes: number[], longitudes: number[]): number[][] {
  return latitudes.map((_, latitudeIndex) =>
    longitudes.map(
      (_, longitudeIndex) => latitudeIndex * 1_000 + longitudeIndex
    )
  );
}

function spatialDataset(
  latitudes: number[],
  longitudes: number[]
): { dataset: Dataset; values: number[][] } {
  const values = gridValues(latitudes, longitudes);
  return {
    dataset: new Dataset({
      value: new DataArray(values, {
        dims: ["latitude", "longitude"],
        coords: { latitude: latitudes, longitude: longitudes },
      }),
    }),
    values,
  };
}

async function expectHaversineSelection(
  latitudes: number[],
  longitudes: number[],
  centerLatitude: number,
  centerLongitude: number,
  radiusKm: number
): Promise<DataArray> {
  const { dataset, values } = spatialDataset(latitudes, longitudes);
  const inRadius = latitudes.map((latitude) =>
    longitudes.map(
      (longitude) =>
        (haversine(
          centerLatitude,
          centerLongitude,
          latitude,
          longitude
        ) as number) <= radiusKm
    )
  );
  const expectedLatitudeIndices = latitudes
    .map((_, index) => index)
    .filter((index) => inRadius[index].some(Boolean));
  const expectedLongitudeIndices = longitudes
    .map((_, index) => index)
    .filter((index) => inRadius.some((row) => row[index]));

  const result = await circle(
    dataset,
    centerLatitude,
    centerLongitude,
    radiusKm
  );
  const variable = result.getVariable("value");

  expect(variable.coords.latitude).toEqual(
    expectedLatitudeIndices.map((index) => latitudes[index])
  );
  expect(variable.coords.longitude).toEqual(
    expectedLongitudeIndices.map((index) => longitudes[index])
  );

  const actual = variable.data as unknown[][];
  expectedLatitudeIndices.forEach((latitudeIndex, resultLatitudeIndex) => {
    expectedLongitudeIndices.forEach(
      (longitudeIndex, resultLongitudeIndex) => {
        const value = actual[resultLatitudeIndex][resultLongitudeIndex];
        if (inRadius[latitudeIndex][longitudeIndex]) {
          expect(value).toBe(values[latitudeIndex][longitudeIndex]);
        } else {
          expect(value == null || Number.isNaN(value as number)).toBe(true);
        }
      }
    );
  });

  return variable;
}

describe("circle() geometry review fixes", () => {
  it("keeps all over-pole cells selected by haversine", async () => {
    const latitudes = [88, 89, 89.5];
    const longitudes = [-180, -90, 0, 90];

    const variable = await expectHaversineSelection(
      latitudes,
      longitudes,
      89.5,
      0,
      120
    );

    expect(variable.coords.longitude).toContain(-180);
  });

  it("keeps both sides of a wrapped 0-360 longitude grid", async () => {
    const latitudes = [-1, 0, 1];
    const longitudes = [0, 1, 2, 358, 359];

    const variable = await expectHaversineSelection(
      latitudes,
      longitudes,
      0,
      0.5,
      200
    );

    expect(variable.coords.longitude).toContain(359);
  });

  it("uses the spherical longitude extent at high latitude", async () => {
    const latitudes = [79, 80, 81];
    const longitudes = [0, 26.2];

    const variable = await expectHaversineSelection(
      latitudes,
      longitudes,
      80,
      0,
      500
    );

    expect(variable.coords.longitude).toContain(26.2);
  });

  it("keeps a boundary sliver at 0.999 times the radius", async () => {
    const radiusKm = 100;
    const boundaryLatitude =
      ((radiusKm * 0.999) / EARTH_RADIUS_KM) * (180 / Math.PI);
    const latitudes = [-boundaryLatitude, 0, boundaryLatitude];
    const longitudes = [0];

    expect(
      haversine(0, 0, boundaryLatitude, 0) as number
    ).toBeLessThanOrEqual(radiusKm);
    const variable = await expectHaversineSelection(
      latitudes,
      longitudes,
      0,
      0,
      radiusKm
    );

    expect(variable.coords.latitude).toEqual(latitudes);
  });

  it("accepts float32-decoded coordinates without a mask mismatch", async () => {
    const latitudes = [
      39.09999847412109,
      39.29999923706055,
      39.5,
      39.70000076293945,
      39.90000152587891,
    ];
    const longitudes = [
      -74.5,
      -74.30000305175781,
      -74.09999847412109,
      -73.9000015258789,
      -73.7,
    ];

    await expectHaversineSelection(
      latitudes,
      longitudes,
      39.5,
      -74.1,
      40
    );
  });

  it("preserves variable attributes through masking", async () => {
    const latitudes = [0, 1, 2, 3, 4];
    const longitudes = [10, 11, 12, 13, 14];
    const dataset = new Dataset({
      temperature: new DataArray(gridValues(latitudes, longitudes), {
        dims: ["latitude", "longitude"],
        coords: { latitude: latitudes, longitude: longitudes },
        attrs: { units: "degC", long_name: "air temperature" },
      }),
    });

    const result = await circle(dataset, 2, 12, 120);

    expect(result.getVariable("temperature").attrs).toMatchObject({
      units: "degC",
      long_name: "air temperature",
    });
  });
});
