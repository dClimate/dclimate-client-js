import { describe, expect, it } from "vitest";
import { haversine } from "../../src/math/haversine.js";

describe("haversine array length validation", () => {
  it("throws RangeError instead of cycling arrays with different multi-element lengths", () => {
    expect(() =>
      haversine([0, 0, 0], [0, 0, 0], [10, 20], [0, 0]),
    ).toThrow(RangeError);
  });

  it("throws RangeError when latitude and longitude have different multi-element lengths", () => {
    expect(() => haversine([5, 6], [7, 8, 99], [0], [0])).toThrow(
      RangeError,
    );
  });

  it("[passing invariant] broadcasts scalar and length-one inputs", () => {
    const distances = haversine([0, 0, 0], [0], 0, [1, 2, 3]);

    expect(distances).toHaveLength(3);
    expect(distances).toEqual([
      haversine(0, 0, 0, 1),
      haversine(0, 0, 0, 2),
      haversine(0, 0, 0, 3),
    ]);
  });

  it("[passing invariant] accepts arrays with equal lengths", () => {
    const distances = haversine([0, 10], [0, 20], [1, 11], [1, 21]);

    expect(distances).toHaveLength(2);
    expect(distances).toEqual([
      haversine(0, 0, 1, 1),
      haversine(10, 20, 11, 21),
    ]);
  });
});
