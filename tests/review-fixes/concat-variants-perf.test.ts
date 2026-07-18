import { DataArray, Dataset } from "@dclimate/jaxray";
import { describe, expect, it } from "vitest";
import {
  concatenateVariants,
  type VariantToLoad,
} from "../../src/actions/concatenate-variants.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const START_TIME = Date.parse("2024-01-01T00:00:00.000Z");

function createVariant(
  name: string,
  priority: number,
  startTime: number,
  stepMs: number,
  length: number,
  valueBase: number,
  fractionalSecondDigits = 3,
): VariantToLoad {
  const fractionalSeconds = "0".repeat(fractionalSecondDigits);
  const time = Array.from({ length }, (_, index) => {
    const isoTime = new Date(startTime + index * stepMs).toISOString();
    return isoTime.replace(".000Z", `.${fractionalSeconds}Z`);
  });
  const values = Array.from(
    { length },
    (_, index) => valueBase + index,
  );

  return {
    variant: {
      variant: name,
      cid: `bafy-${name}`,
      concatPriority: priority,
      concatDimension: "time",
    },
    dataset: new Dataset({
      value: new DataArray(values, {
        dims: ["time"],
        coords: { time },
      }),
    }),
  };
}

describe("concatenateVariants overlap splitting", () => {
  it("preserves the higher-priority overlap and appends only the lower-priority remainder", async () => {
    const highPriority = createVariant(
      "priority-0",
      0,
      START_TIME,
      DAY_MS,
      13,
      1_000,
    );
    const lowPriority = createVariant(
      "priority-1",
      1,
      START_TIME + 8 * DAY_MS,
      DAY_MS,
      13,
      2_000,
    );

    const result = await concatenateVariants([lowPriority, highPriority]);
    const resultValues = (await result.getVariable("value").compute()).values;

    expect(result.coords.time).toEqual(
      Array.from({ length: 21 }, (_, index) =>
        new Date(START_TIME + index * DAY_MS).toISOString(),
      ),
    );
    expect(result.coords.time).toHaveLength(21);
    expect(resultValues).toHaveLength(21);
    expect(resultValues[8]).toBe(1_008);
    expect(resultValues[12]).toBe(1_012);
    expect(resultValues[13]).toBe(2_005);
    expect(resultValues[20]).toBe(2_012);
  });

  it("splits 30,000-step variants with 50% overlap in under 250ms", async () => {
    await concatenateVariants([
      createVariant("warm-high", 0, START_TIME, HOUR_MS, 4, 10),
      createVariant("warm-low", 1, START_TIME + 2 * HOUR_MS, HOUR_MS, 4, 20),
    ]);

    const stepCount = 30_000;
    const overlapStart = stepCount / 2;
    const highPriority = createVariant(
      "large-priority-0",
      0,
      START_TIME,
      HOUR_MS,
      stepCount,
      1_000_000,
      32_000,
    );
    const lowPriority = createVariant(
      "large-priority-1",
      1,
      START_TIME + overlapStart * HOUR_MS,
      HOUR_MS,
      stepCount,
      2_000_000,
      32_000,
    );

    const startedAt = performance.now();
    const result = await concatenateVariants([highPriority, lowPriority]);
    const durationMs = performance.now() - startedAt;

    expect(
      durationMs,
      `concatenateVariants took ${durationMs.toFixed(1)}ms for two 30,000-step variants`,
    ).toBeLessThan(250);

    // Output shape must be right too — a fast-but-wrong split (e.g. one that
    // skips the low-priority variant entirely) must not pass on speed alone.
    const resultValues = (await result.getVariable("value").compute()).values;
    expect(resultValues).toHaveLength(stepCount + overlapStart);
    expect(resultValues[stepCount - 1]).toBe(1_000_000 + stepCount - 1);
    expect(resultValues[stepCount]).toBe(2_000_000 + overlapStart);
  }, 30_000);

  it("throws on descending time coordinates instead of dropping data", async () => {
    const highPriority = createVariant("asc", 0, START_TIME, DAY_MS, 3, 1_000);
    const descendingTime = [4, 3, 2].map((day) =>
      new Date(START_TIME + day * DAY_MS).toISOString(),
    );
    const lowPriority: VariantToLoad = {
      variant: {
        variant: "desc",
        cid: "bafy-desc",
        concatPriority: 1,
        concatDimension: "time",
      },
      dataset: new Dataset({
        value: new DataArray([2_000, 2_001, 2_002], {
          dims: ["time"],
          coords: { time: descendingTime },
        }),
      }),
    };

    await expect(
      concatenateVariants([highPriority, lowPriority]),
    ).rejects.toThrow(/descending 'time' coordinates/);
  });
});
