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

    // Find the first index in nextDataset whose coordinate is AFTER
    // lastCombinedCoord. The scan validates ascending order across every
    // adjacent pair — endpoint-only probes cannot see interior disorder
    // (e.g. [4, 1, 5]) and would let a binary search silently drop valid
    // coordinates.
    const splitIndex = findSplitIndex(
      nextCoords,
      lastCombinedCoord,
      comparableCoords,
      nextVariant.variant.variant,
      concatDim
    );

    if (splitIndex === -1) {
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
 * Find the index where coordinates start AFTER the given value. Handles
 * numeric, string, and Date coordinates.
 *
 * Comparing a coordinate can be costly — decoded time axes may be long ISO-8601
 * strings whose parse dominates runtime. The strategy therefore depends on how
 * expensive comparison is:
 *
 *   - Numeric / Date axes are O(1) to compare, so scan every coordinate and
 *     validate ascending order as we go. This rejects the interior disorder
 *     (e.g. [4, 1, 5]) that a binary search silently skips past, dropping data.
 *   - String axes route to a binary search that touches only O(log n)
 *     coordinates, trusting the monotonicity that decoded zarr axes guarantee.
 *     Cheap endpoint probes still catch a fully descending axis.
 *
 * @returns Index of first coordinate > afterComparable, or -1 if none found
 * @throws If the axis is detected to be non-ascending
 */
function findSplitIndex(
  coords: Array<string | number | Date>,
  afterComparable: number,
  comparableCoords: WeakMap<
    Array<string | number | Date>,
    Float64Array
  >,
  variantName: string,
  concatDim: string
): number {
  return typeof coords[0] === "string"
    ? findSplitIndexBinary(
        coords,
        afterComparable,
        comparableCoords,
        variantName,
        concatDim
      )
    : findSplitIndexScanning(
        coords,
        afterComparable,
        comparableCoords,
        variantName,
        concatDim
      );
}

/**
 * Full linear scan for cheap-to-compare axes: validates ascending order across
 * every adjacent pair and returns the first index whose coordinate exceeds
 * afterComparable.
 */
function findSplitIndexScanning(
  coords: Array<string | number | Date>,
  afterComparable: number,
  comparableCoords: WeakMap<Array<string | number | Date>, Float64Array>,
  variantName: string,
  concatDim: string
): number {
  let splitIndex = -1;
  let previous = getComparableCoord(coords, 0, comparableCoords);
  if (previous > afterComparable) {
    splitIndex = 0;
  }

  for (let index = 1; index < coords.length; index++) {
    const current = getComparableCoord(coords, index, comparableCoords);
    if (current < previous) {
      throw new Error(
        `Variant '${variantName}' has descending '${concatDim}' coordinates; concatenation requires ascending order`
      );
    }
    if (splitIndex === -1 && current > afterComparable) {
      splitIndex = index;
    }
    previous = current;
  }

  return splitIndex;
}

/**
 * Binary search for axes where comparison is expensive: touches only O(log n)
 * coordinates. Assumes interior monotonicity (true for decoded zarr axes);
 * endpoint probes reject a fully descending axis, and a post-search check
 * catches the case where the search saw only in-range coords yet the tail
 * exceeds the coverage end.
 */
function findSplitIndexBinary(
  coords: Array<string | number | Date>,
  afterComparable: number,
  comparableCoords: WeakMap<Array<string | number | Date>, Float64Array>,
  variantName: string,
  concatDim: string
): number {
  const firstCoord = getComparableCoord(coords, 0, comparableCoords);
  const lastCoord = getComparableCoord(
    coords,
    coords.length - 1,
    comparableCoords
  );
  if (firstCoord > lastCoord) {
    throw new Error(
      `Variant '${variantName}' has descending '${concatDim}' coordinates; concatenation requires ascending order`
    );
  }

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
  const splitIndex = start < coords.length ? start : -1;

  if (splitIndex === -1 && lastCoord > afterComparable) {
    // The search saw only coords <= the coverage end yet the final coord is
    // beyond it — the axis is not sorted ascending.
    throw new Error(
      `Variant '${variantName}' has unsorted '${concatDim}' coordinates; concatenation requires ascending order`
    );
  }

  return splitIndex;
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
