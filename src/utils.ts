import type { TimeRange } from "./types.js";
import { Dataset } from "@dclimate/jaxray";

export function normalizeSegment(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Check if a Dataset is empty (no data variables or all dimensions have size 0)
 * @param dataset - The Dataset to check
 * @returns true if the dataset has no data or any dimension has size 0
 */
export function isDatasetEmpty(dataset: Dataset): boolean {
  // No data variables
  if (dataset.dataVars.length === 0) {
    return true;
  }

  // Check if any dimension has size 0
  const sizes = dataset.sizes;
  return Object.values(sizes).some((size) => size === 0);
}

function toDate(value: Date | string): Date | null {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function coerceBySample(
  input: Date | string,
  sample: unknown
): string | number | Date {
  if (typeof sample === "number") {
    if (input instanceof Date) return input.valueOf();
    const numeric = Number(input);
    if (!Number.isNaN(numeric)) return numeric;
    const parsed = toDate(input);
    if (parsed) return parsed.valueOf();
    throw new TypeError(
      `Unable to coerce value "${input}" to a numeric coordinate`
    );
  }

  if (sample instanceof Date) {
    const parsed = toDate(input);
    if (parsed) return parsed;
    throw new TypeError(
      `Unable to coerce value "${input}" to a Date coordinate`
    );
  }

  if (input instanceof Date) {
    return input.toISOString();
  }
  return String(input);
}

export function normalizeTimeRange(
  range: TimeRange,
  coordValues?: unknown[]
): { start: string | number | Date; end: string | number | Date } {
  const sample = coordValues && coordValues.length > 0 ? coordValues[0] : undefined;
  const startValue = coerceBySample(range.start, sample);
  const endValue = coerceBySample(range.end, sample);

  if (typeof startValue === "number" && typeof endValue === "number") {
    if (startValue > endValue) {
      return { start: endValue, end: startValue };
    }
    return { start: startValue, end: endValue };
  }

  const startDate = toDate(startValue as any);
  const endDate = toDate(endValue as any);
  if (startDate && endDate && startDate > endDate) {
    return {
      start: endDate.toISOString(),
      end: startDate.toISOString(),
    };
  }

  return { start: startValue, end: endValue };
}
