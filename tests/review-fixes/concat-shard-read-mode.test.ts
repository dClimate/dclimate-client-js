import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DClimateClient } from "../../src/index.js";
import type { IpfsElements } from "../../src/types.js";

const openDatasetFromCidMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/ipfs/open-dataset.js", () => ({
  openDatasetFromCid: openDatasetFromCidMock,
  default: openDatasetFromCidMock,
}));

const gatewayUrl = "https://concat-shard-read-mode.test";
const collection = "testorg_autoconcat";
const dataset = "temperature";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as Response;
}

function createDataset(cid: string, times: string[]) {
  return {
    attrs: { _zarr_cid: cid },
    coords: { time: times },
    dataVars: [],
    sizes: { time: times.length },
    isel: vi.fn(async ({ time }: { time: number[] }) =>
      createDataset(
        cid,
        time.map((index) => times[index]),
      ),
    ),
    concat: vi.fn((other: { coords: { time: string[] } }) =>
      createDataset(cid, [...times, ...other.coords.time]),
    ),
  };
}

describe("loadDataset auto-concatenation shard read mode", () => {
  beforeEach(() => {
    openDatasetFromCidMock.mockReset();
    openDatasetFromCidMock.mockImplementation(async (cid: string) => {
      if (cid === "bafy-part2-data") {
        return createDataset(cid, ["2024-01-01T00:00:00Z"]);
      }
      if (cid === "bafy-part1-data") {
        return createDataset(cid, ["2024-01-02T00:00:00Z"]);
      }
      throw new Error(`Unexpected dataset CID: ${cid}`);
    });

    const documents = new Map<string, unknown>([
      [
        "https://ipfs-gateway.dclimate.net/stac",
        { cid: "bafy-root-catalog" },
      ],
      [
        `${gatewayUrl}/ipfs/bafy-root-catalog`,
        {
          type: "Catalog",
          stac_version: "1.0.0",
          id: "root",
          links: [
            {
              rel: "child",
              href: "ipfs://bafy-testorg-catalog",
              "dclimate:id": "testorg",
            },
          ],
        },
      ],
      [
        `${gatewayUrl}/ipfs/bafy-testorg-catalog`,
        {
          type: "Catalog",
          stac_version: "1.0.0",
          id: "testorg",
          links: [
            {
              rel: "child",
              href: "ipfs://bafy-autoconcat-collection",
            },
          ],
        },
      ],
      [
        `${gatewayUrl}/ipfs/bafy-autoconcat-collection`,
        {
          type: "Collection",
          stac_version: "1.0.0",
          id: collection,
          description: "Two concatenable dataset variants",
          links: [
            { rel: "item", href: "ipfs://bafy-part1-item" },
            { rel: "item", href: "ipfs://bafy-part2-item" },
          ],
        },
      ],
      [
        `${gatewayUrl}/ipfs/bafy-part1-item`,
        {
          type: "Feature",
          stac_version: "1.0.0",
          id: `${collection}-${dataset}-part1`,
          properties: {
            "dclimate:concatPriority": 1,
            "dclimate:concatDimension": "time",
          },
          geometry: null,
          links: [],
          assets: { data: { href: "ipfs://bafy-part1-data" } },
        },
      ],
      [
        `${gatewayUrl}/ipfs/bafy-part2-item`,
        {
          type: "Feature",
          stac_version: "1.0.0",
          id: `${collection}-${dataset}-part2`,
          properties: {
            "dclimate:concatPriority": 0,
            "dclimate:concatDimension": "time",
          },
          geometry: null,
          links: [],
          assets: { data: { href: "ipfs://bafy-part2-data" } },
        },
      ],
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : input.toString();
        const document = documents.get(url);
        if (!document) {
          throw new Error(`Unexpected fetch: ${url}`);
        }
        return jsonResponse(document);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes full shard reads to every concatenated variant", async () => {
    const ipfsElements = {} as IpfsElements;
    const client = new DClimateClient({
      gatewayUrl,
      stacServerUrl: null,
      ipfsElements,
    });

    await client.loadDataset({
      request: {
        organization: "testorg",
        collection: "autoconcat",
        dataset,
      },
      options: {
        autoConcatenate: true,
        shardReadMode: "full",
        ipfsElements,
      },
    });

    expect(openDatasetFromCidMock).toHaveBeenCalledTimes(2);
    for (const [, openOptions] of openDatasetFromCidMock.mock.calls) {
      expect(openOptions).toEqual(
        expect.objectContaining({ shardReadMode: "full" }),
      );
    }
  });
});
