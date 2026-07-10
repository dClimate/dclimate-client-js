import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_IPFS_GATEWAY } from "../src/constants.js";
import {
  classifyRetrievalError,
  otelAttributes,
} from "../src/instrumentation.js";
import { openDatasetFromCid } from "../src/ipfs/open-dataset.js";

const openIpfsStoreMock = vi.hoisted(() => vi.fn());
const openZarrMock = vi.hoisted(() => vi.fn());

vi.mock("@dclimate/jaxray", () => ({
  Dataset: {
    open_zarr: openZarrMock,
  },
  openIpfsStore: openIpfsStoreMock,
}));

describe("openDatasetFromCid", () => {
  beforeEach(() => {
    openIpfsStoreMock.mockReset();
    openZarrMock.mockReset();
  });

  it("opens an IPFS store and Zarr dataset with default gateway telemetry enabled", async () => {
    const store = { kind: "store" };
    const dataset = { kind: "dataset" };
    openIpfsStoreMock.mockResolvedValue({ store });
    openZarrMock.mockResolvedValue(dataset);

    await expect(openDatasetFromCid("bafytest")).resolves.toBe(dataset);

    expect(openIpfsStoreMock).toHaveBeenCalledWith("bafytest", {
      gatewayUrl: DEFAULT_IPFS_GATEWAY,
    });
    expect(openZarrMock).toHaveBeenCalledWith(store);
  });

  it("passes an explicit Zarr group to jaxray", async () => {
    const store = { kind: "store" };
    const dataset = { kind: "dataset" };
    openIpfsStoreMock.mockResolvedValue({ store });
    openZarrMock.mockResolvedValue(dataset);

    await expect(openDatasetFromCid("bafygrouped", { zarrGroup: "/0/" })).resolves.toBe(dataset);

    expect(openZarrMock).toHaveBeenCalledWith(store, { group: "0" });
  });

  it("uses caller supplied IPFS elements", async () => {
    const ipfsElements = { gatewayUrl: "https://example.invalid" };
    const store = { kind: "custom-store" };
    const dataset = { kind: "dataset" };
    openIpfsStoreMock.mockResolvedValue({ store });
    openZarrMock.mockResolvedValue(dataset);

    await openDatasetFromCid("bafycustom", { ipfsElements });

    expect(openIpfsStoreMock).toHaveBeenCalledWith("bafycustom", ipfsElements);
  });

  it("forwards sparse shard decoding to jaxray", async () => {
    const store = { kind: "sparse-store" };
    const dataset = { kind: "dataset" };
    openIpfsStoreMock.mockResolvedValue({ store });
    openZarrMock.mockResolvedValue(dataset);

    await openDatasetFromCid("bafysparse", {
      ipfsElements: { gatewayUrl: "https://example.invalid" },
      shardReadMode: "sparse",
    });

    expect(openIpfsStoreMock).toHaveBeenCalledWith("bafysparse", {
      gatewayUrl: "https://example.invalid",
      shardReadMode: "sparse",
    });
  });

  it("preserves retrieval errors from the store opener", async () => {
    const error = new Error("ETIMEDOUT while opening store");
    openIpfsStoreMock.mockRejectedValue(error);

    await expect(openDatasetFromCid("bafytimeout")).rejects.toThrow(error);
  });
});

describe("retrieval instrumentation helpers", () => {
  it("keeps metric attributes primitive and bounded", () => {
    expect(
      otelAttributes({
        keep: "value",
        count: 3,
        enabled: true,
        drop: undefined,
        stringify: { nested: "value" },
      })
    ).toEqual({
      keep: "value",
      count: 3,
      enabled: true,
      stringify: "[object Object]",
    });
  });

  it("classifies common gateway connection errors", () => {
    expect(classifyRetrievalError(new Error("ETIMEDOUT"))).toBe(
      "connection_error"
    );
    expect(classifyRetrievalError(new Error("zarr metadata missing"))).toBe(
      "error"
    );
  });
});
