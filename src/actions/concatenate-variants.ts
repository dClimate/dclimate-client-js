/**
 * Smart concatenation of dataset variants
 * Handles automatic merging of finalized/non-finalized data and other variant combinations
 */

import { Dataset } from "@dclimate/jaxray";
import type { ConcatenableStacItem } from "../stac/index.js";

export interface VariantToLoad {
  variant: ConcatenableStacItem;
  dataset: Dataset;
}

/**
 * Concatenate multiple dataset variants intelligently
 * - Sorts variants by concatPriority
 * - For each variant after the first, slices it to start after the last coordinate of the previous
 * - Concatenates along the specified dimension (default: "time")
 *
 * @param variants - Array of loaded variants with their configs
 * @returns Combined dataset with all variants concatenated
 */
export async function concatenateVariants(
  variants: VariantToLoad[]
): Promise<Dataset> {
  if (variants.length === 0) {
    throw new Error("Cannot concatenate empty variants array");
  }

  if (variants.length === 1) {
    return variants[0].dataset;
  }

  // Sort by concatPriority (ascending - lower priority numbers come first)
  const sorted = [...variants].sort((a, b) => {
    const priorityA = a.variant.concatPriority ?? Infinity;
    const priorityB = b.variant.concatPriority ?? Infinity;
    return priorityA - priorityB;
  });

  // Get concatenation dimension from first variant (default to "time")
  const concatDim = sorted[0].variant.concatDimension || "time";

  // Start with the first dataset (highest priority)
  let combined = sorted[0].dataset;
  const comparableCoords = new WeakMap<
    Array<string | number | Date>,
    Float64Array
  >();

  // Concatenate each subsequent variant
  for (let i = 1; i < sorted.length; i++) {
    const nextVariant = sorted[i];
    const nextDataset = nextVariant.dataset;

    // Get the last coordinate value from the combined dataset
    const combinedCoords = combined.coords[concatDim];
    if (!combinedCoords || combinedCoords.length === 0) {
      throw new Error(
        `Combined dataset has no coordinates for dimension '${concatDim}'`
      );
    }

    const lastCombinedCoord = getComparableCoord(
      combinedCoords,
      combinedCoords.length - 1,
      comparableCoords
    );

    // Get coordinates from the next dataset
    const nextCoords = nextDataset.coords[concatDim];
    if (!nextCoords || nextCoords.length === 0) {
      throw new Error(
        `Variant '${nextVariant.variant.variant}' has no coordinates for dimension '${concatDim}'`
      );
    }

    // Find the index in nextDataset where coords start AFTER lastCombinedCoord
    const splitIndex = findSplitIndex(
      nextCoords,
      lastCombinedCoord,
      comparableCoords
    );

    if (splitIndex === -1 || splitIndex >= nextCoords.length) {
      // No new data in this variant, skip it
      console.warn(
        `Variant '${nextVariant.variant.variant}' has no data after the previous variant, skipping concatenation`
      );
      continue;
    }

    // Slice the next dataset to only include data after the split point
    const slicedNext = await nextDataset.isel({
      [concatDim]: Array.from(
        { length: nextCoords.length - splitIndex },
        (_, i) => splitIndex + i
      )
    });

    // Concatenate with the combined dataset
    combined = combined.concat(slicedNext, { dim: concatDim });
  }

  return combined;
}

/**
 * Find the index where coordinates start AFTER the given value
 * Handles numeric, string, and Date coordinates
 *
 * @param coords - Array of coordinate values
 * @param afterComparable - Comparable value to find the split point after
 * @returns Index of first coordinate > afterComparable, or -1 if none found
 */
function findSplitIndex(
  coords: Array<string | number | Date>,
  afterComparable: number,
  comparableCoords: WeakMap<
    Array<string | number | Date>,
    Float64Array
  >
): number {
  let start = 0;
  let end = coords.length;

  while (start < end) {
    const midpoint = start + Math.floor((end - start) / 2);
    if (
      getComparableCoord(coords, midpoint, comparableCoords) > afterComparable
    ) {
      end = midpoint;
    } else {
      start = midpoint + 1;
    }
  }

  return start < coords.length ? start : -1;
}

/**
 * Get a coordinate's comparable value, parsing each visited coordinate at most once.
 */
function getComparableCoord(
  coords: Array<string | number | Date>,
  index: number,
  comparableCoords: WeakMap<
    Array<string | number | Date>,
    Float64Array
  >
): number {
  let cachedCoords = comparableCoords.get(coords);
  if (!cachedCoords) {
    cachedCoords = new Float64Array(coords.length);
    cachedCoords.fill(Number.NaN);
    comparableCoords.set(coords, cachedCoords);
  }

  const cached = cachedCoords[index];
  if (!Number.isNaN(cached)) {
    return cached;
  }

  const comparable = toComparable(coords[index]);
  cachedCoords[index] = comparable;
  return comparable;
}

/**
 * Convert coordinate value to comparable form
 */
function toComparable(value: string | number | Date): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    // Try to parse as date
    const asDate = new Date(value);
    if (!isNaN(asDate.getTime())) {
      return asDate.getTime();
    }
    // Otherwise treat as string (not ideal for comparison, but works for sorted strings)
    return 0;
  }
  return value;
}
