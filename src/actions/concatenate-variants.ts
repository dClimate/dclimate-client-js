/**
 * Smart concatenation of dataset variants
 * Handles automatic merging of finalized/non-finalized data and other variant combinations
 */

import { Dataset } from "@dclimate/jaxray";
import type { DatasetVariantConfig } from "../datasets.js";

export interface VariantToLoad {
  variant: DatasetVariantConfig;
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

    const lastCombinedCoord = combinedCoords[combinedCoords.length - 1];

    // Get coordinates from the next dataset
    const nextCoords = nextDataset.coords[concatDim];
    if (!nextCoords || nextCoords.length === 0) {
      throw new Error(
        `Variant '${nextVariant.variant.variant}' has no coordinates for dimension '${concatDim}'`
      );
    }

    // Find the index in nextDataset where coords start AFTER lastCombinedCoord
    const splitIndex = findSplitIndex(nextCoords, lastCombinedCoord);

    if (splitIndex === -1 || splitIndex >= nextCoords.length) {
      // No new data in this variant, skip it
      console.warn(
        `Variant '${nextVariant.variant.variant}' has no data after the previous variant, skipping concatenation`
      );
      continue;
    }

    // Slice the next dataset to only include data after the split point
    const slicedNext = await nextDataset.isel({
      [concatDim]: Array.from({ length: nextCoords.length - splitIndex }, (_, i) => splitIndex + i)
    });

    // Concatenate with the combined dataset
    combined = combined.concat(slicedNext, { dim: concatDim });
  }

  return combined;
}

/**
 * Find the index where coordinates start AFTER the given value
 * Handles both numeric and Date coordinates
 *
 * @param coords - Array of coordinate values
 * @param afterValue - Value to find the split point after
 * @returns Index of first coordinate > afterValue, or -1 if none found
 */
function findSplitIndex(
  coords: Array<string | number | Date>,
  afterValue: string | number | Date
): number {
  // Convert to comparable values
  const afterComparable = toComparable(afterValue);

  for (let i = 0; i < coords.length; i++) {
    const coordComparable = toComparable(coords[i]);
    if (coordComparable > afterComparable) {
      return i;
    }
  }

  return -1; // No coordinate found after afterValue
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
