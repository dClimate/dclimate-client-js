import { DataArray, Dataset } from "@dclimate/jaxray";
import { describe, expect, it } from "vitest";
import {
  concatenateVariants,
  type VariantToLoad,
} from "../../src/actions/concatenate-variants.js";

function numericVariant(
  name: string,
  priority: number,
  coords: number[],
  valueBase: number,
): VariantToLoad {
  return {
    variant: {
      variant: name,
      cid: `bafy-${name}`,
      concatPriority: priority,
      concatDimension: "time",
    },
    dataset: new Dataset({
      value: new DataArray(
        coords.map((_, index) => valueBase + index),
        { dims: ["time"], coords: { time: coords } },
      ),
    }),
  };
}

describe("concatenateVariants numeric-axis monotonicity", () => {
  it("rejects interior disorder that a binary search would silently skip", async () => {
    const high = numericVariant("high", 0, [0, 1, 2, 3], 1_000);
    // Ascending endpoints (4 < 5) but a dip in the middle: [4, 1, 5]. A binary
    // search over these returns index 2 for a coverage end of 3 and silently
    // drops the valid coordinate 4. Numeric axes are cheap to compare, so the
    // full scan catches the disorder instead.
    const low = numericVariant("low", 1, [4, 1, 5], 2_000);

    await expect(concatenateVariants([high, low])).rejects.toThrow(
      /descending 'time' coordinates/,
    );
  });

  it("concatenates cleanly sorted numeric axes with an overlap", async () => {
    const high = numericVariant("high", 0, [0, 1, 2, 3], 1_000);
    const low = numericVariant("low", 1, [2, 3, 4, 5], 2_000);

    const result = await concatenateVariants([high, low]);

    expect(result.coords.time).toEqual([0, 1, 2, 3, 4, 5]);
    const values = (await result.getVariable("value").compute()).values;
    // High priority retained through its last coord (3); low contributes only
    // the post-overlap tail (coords 4, 5 → its indices 2, 3).
    expect(values).toEqual([1_000, 1_001, 1_002, 1_003, 2_002, 2_003]);
  });
});
