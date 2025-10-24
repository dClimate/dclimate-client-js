import { Dataset, DataArray } from "@dclimate/jaxray";
import { haversine } from "../math/haversine.js";
import { InvalidSelectionError } from "../errors.js";

/**
 * Selects data points within a circular region defined by center coordinates and radius
 *
 * @param dataset - The jaxray Dataset to filter
 * @param centerLat - Latitude of circle center in decimal degrees
 * @param centerLon - Longitude of circle center in decimal degrees
 * @param radiusKm - Radius of the circle in kilometers
 * @param options - Configuration options
 * @param options.latitudeKey - Name of latitude coordinate (default: "latitude")
 * @param options.longitudeKey - Name of longitude coordinate (default: "longitude")
 * @returns A new Dataset with data within the specified circular region
 * @throws InvalidSelectionError if latitude or longitude coordinates not found
 *
 * @example
 * ```typescript
 * const data = await Dataset.open_zarr(store);
 * // Get all data within 100km of New York City
 * const result = await circle(data, 40.7128, -74.0060, 100);
 * ```
 */
export async function circle(
  dataset: Dataset,
  centerLat: number,
  centerLon: number,
  radiusKm: number,
  options: {
    latitudeKey?: string;
    longitudeKey?: string;
  } = {}
): Promise<Dataset> {
  const { latitudeKey = "latitude", longitudeKey = "longitude" } = options;

  // Validate radius
  if (radiusKm <= 0) {
    throw new InvalidSelectionError("Radius must be a positive number");
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

  // Convert coordinates to numbers if needed
  const latArray = latCoords.map((v) => {
    const num = typeof v === "number" ? v : Number(v);
    if (isNaN(num)) {
      throw new InvalidSelectionError(
        `Invalid latitude coordinate: ${v}`
      );
    }
    return num;
  });

  const lonArray = lonCoords.map((v) => {
    const num = typeof v === "number" ? v : Number(v);
    if (isNaN(num)) {
      throw new InvalidSelectionError(`Invalid longitude coordinate: ${v}`);
    }
    return num;
  });

  // Create a 2D boolean mask for all lat/lon combinations
  const maskData: boolean[][] = [];
  let anyTrue = false;
  for (let latIdx = 0; latIdx < latArray.length; latIdx++) {
    const row: boolean[] = [];
    for (let lonIdx = 0; lonIdx < lonArray.length; lonIdx++) {
      const distance = haversine(
        centerLat,
        centerLon,
        latArray[latIdx],
        lonArray[lonIdx]
      ) as number;
      const isWithinRadius = distance <= radiusKm;
      row.push(isWithinRadius);
      if (isWithinRadius) {
        anyTrue = true;
      }
    }
    maskData.push(row);
  }

  // If no points within radius, return empty dataset immediately
  if (!anyTrue) {
    return new Dataset({});
  }

  // Create mask DataArray
  const maskArray = new DataArray(maskData, {
    dims: [latitudeKey, longitudeKey],
    coords: {
      [latitudeKey]: latArray,
      [longitudeKey]: lonArray,
    },
  });

  // Use where to mask the dataset (values outside circle become NaN)
  const masked = dataset.where(maskArray);

  // Now we need to find which lat/lon indices have at least one non-NaN value
  // Get the first variable to check for valid data
  const firstVarName = masked.dataVars[0];
  if (!firstVarName) {
    return new Dataset({});
  }

  const firstVar = masked.getVariable(firstVarName) as DataArray;
  const dataArray = firstVar.data;

  // Handle different data shapes (1D or 2D)
  let validLatIndices: number[] = [];
  let validLonIndices: number[] = [];

  if (Array.isArray(dataArray) && dataArray.length > 0) {
    if (Array.isArray(dataArray[0])) {
      // 2D array
      const data2D = dataArray as number[][];

      // Find latitude indices that have at least one valid value
      for (let latIdx = 0; latIdx < data2D.length; latIdx++) {
        for (let lonIdx = 0; lonIdx < data2D[latIdx].length; lonIdx++) {
          if (!isNaN(data2D[latIdx][lonIdx])) {
            validLatIndices.push(latIdx);
            break;
          }
        }
      }

      // Find longitude indices that have at least one valid value
      for (let lonIdx = 0; lonIdx < lonArray.length; lonIdx++) {
        for (let latIdx = 0; latIdx < latArray.length; latIdx++) {
          if (!isNaN(data2D[latIdx][lonIdx])) {
            validLonIndices.push(lonIdx);
            break;
          }
        }
      }
    } else {
      // 1D array - treat as all points valid if any non-NaN
      const data1D = dataArray as number[];
      const hasValidData = data1D.some((v) => !isNaN(v));
      if (hasValidData) {
        validLatIndices = Array.from({ length: latArray.length }, (_, i) => i);
        validLonIndices = Array.from({ length: lonArray.length }, (_, i) => i);
      }
    }
  }

  // If no valid data, return empty dataset
  if (validLatIndices.length === 0 || validLonIndices.length === 0) {
    return new Dataset({});
  }

  // Use isel to select only the valid indices
  let filtered = await masked.isel({
    [latitudeKey]: validLatIndices,
  } as any);

  filtered = await filtered.isel({
    [longitudeKey]: validLonIndices,
  } as any);
  return filtered;
}
