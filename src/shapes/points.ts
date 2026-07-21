import {
  Dataset,
  DataArray,
  type CoordinateValue,
  type DataArrayInput,
  type Selection,
  type SelectionOptions,
} from "@dclimate/jaxray";
import { InvalidSelectionError, NoDataFoundError } from "../errors.js";

function isToleranceMiss(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.message.startsWith("No coordinate within tolerance ")
  );
}

function createCoordinateLookup(
  coordinates: CoordinateValue[] | undefined
): DataArray | undefined {
  if (coordinates === undefined) {
    return undefined;
  }

  if (coordinates.length === 0) {
    throw new Error("Cannot select from an empty coordinate array");
  }

  if (!coordinates.every((coordinate) => typeof coordinate === "number")) {
    throw new Error("Point selection requires numeric spatial coordinates");
  }

  return new DataArray(coordinates as DataArrayInput, {
    dims: ["coordinate"],
    coords: { coordinate: coordinates },
  });
}

async function selectCoordinate(
  lookup: DataArray,
  requested: number,
  options: SelectionOptions
): Promise<CoordinateValue> {
  const selected = await lookup.sel({ coordinate: requested }, options);
  return selected.data as CoordinateValue;
}

/**
 * Selects data at specific point coordinates with optional CRS transformation
 *
 * @param dataset - The jaxray Dataset to filter
 * @param pointLats - Array of latitude coordinates (in the dataset's CRS or specified EPSG)
 * @param pointLons - Array of longitude coordinates (in the dataset's CRS or specified EPSG)
 * @param options - Configuration options
 * @param options.epsgCrs - EPSG code of the input coordinates (default: 4326)
 * @param options.snapToGrid - Whether to snap to the nearest grid point without a distance limit (default: true)
 * @param options.tolerance - Maximum nearest-grid distance allowed when snapToGrid is false (default: 10e-5)
 * @param options.latitudeKey - Name of latitude coordinate (default: "latitude")
 * @param options.longitudeKey - Name of longitude coordinate (default: "longitude")
 * @returns A new Dataset with data at the specified points
 * @throws NoDataFoundError if no data is found and snapToGrid is false
 *
 * @example
 * ```typescript
 * const data = await Dataset.open_zarr(store);
 * const pointLats = [45.5, 46.0];
 * const pointLons = [-73.5, -74.0];
 * const result = await points(data, pointLats, pointLons);
 * ```
 */
export async function points(
  dataset: Dataset,
  pointLats: number[],
  pointLons: number[],
  options: {
    epsgCrs?: number;
    snapToGrid?: boolean;
    tolerance?: number;
    latitudeKey?: string;
    longitudeKey?: string;
  } = {}
): Promise<Dataset> {
  const {
    epsgCrs = 4326,
    snapToGrid = true,
    tolerance = 10e-5,
    latitudeKey = "latitude",
    longitudeKey = "longitude",
  } = options;

  // Validate input arrays
  if (
    !Array.isArray(pointLats) ||
    !Array.isArray(pointLons) ||
    pointLats.length !== pointLons.length
  ) {
    throw new InvalidSelectionError(
      "Point latitudes and longitudes must be arrays of equal length"
    );
  }

  if (pointLats.length === 0) {
    throw new InvalidSelectionError("At least one point coordinate is required");
  }

  for (let index = 0; index < pointLats.length; index++) {
    if (
      !Number.isFinite(pointLats[index]) ||
      !Number.isFinite(pointLons[index])
    ) {
      throw new InvalidSelectionError(
        `Point coordinates must be finite numbers (got latitude ${pointLats[index]}, longitude ${pointLons[index]} at index ${index})`
      );
    }
  }

  // TODO: Add CRS transformation if epsgCrs !== 4326
  // For now, assuming input is already in EPSG:4326 (WGS84)
  if (epsgCrs !== 4326) {
    throw new InvalidSelectionError(
      "CRS transformation not yet implemented. Please provide coordinates in EPSG:4326"
    );
  }

  if (!dataset.coords[latitudeKey] || !dataset.coords[longitudeKey]) {
    throw new InvalidSelectionError(
      `Latitude (${latitudeKey}) and/or longitude (${longitudeKey}) coordinates not found in dataset`
    );
  }

  const selectionOptions: SelectionOptions = snapToGrid
    ? { method: "nearest" }
    : { method: "nearest", tolerance };
  const pointSelections: Dataset[] = [];
  const selectedLats: CoordinateValue[] = [];
  const selectedLons: CoordinateValue[] = [];
  const latitudeLookup = createCoordinateLookup(dataset.coords[latitudeKey]);
  const longitudeLookup = createCoordinateLookup(dataset.coords[longitudeKey]);

  for (let index = 0; index < pointLats.length; index++) {
    const selection: Selection = {
      [latitudeKey]: pointLats[index],
      [longitudeKey]: pointLons[index],
    };

    try {
      pointSelections.push(await dataset.sel(selection, selectionOptions));
    } catch (error) {
      if (!snapToGrid && isToleranceMiss(error)) {
        throw new NoDataFoundError(
          "User requested not to snap_to_grid, but at least one coordinate not in dataset"
        );
      }
      throw error;
    }

    if (latitudeLookup) {
      selectedLats.push(
        await selectCoordinate(
          latitudeLookup,
          pointLats[index],
          selectionOptions
        )
      );
    }
    if (longitudeLookup) {
      selectedLons.push(
        await selectCoordinate(
          longitudeLookup,
          pointLons[index],
          selectionOptions
        )
      );
    }
  }

  const pointCoordinates = pointLats.map((_, index) => index);
  const selectedVariables: Record<string, DataArray> = {};

  for (const name of dataset.dataVars) {
    const original = dataset.getVariable(name);
    const hasSpatialDimension = original.dims.some(
      (dimension) =>
        dimension === latitudeKey || dimension === longitudeKey
    );

    if (!hasSpatialDimension) {
      selectedVariables[name] = original;
      continue;
    }

    const pointVariables = await Promise.all(
      pointSelections.map((selection) => selection.getVariable(name).compute())
    );
    const first = pointVariables[0];
    const remainingCoordinates = Object.fromEntries(
      first.dims.map((dimension) => [dimension, first.coords[dimension]])
    );

    selectedVariables[name] = new DataArray(
      pointVariables.map((variable) => variable.data) as unknown as DataArrayInput,
      {
        dims: ["point", ...first.dims],
        coords: { point: pointCoordinates, ...remainingCoordinates },
        attrs: first.attrs,
        name: first.name,
      }
    );
  }

  const selectedCoordinates = {
    point: pointCoordinates,
    ...(selectedLats.length > 0 ? { [latitudeKey]: selectedLats } : {}),
    ...(selectedLons.length > 0 ? { [longitudeKey]: selectedLons } : {}),
  };
  const selectedData = new Dataset(selectedVariables, {
    coords: selectedCoordinates,
    attrs: dataset.attrs,
    coordAttrs: dataset.coordAttrs,
  });

  // Force computation to speed up aggregations
  const computed = await selectedData.compute();

  return computed;
}
