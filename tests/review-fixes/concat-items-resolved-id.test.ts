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
        zarrResolutions: [],
      },
      {
        variant: "part2",
        cid: "bafy-era5-part2-data",
        concatPriority: 1,
        concatDimension: "time",
        zarrResolutions: [],
      },
    ];

    expect(
      getConcatenableItemsFromStac(catalog, collection, dataset, organization),
    ).toEqual(expected);

    expect(
      getConcatenableItemsFromStac(catalog, "era5", dataset, organization),
    ).toEqual(expected);
  });

  it("excludes variants without an explicit concatPriority", () => {
    const catalog = createCatalog();
    const collectionObj = catalog.collections![0];
    for (const item of collectionObj.items ?? []) {
      delete item.properties["dclimate:concatPriority"];
    }

    expect(
      getConcatenableItemsFromStac(catalog, collection, dataset, organization),
    ).toEqual([]);
  });

  it("returns only the opted-in variant when a sibling lacks concatPriority", () => {
    const catalog = createCatalog();
    const collectionObj = catalog.collections![0];
    delete collectionObj.items![1].properties["dclimate:concatPriority"];

    expect(
      getConcatenableItemsFromStac(catalog, collection, dataset, organization),
    ).toEqual([
      {
        variant: "part1",
        cid: "bafy-era5-part1-data",
        concatPriority: 0,
        concatDimension: "time",
        zarrResolutions: [],
      },
    ]);
  });

  it("honors concatPriority declared only on the collection's item link", () => {
    const catalog = createCatalog();
    const collectionObj = catalog.collections![0];
    for (const item of collectionObj.items ?? []) {
      delete item.properties["dclimate:concatPriority"];
    }
    collectionObj.links = (collectionObj.items ?? []).map((item, index) => ({
      rel: "item",
      href: `ipfs://bafy-item-${index}`,
      "dclimate:id": item.id,
      "dclimate:concatPriority": index,
    }));

    const items = getConcatenableItemsFromStac(
      catalog,
      collection,
      dataset,
      organization,
    );
    expect(items.map((item) => item.variant)).toEqual(["part1", "part2"]);
    expect(items.map((item) => item.concatPriority)).toEqual([0, 1]);
  });

  it("matches collection and dataset names containing hyphens", () => {
    const hyphenCollection = "ecmwf_era-5";
    const hyphenDataset = "wind-speed";
    const catalog: StacCatalog = {
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
          id: hyphenCollection,
          description: "Hyphenated names",
          organizationId: organization,
          links: [],
          items: ["part1", "part2"].map((variant, index) => ({
            type: "Feature",
            stac_version: "1.0.0",
            id: `${hyphenCollection}-${hyphenDataset}-${variant}`,
            properties: {
              "dclimate:concatPriority": index,
              "dclimate:concatDimension": "time",
            },
            geometry: null,
            links: [],
            assets: {
              data: { href: `ipfs://bafy-${variant}-data` },
            },
          })),
        },
      ],
    };

    const items = getConcatenableItemsFromStac(
      catalog,
      hyphenCollection,
      hyphenDataset,
      organization,
    );
    expect(items.map((item) => item.variant)).toEqual(["part1", "part2"]);
  });
});
