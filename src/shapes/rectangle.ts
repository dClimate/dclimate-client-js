import { Dataset } from "@dclimate/jaxray";
import { InvalidSelectionError } from "../errors.js";

/**
 * Selects data points within a rectangular bounding box region
 *
 * @param dataset - The jaxray Dataset to filter
 * @param minLat - Southern latitude boundary in decimal degrees
 * @param minLon - Western longitude boundary in decimal degrees
 * @param maxLat - Northern latitude boundary in decimal degrees
 * @param maxLon - Eastern longitude boundary in decimal degrees
 * @param options - Configuration options
 * @param options.latitudeKey - Name of latitude coordinate (default: "latitude")
 * @param options.longitudeKey - Name of longitude coordinate (default: "longitude")
 * @returns A new Dataset with data within the specified rectangular region
 * @throws InvalidSelectionError if boundaries are invalid or coordinates not found
 *
 * @example
 * ```typescript
 * const data = await Dataset.open_zarr(store);
 * // Get all data within a rectangle
 * const result = await rectangle(data, 40.0, -75.0, 41.0, -74.0);
 * ```
 */
export async function rectangle(
  dataset: Dataset,
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number,
  options: {
    latitudeKey?: string;
    longitudeKey?: string;
  } = {}
): Promise<Dataset> {
  const { latitudeKey = "latitude", longitudeKey = "longitude" } = options;

  // Validate boundaries
  if (minLat >= maxLat) {
    throw new InvalidSelectionError(
      `minLat (${minLat}) must be less than maxLat (${maxLat})`
    );
  }

  if (minLon >= maxLon) {
    throw new InvalidSelectionError(
      `minLon (${minLon}) must be less than maxLon (${maxLon})`
    );
  }

  // Get the latitude and longitude coordinates
  const coords = dataset.coords;
  const latCoords = coords[latitudeKey];
  const lonCoords = coords[longitudeKey];

  if (!latCoords || !lonCoords) {
    throw new InvalidSelectionError(
      `Latitude (${latitudeKey}) and/or longitude (${longitudeKey}) coordinates not found in dataset`
    );
  }

  if (
    !Array.isArray(latCoords) ||
    !Array.isArray(lonCoords) ||
    latCoords.length === 0 ||
    lonCoords.length === 0
  ) {
    throw new InvalidSelectionError(
      "Latitude and longitude coordinates must be non-empty arrays"
    );
  }

  // Convert and validate latitude coordinates
  const latArray = latCoords.map((v) => {
    const num = typeof v === "number" ? v : Number(v);
    if (isNaN(num) || num < -90 || num > 90) {
      throw new InvalidSelectionError(
        `Invalid latitude coordinate: ${v}. Must be between -90 and 90.`
      );
    }
    return num;
  });

  // Convert and validate longitude coordinates
  const lonArray = lonCoords.map((v) => {
    const num = typeof v === "number" ? v : Number(v);
    if (isNaN(num) || num < -180 || num > 180) {
      throw new InvalidSelectionError(
        `Invalid longitude coordinate: ${v}. Must be between -180 and 180.`
      );
    }
    return num;
  });

  // Find coordinates within the rectangle bounds
  const selectedLats: number[] = [];
  const selectedLons: number[] = [];

  for (let i = 0; i < latArray.length; i++) {
    const lat = latArray[i];
    if (lat >= minLat && lat <= maxLat) {
      for (let j = 0; j < lonArray.length; j++) {
        const lon = lonArray[j];
        if (lon >= minLon && lon <= maxLon) {
          selectedLats.push(lat);
          selectedLons.push(lon);
        }
      }
    }
  }

  // If no points in rectangle, return empty dataset
  if (selectedLats.length === 0) {
    return new Dataset({});
  }

  // Use sel to filter the dataset by the coordinates within rectangle
  const filtered = await dataset.sel({
    [latitudeKey]: selectedLats,
    [longitudeKey]: selectedLons,
  } as any);

  return filtered;
}
