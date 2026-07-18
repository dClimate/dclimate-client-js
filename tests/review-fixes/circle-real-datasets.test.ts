import { describe, expect, it } from "vitest";
import { Dataset, DataArray } from "@dclimate/jaxray";
import { circle } from "../../src/shapes/circle.ts";
import { haversine } from "../../src/math/haversine.ts";

const latitudes = [0, 1, 2, 3, 4];
const longitudes = [10, 11, 12, 13, 14];
const centerLatitude = 2;
const centerLongitude = 12;
const radiusKm = 120;

type SpatialExpectation = {
  latitudeIndices: number[];
  longitudeIndices: number[];
  inRadius: boolean[][];
};

function expectedSpatialSelection(): SpatialExpectation {
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

  return {
    latitudeIndices: latitudes
      .map((_, index) => index)
      .filter((latitudeIndex) => inRadius[latitudeIndex].some(Boolean)),
    longitudeIndices: longitudes
      .map((_, index) => index)
      .filter((longitudeIndex) =>
        inRadius.some((row) => row[longitudeIndex])
      ),
    inRadius,
  };
}

function expectSpatialCoordinates(
  dataArray: DataArray,
  expected: SpatialExpectation
): void {
  expect(dataArray.coords.latitude).toEqual(
    expected.latitudeIndices.map((index) => latitudes[index])
  );
  expect(dataArray.coords.longitude).toEqual(
    expected.longitudeIndices.map((index) => longitudes[index])
  );
}

function expectMasked2DValues(
  actual: unknown,
  original: number[][],
  expected: SpatialExpectation
): void {
  const data = actual as unknown[][];
  let outsideCircleCount = 0;

  expected.latitudeIndices.forEach((latitudeIndex, resultLatitudeIndex) => {
    expected.longitudeIndices.forEach(
      (longitudeIndex, resultLongitudeIndex) => {
        const value = data[resultLatitudeIndex][resultLongitudeIndex];
        if (expected.inRadius[latitudeIndex][longitudeIndex]) {
          expect(value).toBe(original[latitudeIndex][longitudeIndex]);
        } else {
          outsideCircleCount += 1;
          expect(
            value == null || Number.isNaN(value as number)
          ).toBe(true);
        }
      }
    );
  });

  expect(outsideCircleCount).toBeGreaterThan(0);
}

describe("circle() with real jaxray datasets", () => {
  it("trims an eager 2D dataset to the circle's spatial bounding box", async () => {
    const values = latitudes.map((_, latitudeIndex) =>
      longitudes.map(
        (_, longitudeIndex) => 1_000 + latitudeIndex * 100 + longitudeIndex * 7
      )
    );
    const dataset = new Dataset({
      temperature: new DataArray(values, {
        dims: ["latitude", "longitude"],
        coords: { latitude: latitudes, longitude: longitudes },
      }),
    });
    const expected = expectedSpatialSelection();

    const result = await circle(
      dataset,
      centerLatitude,
      centerLongitude,
      radiusKm
    );

    expect(result.dataVars).toEqual(["temperature"]);
    const temperature = result.getVariable("temperature");
    expect(temperature.shape).toEqual([
      expected.latitudeIndices.length,
      expected.longitudeIndices.length,
    ]);
    expectSpatialCoordinates(temperature, expected);
    expectMasked2DValues(temperature.data, values, expected);
  });

  it("preserves time while trimming a 3D dataset's spatial dimensions", async () => {
    const times = ["2025-01-01T00:00:00.000Z", "2025-01-02T00:00:00.000Z"];
    const values = times.map((_, timeIndex) =>
      latitudes.map((_, latitudeIndex) =>
        longitudes.map(
          (_, longitudeIndex) =>
            10_000 * (timeIndex + 1) + latitudeIndex * 100 + longitudeIndex * 7
        )
      )
    );
    const dataset = new Dataset({
      temperature: new DataArray(values, {
        dims: ["time", "latitude", "longitude"],
        coords: {
          time: times,
          latitude: latitudes,
          longitude: longitudes,
        },
      }),
    });
    const expected = expectedSpatialSelection();

    const result = await circle(
      dataset,
      centerLatitude,
      centerLongitude,
      radiusKm
    );

    expect(result.dataVars).toEqual(["temperature"]);
    const temperature = result.getVariable("temperature");
    expect(temperature.dims).toEqual(["time", "latitude", "longitude"]);
    expect(temperature.shape).toEqual([
      times.length,
      expected.latitudeIndices.length,
      expected.longitudeIndices.length,
    ]);
    expect(temperature.coords.time).toEqual(times);
    expectSpatialCoordinates(temperature, expected);

    const actual = temperature.data as unknown[][][];
    times.forEach((_, timeIndex) => {
      expectMasked2DValues(actual[timeIndex], values[timeIndex], expected);
    });
  });

  it("supports a lazy zarr-style DataArray and returns the trimmed circle", async () => {
    const values = latitudes.map((_, latitudeIndex) =>
      longitudes.map(
        (_, longitudeIndex) => 50_000 + latitudeIndex * 100 + longitudeIndex * 7
      )
    );
    type IndexRange = { start: number; stop: number } | number;

    const loader = async (ranges: Record<string, IndexRange>) => {
      const latitudeRange = ranges.latitude ?? {
        start: 0,
        stop: latitudes.length,
      };
      const longitudeRange = ranges.longitude ?? {
        start: 0,
        stop: longitudes.length,
      };
      const latitudeIndices =
        typeof latitudeRange === "number"
          ? [latitudeRange]
          : Array.from(
              { length: latitudeRange.stop - latitudeRange.start },
              (_, offset) => latitudeRange.start + offset
            );
      const longitudeIndices =
        typeof longitudeRange === "number"
          ? [longitudeRange]
          : Array.from(
              { length: longitudeRange.stop - longitudeRange.start },
              (_, offset) => longitudeRange.start + offset
            );
      const selected = latitudeIndices.map((latitudeIndex) =>
        longitudeIndices.map(
          (longitudeIndex) => values[latitudeIndex][longitudeIndex]
        )
      );

      if (
        typeof latitudeRange === "number" &&
        typeof longitudeRange === "number"
      ) {
        return selected[0][0];
      }
      if (typeof latitudeRange === "number") return selected[0];
      if (typeof longitudeRange === "number") {
        return selected.map((row) => row[0]);
      }
      return selected;
    };

    const lazyTemperature = new DataArray(null, {
      lazy: true,
      virtualShape: [latitudes.length, longitudes.length],
      lazyLoader: loader,
      dims: ["latitude", "longitude"],
      coords: { latitude: latitudes, longitude: longitudes },
    });
    expect(lazyTemperature.isLazy).toBe(true);

    const dataset = new Dataset({ temperature: lazyTemperature });
    const expected = expectedSpatialSelection();
    const result = await circle(
      dataset,
      centerLatitude,
      centerLongitude,
      radiusKm
    );

    expect(result.dataVars).toEqual(["temperature"]);
    const materialized = await result.compute();
    const temperature = materialized.getVariable("temperature");
    expect(temperature.shape).toEqual([
      expected.latitudeIndices.length,
      expected.longitudeIndices.length,
    ]);
    expectSpatialCoordinates(temperature, expected);
    expectMasked2DValues(temperature.data, values, expected);
  });
});
