import {
  cfTimeToDate,
  Dataset,
  DataArray,
  parseCFTimeUnits,
  type CoordinateValue,
  type Selection,
} from "@dclimate/jaxray";
import { InvalidSelectionError, NoDataFoundError } from "./errors.js";
import {
  BoundsSelection,
  BoundsSelectionOptions,
  DatasetMetadata,
  DatasetObject,
  GeoSelectionOptions,
  PointQueryOptions,
} from "./types.js";
import { normalizeTimeRange, normalizeSegment } from "./utils.js";
import {
  points as pointsShape,
  circle as circleShape,
  rectangle as rectangleShape,
} from "./shapes/index.js";

type SelectionMethod = Parameters<Dataset["sel"]>[1] extends infer Options
  ? Options extends { method?: infer Method }
    ? Method
    : never
  : never;

const DEFAULT_LATITUDE_KEYS = ["latitude", "lat", "y"];
const DEFAULT_LONGITUDE_KEYS = ["longitude", "lon", "lng", "x"];
const DEFAULT_TIME_KEYS = [
  "time",
  "valid_time",
  "datetime",
  "date",
  "forecast_reference_time",
  "forecast_time",
  "analysis_time",
  "initial_time",
  "verification_time",
  "step",
  "t",
];

type TimeRangeInput = {
  start: CoordinateValue;
  end: CoordinateValue;
};

function toTimelineValue(value: CoordinateValue): number {
  let normalizedValue = value;
  if (typeof value === "string") {
    const trimmedValue = value.trim();
    const hasTime =
      /[tT]/.test(trimmedValue) || /\s\d{1,2}:\d{2}/.test(trimmedValue);
    const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmedValue);
    normalizedValue =
      hasTime && !hasTimezone ? `${trimmedValue}Z` : trimmedValue;
  }

  const parsed =
    typeof normalizedValue === "number"
      ? normalizedValue
      : normalizedValue instanceof Date
      ? normalizedValue.getTime()
      : Date.parse(normalizedValue);

  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Unable to parse time value "${String(value)}"`);
  }

  return parsed;
}

function cfTimeToTimelineValue(
  value: number,
  units: string,
  calendar?: string,
): number {
  const date = cfTimeToDate(value, units, calendar);
  if (!date) {
    throw new TypeError(
      `Unable to convert CF time value "${String(
        value,
      )}" using units "${units}"`,
    );
  }
  return date.getTime();
}

export class GeoTemporalDataset {
  constructor(
    private readonly dataset: Dataset,
    private readonly metadata: DatasetMetadata,
  ) {}

  get info(): DatasetMetadata {
    return { ...this.metadata };
  }

  get data(): Dataset {
    return this.dataset;
  }

  get variables(): string[] {
    return this.dataset.dataVars;
  }

  get coords(): Record<string, unknown[]> {
    return this.dataset.coords;
  }

  toObject(): DatasetObject {
    return this.dataset.toObject() as DatasetObject;
  }

  toJSON(): string {
    return this.dataset.toJSON();
  }

  async toRecords(
    varName: string,
    options?: { precision?: number },
  ): Promise<Array<Record<string, unknown>>> {
    const dataArray = this.dataset.getVariable(varName);
    if (!dataArray) {
      throw new Error(`Variable "${varName}" not found in dataset.`);
    }
    const computedArray = await dataArray.compute();
    const result = computedArray.toRecords(options);
    return result;
  }

  getVariable(name: string): DataArray {
    return this.dataset.getVariable(name);
  }

  isEmpty(): boolean {
    const sizes = this.dataset.sizes;
    return Object.values(sizes).some((size) => size === 0);
  }

  ensureHasData() {
    if (this.isEmpty()) {
      throw new NoDataFoundError("Dataset selection contains no data points.");
    }
  }

  async select(options: GeoSelectionOptions): Promise<GeoTemporalDataset> {
    let current: GeoTemporalDataset = this;

    if (options.point && options.bounds) {
      throw new InvalidSelectionError(
        "Use either point or bounds selection, not both.",
      );
    }

    // Apply selections in order: point first, then time range
    // Point selection must come first because it changes the dataset structure
    if (options.point) {
      const { latitude, longitude, options: pointOptions } = options.point;
      current = await current.point(latitude, longitude, pointOptions);
    }

    // Then apply time range using the potentially-modified dataset
    if (options.timeRange) {
      try {
        current = await current.timeRange(options.timeRange);
      } catch (error) {
        // If time range selection fails after point selection,
        // return the point selection result (dataset may not have time dimension)
        if (options.point && error instanceof InvalidSelectionError) {
          return current;
        }
        throw error;
      }
    }

    if (options.bounds) {
      const { west, south, east, north, boundsOptions } =
        normalizeBoundsSelection(options.bounds, options.boundsOptions);
      const subset = await current.rectangle(
        south,
        west,
        north,
        east,
        boundsOptions,
      );
      current = current.wrapDataset(subset);
    }

    return current;
  }

