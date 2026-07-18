import { describe, expect, it } from "vitest";
import {
  getConcatenableItemsFromStac,
  type ConcatenableStacItem,
  type StacCatalog,
} from "../../src/stac/stac-catalog.js";

const organization = "ecmwf";
const collection = "ecmwf_era5";
const dataset = "temperature_2m";

function createCatalog(): StacCatalog {
  return {
    type: "Catalog",
    stac_version: "1.0.0",
    id: "root",
    links: [
      {
        rel: "child",
        href: "ipfs://bafy-ecmwf-catalog",
        "dclimate:id": organization,
      },
    ],
    collections: [
      {
        type: "Collection",
        stac_version: "1.0.0",
        id: collection,
        description: "Two concatenable ERA5 variants",
        organizationId: organization,
        links: [],
        items: [
          {
            type: "Feature",
            stac_version: "1.0.0",
            id: `${collection}-${dataset}-part1`,
            properties: {
              "dclimate:concatPriority": 0,
              "dclimate:concatDimension": "time",
            },
            geometry: null,
            links: [],
            assets: {
              data: { href: "ipfs://bafy-era5-part1-data" },
            },
          },
          {
            type: "Feature",
            stac_version: "1.0.0",
            id: `${collection}-${dataset}-part2`,
            properties: {
              "dclimate:concatPriority": 1,
              "dclimate:concatDimension": "time",
            },
            geometry: null,
            links: [],
            assets: {
              data: { href: "ipfs://bafy-era5-part2-data" },
            },
          },
        ],
      },
    ],
  };
}

describe("getConcatenableItemsFromStac collection resolution", () => {
  it("matches item ids against the resolved collection id", () => {
    const catalog = createCatalog();
    const expected: ConcatenableStacItem[] = [
      {
        variant: "part1",
        cid: "bafy-era5-part1-data",
        concatPriority: 0,
        concatDimension: "time",
      },
      {
        variant: "part2",
        cid: "bafy-era5-part2-data",
        concatPriority: 1,
        concatDimension: "time",
      },
    ];

    expect(
      getConcatenableItemsFromStac(catalog, collection, dataset, organization),
    ).toEqual(expected);

    expect(
      getConcatenableItemsFromStac(catalog, "era5", dataset, organization),
    ).toEqual(expected);
  });
});
