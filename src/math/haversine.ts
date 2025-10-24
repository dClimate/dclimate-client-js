/**
 * Calculates arclength distance in km between coordinate pairs,
 * assuming the earth is a perfect sphere.
 *
 * @param lat1 - latitude coordinate(s) for first point(s) in decimal degrees
 * @param lon1 - longitude coordinate(s) for first point(s) in decimal degrees
 * @param lat2 - latitude coordinate(s) for second point(s) in decimal degrees
 * @param lon2 - longitude coordinate(s) for second point(s) in decimal degrees
 * @returns distance between coordinate pairs in km (scalar or array matching input dimensions)
 */
export function haversine(
  lat1: number | number[],
  lon1: number | number[],
  lat2: number | number[],
  lon2: number | number[]
): number | number[] {
  // Helper to calculate distance for a single pair of coordinates
  const calculateDistance = (
    lat1Val: number,
    lon1Val: number,
    lat2Val: number,
    lon2Val: number
  ): number => {
    // Convert decimal degrees to radians
    const lon1Rad = (lon1Val * Math.PI) / 180;
    const lon2Rad = (lon2Val * Math.PI) / 180;
    const lat1Rad = (lat1Val * Math.PI) / 180;
    const lat2Rad = (lat2Val * Math.PI) / 180;

    // Haversine formula
    const dlon = lon2Rad - lon1Rad;
    const dlat = lat2Rad - lat1Rad;
    const a =
      Math.sin(dlat / 2) ** 2 +
      Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dlon / 2) ** 2;

    // Handle potential floating-point errors producing negative values for very small distances
    const absA = Math.abs(a);
    const c = 2 * Math.asin(Math.sqrt(absA));

    // Radius of Earth in km
    const EARTH_RADIUS_KM = 6371;
    return c * EARTH_RADIUS_KM;
  };

  // If all inputs are scalars, return scalar
  if (
    typeof lat1 === "number" &&
    typeof lon1 === "number" &&
    typeof lat2 === "number" &&
    typeof lon2 === "number"
  ) {
    return calculateDistance(lat1, lon1, lat2, lon2);
  }

  // Convert scalars to arrays for uniform processing
  const lat1Arr = Array.isArray(lat1) ? lat1 : [lat1];
  const lon1Arr = Array.isArray(lon1) ? lon1 : [lon1];
  const lat2Arr = Array.isArray(lat2) ? lat2 : [lat2];
  const lon2Arr = Array.isArray(lon2) ? lon2 : [lon2];

  // Determine the length of the result array
  const length = Math.max(
    lat1Arr.length,
    lon1Arr.length,
    lat2Arr.length,
    lon2Arr.length
  );

  // Calculate distances for each pair
  const distances = [];
  for (let i = 0; i < length; i++) {
    distances.push(
      calculateDistance(
        lat1Arr[i % lat1Arr.length],
        lon1Arr[i % lon1Arr.length],
        lat2Arr[i % lat2Arr.length],
        lon2Arr[i % lon2Arr.length]
      )
    );
  }

  return distances;
}