  async point(
    latitude: number,
    longitude: number,
    options: PointQueryOptions = {},
  ): Promise<GeoTemporalDataset> {
    const latKey =
      options.latitudeKey ?? this.inferCoordinateKey(DEFAULT_LATITUDE_KEYS);
    const lonKey =
      options.longitudeKey ?? this.inferCoordinateKey(DEFAULT_LONGITUDE_KEYS);

    if (!latKey || !lonKey) {
      throw new InvalidSelectionError(
        "Latitude/longitude coordinates were not found in the dataset.",
      );
    }

    const selectionOptions = this.buildSelectionOptions(options);
    const selection: Record<string, number> = {
      [latKey]: latitude,
      [lonKey]: longitude,
    };

    const subset = await this.dataset.sel(selection, selectionOptions);
    const wrapped = new GeoTemporalDataset(subset, this.metadata);
    wrapped.ensureHasData();
    return wrapped;
  }

  async timeRange(
    range: TimeRangeInput,
    dimension = "time",
  ): Promise<GeoTemporalDataset> {
    const candidateKeys =
      dimension === "time"
        ? Array.from(new Set(DEFAULT_TIME_KEYS))
        : [dimension];
    const timeKey = this.inferCoordinateKey(candidateKeys);

    if (!timeKey) {
      throw new InvalidSelectionError(
        `Coordinate "${dimension}" not found in dataset.`,
      );
    }

    const coords = this.dataset.coords[timeKey];
    if (!Array.isArray(coords) || coords.length === 0) {
      throw new InvalidSelectionError(
        `Coordinate "${timeKey}" not found in dataset.`,
      );
    }

    let startTime: number;
    let endTime: number;
    let matchingIndices: number[];
    try {
      let coordinateToTimelineValue: (coordinate: CoordinateValue) => number;
      if (typeof coords[0] === "number") {
        const timeAttrs = this.dataset.coordAttrs?.[timeKey];
        const units =
          typeof timeAttrs?.units === "string" ? timeAttrs.units : undefined;
        const calendar =
          typeof timeAttrs?.calendar === "string"
            ? timeAttrs.calendar
            : undefined;

        if (units) {
          if (!parseCFTimeUnits(units)) {
            throw new TypeError(`Invalid CF time units "${units}"`);
          }
          const endpointToTimelineValue = (value: CoordinateValue): number =>
            typeof value === "number"
              ? cfTimeToTimelineValue(value, units, calendar)
              : toTimelineValue(value);
          startTime = endpointToTimelineValue(range.start);
          endTime = endpointToTimelineValue(range.end);
          coordinateToTimelineValue = (coordinate) => {
            if (typeof coordinate !== "number") {
              throw new TypeError(
                "Numeric time axis contains a non-numeric value",
              );
            }
            return cfTimeToTimelineValue(coordinate, units, calendar);
          };
        } else {
          if (
            typeof range.start !== "number" ||
            typeof range.end !== "number"
          ) {
            throw new TypeError(
              "Numeric time coordinates without CF units require numeric range endpoints",
            );
          }
          startTime = toTimelineValue(range.start);
          endTime = toTimelineValue(range.end);
          coordinateToTimelineValue = (coordinate) => {
            if (typeof coordinate !== "number") {
              throw new TypeError(
                "Numeric time axis contains a non-numeric value",
              );
            }
            return toTimelineValue(coordinate);
          };
        }
      } else {
        if (typeof range.start === "number" || typeof range.end === "number") {
          throw new TypeError(
            "Non-numeric time coordinates require date-like range endpoints",
          );
        }
        const normalizedRange = normalizeTimeRange(
          { start: range.start, end: range.end },
          coords,
        );
        startTime = toTimelineValue(normalizedRange.start);
        endTime = toTimelineValue(normalizedRange.end);
        coordinateToTimelineValue = toTimelineValue;
      }

      const lowerBound = Math.min(startTime, endTime);
      const upperBound = Math.max(startTime, endTime);
      matchingIndices = coords.reduce<number[]>(
        (indices, coordinate, index) => {
          const coordinateTime = coordinateToTimelineValue(coordinate);
          if (coordinateTime >= lowerBound && coordinateTime <= upperBound) {
            indices.push(index);
          }
          return indices;
        },
        [],
      );
    } catch (error) {
      throw new InvalidSelectionError(
        `Unable to compare time range on "${timeKey}": ${String(
          (error as Error).message ?? error,
        )}`,
      );
    }

    if (matchingIndices.length === 0) {
      throw new NoDataFoundError(
        `No data found in the requested time range on "${timeKey}".`,
      );
    }

    let subset: Dataset;
    try {
      if (typeof this.dataset.isel === "function") {
        subset = await this.dataset.isel({ [timeKey]: matchingIndices });
      } else {
        // Preserve compatibility with lightweight Dataset fakes that only
        // implement sel, while still passing exact coordinate endpoints.
        const selection: Selection = {
          [timeKey]: {
            start: coords[matchingIndices[0]],
            stop: coords[matchingIndices[matchingIndices.length - 1]],
          },
        };
        subset = await this.dataset.sel(selection);
      }
    } catch (error) {
      throw new InvalidSelectionError(
        `Failed to apply time range on "${timeKey}": ${String(
          (error as Error).message ?? error,
        )}`,
      );
    }

    const wrapped = new GeoTemporalDataset(subset, this.metadata);
    wrapped.ensureHasData();
    return wrapped;
  }

