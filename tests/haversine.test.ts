import { describe, it, expect } from "vitest";
import { haversine } from "../src/math/haversine";

describe("haversine", () => {
  it.only("should calculate distance between two points (scalar inputs)", () => {
    // New York City to Los Angeles
    const lat1 = 40.7128;
    const lon1 = -74.006;
    const lat2 = 34.0522;
    const lon2 = -118.2437;

    const distance = haversine(lat1, lon1, lat2, lon2);

    // Expected distance is approximately 3944 km
    expect(typeof distance).toBe("number");
    expect(distance).toBeCloseTo(3936, -1); // Within 10 km
  });

  it("should calculate zero distance between same coordinates", () => {
    const distance = haversine(40.7128, -74.006, 40.7128, -74.006);

    expect(distance).toBeCloseTo(0, 5);
  });

  it("should calculate distance on equator (same latitude)", () => {
    // Two points on the equator, 1 degree apart (approximately 111.32 km)
    const distance = haversine(0, 0, 0, 1);

    expect(distance).toBeCloseTo(111.32, 0);
  });

  it("should calculate distance along meridian (same longitude)", () => {
    // Two points on the same meridian, 1 degree apart (approximately 111.32 km)
    const distance = haversine(0, 0, 1, 0);

    expect(distance).toBeCloseTo(111.32, 0);
  });

  it("should handle array inputs for first point", () => {
    const lat1 = [40.7128, 34.0522];
    const lon1 = [-74.006, -118.2437];
    const lat2 = 40.7128;
    const lon2 = -74.006;

    const distances = haversine(lat1, lon1, lat2, lon2);

    expect(Array.isArray(distances)).toBe(true);
    expect(distances).toHaveLength(2);
    expect((distances as number[])[0]).toBeCloseTo(0, 5);
    expect((distances as number[])[1]).toBeGreaterThan(0);
  });

  it("should handle array inputs for both points", () => {
    const lat1 = [40.7128, 34.0522];
    const lon1 = [-74.006, -118.2437];
    const lat2 = [34.0522, 40.7128];
    const lon2 = [-118.2437, -74.006];

    const distances = haversine(lat1, lon1, lat2, lon2);

    expect(Array.isArray(distances)).toBe(true);
    expect(distances).toHaveLength(2);
    // Both should be the same distance (NYC to LA and back)
    expect((distances as number[])[0]).toBeCloseTo(3944, -1);
    expect((distances as number[])[1]).toBeCloseTo(3944, -1);
  });

  it("should handle mixed scalar and array inputs", () => {
    const lat1 = 40.7128;
    const lon1 = [-74.006, -118.2437];
    const lat2 = [34.0522, 40.7128];
    const lon2 = -118.2437;

    const distances = haversine(lat1, lon1, lat2, lon2);

    expect(Array.isArray(distances)).toBe(true);
    expect(distances).toHaveLength(2);
  });

  it("should calculate distance between points across hemispheres", () => {
    // London to Sydney
    const lat1 = 51.5074;
    const lon1 = -0.1278;
    const lat2 = -33.8688;
    const lon2 = 151.2093;

    const distance = haversine(lat1, lon1, lat2, lon2);

    // Expected distance is approximately 16994 km
    expect(distance).toBeCloseTo(16994, -2);
  });

  it("should handle negative coordinates (South and West)", () => {
    // Buenos Aires to Cape Town
    const lat1 = -34.6037;
    const lon1 = -58.3816;
    const lat2 = -33.9249;
    const lon2 = 18.4241;

    const distance = haversine(lat1, lon1, lat2, lon2);

    // Expected distance is approximately 6930 km
    expect(distance).toBeCloseTo(6930, -1);
  });

  it("should broadcast arrays of different lengths", () => {
    const lat1 = [0, 0, 0];
    const lon1 = 0;
    const lat2 = 0;
    const lon2 = [1, 2, 3];

    const distances = haversine(lat1, lon1, lat2, lon2);

    expect(Array.isArray(distances)).toBe(true);
    expect(distances).toHaveLength(3);
    // Each distance should increase
    expect((distances as number[])[0]).toBeLessThan((distances as number[])[1]);
    expect((distances as number[])[1]).toBeLessThan((distances as number[])[2]);
  });
});
