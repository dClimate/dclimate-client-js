import type {
  DatasetRequest,
  TimeRange,
} from "./types.js";

export function normalizeSegment(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizePath(value: string): string {
  return value.trim().replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
}

function normalizeVariant(variant?: string): string | undefined {
  if (!variant) return undefined;
  return normalizeSegment(String(variant));
}

function addCandidate(acc: string[], seen: Set<string>, candidate?: string) {
  if (!candidate) return;
  const normalized = normalizePath(candidate);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  acc.push(normalized);
}

/**
 * Build potential catalog keys for a dataset request.
 * This mirrors how historical datasets have been registered:
 * - Some use only the dataset slug (e.g., "cpc-precip-conus")
 * - Others follow "collection-dataset" or include a variant suffix such as "finalized".
 */
export function buildCatalogCandidates(
  request: DatasetRequest,
  options: { path?: string } = {}
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const datasetSlug = normalizeSegment(request.dataset);
  const collectionSlug = request.collection
    ? normalizeSegment(request.collection)
    : undefined;
  const variantSlug = normalizeVariant(
    request.variant ?? ""
  );

  // Respect explicit path first
  addCandidate(candidates, seen, options.path);

  // Dataset slug on its own
  addCandidate(candidates, seen, datasetSlug);

  // When dataset already includes collection prefix, avoid double-prefixing
  const datasetHasCollectionPrefix =
    collectionSlug && datasetSlug.startsWith(`${collectionSlug}-`);
  const datasetWithCollection = datasetHasCollectionPrefix
    ? datasetSlug
    : collectionSlug
    ? `${collectionSlug}-${datasetSlug}`
    : undefined;

  addCandidate(candidates, seen, datasetWithCollection);

  if (variantSlug) {
    addCandidate(candidates, seen, `${datasetSlug}-${variantSlug}`);
    addCandidate(
      candidates,
      seen,
      datasetWithCollection ? `${datasetWithCollection}-${variantSlug}` : undefined
    );
  }

  return candidates;
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

  // Default to ISO strings for temporal data
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

  // If both are numeric, ensure correct ordering
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