  private inferCoordinateKey(candidates: string[]): string | undefined {
    const coords = this.dataset.coords;
    const normalizedKeys = Object.keys(coords).map((key) =>
      normalizeSegment(key),
    );

    for (const candidate of candidates) {
      const normalizedCandidate = normalizeSegment(candidate);
      const index = normalizedKeys.indexOf(normalizedCandidate);
      if (index !== -1) {
        return Object.keys(coords)[index];
      }
    }

    return undefined;
  }

  private buildSelectionOptions(options: PointQueryOptions): {
    method?: SelectionMethod;
    tolerance?: number;
  } {
    const method =
      options.method === "exact" ? undefined : ("nearest" as SelectionMethod);
    const selectionOptions: { method?: SelectionMethod; tolerance?: number } =
      {};

    if (method) {
      selectionOptions.method = method;
    }
    if (typeof options.tolerance === "number") {
      selectionOptions.tolerance = options.tolerance;
    }
    return selectionOptions;
  }

  private wrapDataset(dataset: Dataset): GeoTemporalDataset {
    const wrapped = new GeoTemporalDataset(dataset, this.metadata);
    wrapped.ensureHasData();
    return wrapped;
  }

  /**
   * Select data at specific point coordinates
   *
   * @param pointLats - Array of latitude coordinates
   * @param pointLons - Array of longitude coordinates
   * @param options - Configuration options (epsgCrs, snapToGrid, tolerance, latitudeKey, longitudeKey)
   * @returns A new Dataset with data at the specified points
   */
  async points(
    pointLats: number[],
    pointLons: number[],
    options?: {
      epsgCrs?: number;
      snapToGrid?: boolean;
      tolerance?: number;
      latitudeKey?: string;
      longitudeKey?: string;
    },
  ): Promise<Dataset> {
    return await pointsShape(this.dataset, pointLats, pointLons, options);
  }

  /**
   * Select data within a circular region
   *
   * @param centerLat - Latitude of circle center
   * @param centerLon - Longitude of circle center
   * @param radiusKm - Radius in kilometers
   * @param options - Configuration options (latitudeKey, longitudeKey)
   * @returns A new Dataset with data within the circular region
   */
  async circle(
    centerLat: number,
    centerLon: number,
    radiusKm: number,
    options?: {
      latitudeKey?: string;
      longitudeKey?: string;
    },
  ): Promise<Dataset> {
    return await circleShape(
      this.dataset,
      centerLat,
      centerLon,
      radiusKm,
      options,
    );
  }

  /**
   * Select data within a rectangular region
   *
   * @param minLat - Southern latitude boundary
   * @param minLon - Western longitude boundary
   * @param maxLat - Northern latitude boundary
   * @param maxLon - Eastern longitude boundary
   * @param options - Configuration options (latitudeKey, longitudeKey)
   * @returns A new Dataset with data within the rectangular region
   */
  async rectangle(
    minLat: number,
    minLon: number,
    maxLat: number,
    maxLon: number,
    options?: {
      latitudeKey?: string;
      longitudeKey?: string;
    },
  ): Promise<Dataset> {
    return await rectangleShape(
      this.dataset,
      minLat,
      minLon,
      maxLat,
      maxLon,
      options,
    );
  }
}

function normalizeBoundsSelection(
  bounds: BoundsSelection,
  fallbackOptions?: BoundsSelectionOptions,
): {
  west: number;
  south: number;
  east: number;
  north: number;
  boundsOptions?: BoundsSelectionOptions;
} {
  const isTuple = isBoundsSelectionTuple(bounds);
  const normalized = isTuple
    ? {
        west: bounds[0],
        south: bounds[1],
        east: bounds[2],
        north: bounds[3],
        boundsOptions: fallbackOptions,
      }
    : {
        west: bounds.west,
        south: bounds.south,
        east: bounds.east,
        north: bounds.north,
        boundsOptions: bounds.options ?? fallbackOptions,
      };

  if (
    [normalized.west, normalized.south, normalized.east, normalized.north].some(
      (value) => typeof value !== "number" || !Number.isFinite(value),
    )
  ) {
    throw new InvalidSelectionError(
      "Bounds selection must use finite west, south, east, and north numbers.",
    );
  }

  if (normalized.west >= normalized.east) {
    throw new InvalidSelectionError(
      `west (${normalized.west}) must be less than east (${normalized.east}).`,
    );
  }

  if (normalized.south >= normalized.north) {
    throw new InvalidSelectionError(
      `south (${normalized.south}) must be less than north (${normalized.north}).`,
    );
  }

  return normalized;
}

function isBoundsSelectionTuple(
  bounds: BoundsSelection,
): bounds is readonly [
  west: number,
  south: number,
  east: number,
  north: number,
] {
  return Array.isArray(bounds);
}
