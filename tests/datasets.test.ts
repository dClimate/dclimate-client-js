import { describe, expect, it } from "vitest";
import {
  HydrogenEndpoint,
  listDatasetCatalog,
  resolveDatasetSource,
} from "../src/datasets.js";
import { DatasetNotFoundError } from "../src/errors.js";

describe("datasets catalog", () => {
  it("groups datasets under their collections", () => {
    const catalog = listDatasetCatalog();

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collection: "aifs" }),
        expect.objectContaining({ collection: "ifs" }),
        expect.objectContaining({ collection: "era5" }),
      ])
    );

    const era5 = catalog.find((group) => group.collection === "era5");
    const variants = era5?.datasets.find((d) => d.dataset === "2m_temperature")?.variants;
    expect(variants?.map((v) => v.variant)).toEqual([
      "finalized",
      "non-finalized",
    ]);
  });

  it("returns a defensive copy", () => {
    const catalog = listDatasetCatalog();
    catalog[0]?.datasets[0]?.variants.push({ variant: "mutated" });

    const fresh = listDatasetCatalog();
    expect(fresh.some((group) =>
      group.datasets.some((dataset) =>
        dataset.variants.some((variant) => variant.variant === "mutated")
      )
    )).toBe(false);
  });

  it("resolves CID-backed variants without fetch", () => {
    const resolved = resolveDatasetSource({
      collection: "era5",
      dataset: "2m_temperature",
      variant: "finalized",
    });

    expect(resolved.slug).toBe("era5-2m-temperature-finalized");
    expect(resolved.source).toEqual(
      expect.objectContaining({
        type: "cid",
        cid: "bafyr4iacuutc5bgmirkfyzn4igi2wys7e42kkn674hx3c4dv4wrgjp2k2u",
      })
    );
  });

  it("resolves URL-backed variants to Hydrogen endpoints", () => {
    const resolved = resolveDatasetSource({
      collection: "aifs",
      dataset: "precipitation",
      variant: "single",
    });

    expect(resolved.source).toEqual(
      expect.objectContaining({
        type: "url",
        url: `${HydrogenEndpoint}/aifs-single-precip`,
      })
    );
  });

  it("throws when a variant is required", () => {
    expect(() =>
      resolveDatasetSource({ collection: "era5", dataset: "10m_u_wind" })
    ).toThrow('Dataset "10m_u_wind" requires a variant to be specified.');
  });

  it("throws when dataset is unknown", () => {
    expect(() =>
      resolveDatasetSource({
        collection: "aifs",
        dataset: "unknown",
        variant: "single",
      })
    ).toThrow(DatasetNotFoundError);
  });
});
