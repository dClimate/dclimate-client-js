import { Dataset, DataArray } from "@dclimate/jaxray";
import { InvalidSelectionError, NoDataFoundError } from "../errors.js";

/**
 * Selects data at specific point coordinates with optional CRS transformation
 *
 * @param dataset - The jaxray Dataset to filter
 * @param pointLats - Array of latitude coordinates (in the dataset's CRS or specified EPSG)
 * @param pointLons - Array of longitude coordinates (in the dataset's CRS or specified EPSG)
 * @param options - Configuration options
 * @param options.epsgCrs - EPSG code of the input coordinates (default: 4326)
 * @param options.snapToGrid - Whether to snap to nearest grid points (default: true)
 * @param options.tolerance - Maximum distance for snapping when snapToGrid is true (default: 10e-5)
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

  // TODO: Add CRS transformation if epsgCrs !== 4326
  // For now, assuming input is already in EPSG:4326 (WGS84)
  if (epsgCrs !== 4326) {
    throw new InvalidSelectionError(
      "CRS transformation not yet implemented. Please provide coordinates in EPSG:4326"
    );
  }

  // Create DataArrays for the point coordinates
  const lats = new DataArray(pointLats, { dims: ["point"] });
  const lons = new DataArray(pointLons, { dims: ["point"] });

  // Perform the selection
  let selectedData: Dataset;

  try {
    if (snapToGrid) {
      selectedData = await dataset.sel({
        [latitudeKey]: lats,
        [longitudeKey]: lons,
      } as any);
    } else {
      selectedData = await dataset.sel(
        {
          [latitudeKey]: lats,
          [longitudeKey]: lons,
        } as any,
        {
          method: "nearest",
          tolerance,
        }
      );
    }
  } catch (error) {
    if (!snapToGrid) {
      throw new NoDataFoundError(
        "User requested not to snap_to_grid, but at least one coordinate not in dataset"
      );
    }
    throw error;
  }

  // Force computation to speed up aggregations
  const computed = await selectedData.compute();

  return computed;
}
