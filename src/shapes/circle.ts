import {
  Dataset,
  DataArray,
  flatten,
  type DataValue,
} from "@dclimate/jaxray";
import { haversine } from "../math/haversine.js";
import { InvalidSelectionError } from "../errors.js";

const KILOMETERS_PER_DEGREE = 111.32;
const MIN_LONGITUDE_COSINE = 1e-6;

function contiguousIndices(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

function enclosingRange(indices: number[]): number[] {
  if (indices.length === 0) return [];
  return contiguousIndices(indices[0], indices[indices.length - 1]);
}

function transposeTo(variable: DataArray, targetDims: string[]): DataArray {
  const sourceDims = variable.dims;
  if (sourceDims.every((dimension, index) => dimension === targetDims[index])) {
    return variable;
  }

  const targetShape = targetDims.map(
    (dimension) => variable.shape[sourceDims.indexOf(dimension)]
  );
  const sourceStrides = new Array(sourceDims.length);
  let stride = 1;
  for (let index = sourceDims.length - 1; index >= 0; index--) {
    sourceStrides[index] = stride;
    stride *= variable.shape[index];
  }

  const sourceData = flatten(variable.data);
  const transposedData: DataValue[] = new Array(sourceData.length);
  for (let targetOffset = 0; targetOffset < transposedData.length; targetOffset++) {
    let remainder = targetOffset;
    let sourceOffset = 0;
    for (let targetIndex = targetDims.length - 1; targetIndex >= 0; targetIndex--) {
      const targetCoordinate = remainder % targetShape[targetIndex];
      remainder = Math.floor(remainder / targetShape[targetIndex]);
      const sourceIndex = sourceDims.indexOf(targetDims[targetIndex]);
      sourceOffset += targetCoordinate * sourceStrides[sourceIndex];
    }
    transposedData[targetOffset] = sourceData[sourceOffset];
  }

  return new DataArray(
    { data: transposedData, shape: targetShape },
    {
      dims: targetDims,
      coords: Object.fromEntries(
        targetDims.map((dimension) => [dimension, variable.coords[dimension]])
      ),
      attrs: variable.attrs,
      name: variable.name,
    }
  );
}

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

  if (radiusKm <= 0) {
    throw new InvalidSelectionError("Radius must be a positive number");
  }

  const latCoords = dataset.coords[latitudeKey];
  const lonCoords = dataset.coords[longitudeKey];

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

  const latArray = latCoords.map((value) => {
    const coordinate = typeof value === "number" ? value : Number(value);
    if (isNaN(coordinate)) {
      throw new InvalidSelectionError(`Invalid latitude coordinate: ${value}`);
    }
    return coordinate;
  });

  const lonArray = lonCoords.map((value) => {
    const coordinate = typeof value === "number" ? value : Number(value);
    if (isNaN(coordinate)) {
      throw new InvalidSelectionError(`Invalid longitude coordinate: ${value}`);
    }
    return coordinate;
  });

  const latitudeDelta = radiusKm / KILOMETERS_PER_DEGREE;
  const latitudeMin = centerLat - latitudeDelta;
  const latitudeMax = centerLat + latitudeDelta;
  const bboxLatitudeIndices = latArray
    .map((latitude, index) => ({ latitude, index }))
    .filter(({ latitude }) => latitude >= latitudeMin && latitude <= latitudeMax)
    .map(({ index }) => index);

  const centerLatitudeRadians = (centerLat * Math.PI) / 180;
  const longitudeCosine = Math.max(
    Math.abs(Math.cos(centerLatitudeRadians)),
    MIN_LONGITUDE_COSINE
  );
  const longitudeDelta =
    radiusKm / (KILOMETERS_PER_DEGREE * longitudeCosine);
  const longitudeMin = centerLon - longitudeDelta;
  const longitudeMax = centerLon + longitudeDelta;
  const useFullLongitudeRange =
    longitudeDelta >= 180 || longitudeMin < -180 || longitudeMax > 180;
  const bboxLongitudeIndices = useFullLongitudeRange
    ? contiguousIndices(0, lonArray.length - 1)
    : lonArray
        .map((longitude, index) => ({ longitude, index }))
        .filter(
          ({ longitude }) =>
            longitude >= longitudeMin && longitude <= longitudeMax
        )
        .map(({ index }) => index);

  if (bboxLatitudeIndices.length === 0 || bboxLongitudeIndices.length === 0) {
    return new Dataset({});
  }

  const bboxLatitudeRange = enclosingRange(bboxLatitudeIndices);
  const bboxLongitudeRange = enclosingRange(bboxLongitudeIndices);
  const bboxDataset = await dataset.isel({
    [latitudeKey]: bboxLatitudeRange,
    [longitudeKey]: bboxLongitudeRange,
  });
  const bboxLatitudes = bboxLatitudeRange.map((index) => latArray[index]);
  const bboxLongitudes = bboxLongitudeRange.map((index) => lonArray[index]);

  const bboxMask = bboxLatitudes.map((latitude) =>
    bboxLongitudes.map(
      (longitude) =>
        (haversine(
          centerLat,
          centerLon,
          latitude,
          longitude
        ) as number) <= radiusKm
    )
  );
  const maskLatitudeIndices = bboxMask
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.some(Boolean))
    .map(({ index }) => index);
  const maskLongitudeIndices = bboxLongitudes
    .map((_, index) => index)
    .filter((longitudeIndex) =>
      bboxMask.some((row) => row[longitudeIndex])
    );

  if (maskLatitudeIndices.length === 0 || maskLongitudeIndices.length === 0) {
    return new Dataset({});
  }

  const trimmedDataset = await bboxDataset.isel({
    [latitudeKey]: maskLatitudeIndices,
    [longitudeKey]: maskLongitudeIndices,
  });
  const trimmedMask = maskLatitudeIndices.map((latitudeIndex) =>
    maskLongitudeIndices.map(
      (longitudeIndex) => bboxMask[latitudeIndex][longitudeIndex]
    )
  );
  const maskArray = new DataArray(trimmedMask, {
    dims: [latitudeKey, longitudeKey],
    coords: {
      [latitudeKey]: trimmedDataset.coords[latitudeKey],
      [longitudeKey]: trimmedDataset.coords[longitudeKey],
    },
  });

  // jaxray cannot apply where to lazy operands, so materialize only after both
  // spatial selections have reduced the dataset to the mask-derived trim.
  const materialized = await trimmedDataset.compute();
  const conditionVariables: Record<string, DataArray> = {};
  for (const name of materialized.dataVars) {
    const variable = materialized.getVariable(name);
    conditionVariables[name] =
      variable.dims.includes(latitudeKey) &&
      variable.dims.includes(longitudeKey)
        ? maskArray
        : new DataArray(true);
  }
  const masked = materialized.where(new Dataset(conditionVariables));

  // where puts condition dimensions first. Restore the input order for every
  // variable (for example, time/latitude/longitude).
  const resultVariables: Record<string, DataArray> = {};
  for (const name of masked.dataVars) {
    const variable = masked.getVariable(name);
    resultVariables[name] = transposeTo(
      variable,
      materialized.getVariable(name).dims
    );
  }

  return new Dataset(resultVariables, {
    attrs: masked.attrs,
    coordAttrs: masked.coordAttrs,
  });
}
