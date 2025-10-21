import { Dataset, DataArray } from "@dclimate/jaxray";
import {
  InvalidSelectionError,
  NoDataFoundError,
} from "./errors.js";
import {
  DatasetMetadata,
  GeoSelectionOptions,
  PointQueryOptions,
  TimeRange,
} from "./types.js";
import { normalizeTimeRange, normalizeSegment } from "./utils.js";

type SelectionMethod = Parameters<Dataset["sel"]>[1] extends infer Options
  ? Options extends { method?: infer Method }
    ? Method
    : never
  : never;

const DEFAULT_LATITUDE_KEYS = ["latitude", "lat", "y"];
const DEFAULT_LONGITUDE_KEYS = ["longitude", "lon", "lng", "x"];

export class GeoTemporalDataset {
  constructor(
    private readonly dataset: Dataset,
    private readonly metadata: DatasetMetadata
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

  toObject(): any {
    return this.dataset.toObject();
  }

  toJSON(): string {
    return this.dataset.toJSON();
  }

  toRecords(varName: string, options?: { precision?: number }) {
    return this.dataset.toRecords(varName, options);
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

    if (options.timeRange) {
      current = await current.timeRange(options.timeRange);
    }

    if (options.point) {
      const { latitude, longitude, options: pointOptions } = options.point;
      current = await current.point(latitude, longitude, pointOptions);
    }

    return current;
  }

  async point(
    latitude: number,
    longitude: number,
    options: PointQueryOptions = {}
  ): Promise<GeoTemporalDataset> {
    const latKey =
      options.latitudeKey ?? this.inferCoordinateKey(DEFAULT_LATITUDE_KEYS);
    const lonKey =
      options.longitudeKey ?? this.inferCoordinateKey(DEFAULT_LONGITUDE_KEYS);

    if (!latKey || !lonKey) {
      throw new InvalidSelectionError(
        "Latitude/longitude coordinates were not found in the dataset."
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
    range: TimeRange,
    dimension = "time"
  ): Promise<GeoTemporalDataset> {
    const coords = this.dataset.coords[dimension];
    if (!coords || !Array.isArray(coords) || coords.length === 0) {
      throw new InvalidSelectionError(
        `Coordinate "${dimension}" not found in dataset.`
      );
    }

    let normalizedRange: { start: unknown; end: unknown };
    try {
      normalizedRange = normalizeTimeRange(range, coords);
    } catch (error) {
      throw new InvalidSelectionError(
        `Unable to normalize time range: ${String(
          (error as Error).message ?? error
        )}`
      );
    }

    const subset = await this.dataset.sel({
      [dimension]: {
        start: normalizedRange.start as any,
        stop: normalizedRange.end as any,
      },
    });
    const wrapped = new GeoTemporalDataset(subset, this.metadata);
    wrapped.ensureHasData();
    return wrapped;
  }

  private inferCoordinateKey(candidates: string[]): string | undefined {
    const coords = this.dataset.coords;
    const normalizedKeys = Object.keys(coords).map((key) =>
      normalizeSegment(key)
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

  private buildSelectionOptions(
    options: PointQueryOptions
  ): { method?: SelectionMethod; tolerance?: number } {
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
}
