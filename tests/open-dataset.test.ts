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
    const dataset = { kind: "dataset", attrs: {} };
    openIpfsStoreMock.mockResolvedValue({ store });
    openZarrMock.mockResolvedValue(dataset);

    await expect(openDatasetFromCid("bafytest")).resolves.toBe(dataset);

    expect(openIpfsStoreMock).toHaveBeenCalledWith("bafytest", {
      gatewayUrl: DEFAULT_IPFS_GATEWAY,
      shardReadMode: "sparse",
    });
    expect(openZarrMock).toHaveBeenCalledWith(store);
  });

  it("passes an explicit Zarr group to jaxray", async () => {
    const store = { kind: "store" };
    const dataset = { kind: "dataset", attrs: {} };
    openIpfsStoreMock.mockResolvedValue({ store });
    openZarrMock.mockResolvedValue(dataset);

    await expect(openDatasetFromCid("bafygrouped", { zarrGroup: "/0/" })).resolves.toBe(dataset);

    expect(openZarrMock).toHaveBeenCalledWith(store, { group: "0" });
    expect(dataset.attrs).toEqual({ _ipfs_zarr_group: "0" });
  });

  it("safely retries group zero when jaxray reports an ambiguous grouped root", async () => {
    const store = { kind: "grouped-store" };
    const dataset = { kind: "dataset", attrs: {} as Record<string, unknown> };
    openIpfsStoreMock.mockResolvedValue({ store });
    openZarrMock
      .mockRejectedValueOnce(
        new Error(
          "ZarrBackend.open: grouped Zarr stores with multiple top-level groups require an explicit group option."
        )
      )
      .mockResolvedValueOnce(dataset);

    await expect(openDatasetFromCid("bafygrouped")).resolves.toBe(dataset);

    expect(openZarrMock).toHaveBeenNthCalledWith(1, store);
    expect(openZarrMock).toHaveBeenNthCalledWith(2, store, { group: "0" });
    expect(dataset.attrs._ipfs_zarr_group).toBe("0");
  });

  it("uses caller supplied IPFS elements", async () => {
    const ipfsElements = { gatewayUrl: "https://example.invalid" };
    const store = { kind: "custom-store" };
    const dataset = { kind: "dataset" };
    openIpfsStoreMock.mockResolvedValue({ store });
    openZarrMock.mockResolvedValue(dataset);

    await openDatasetFromCid("bafycustom", { ipfsElements });

    expect(openIpfsStoreMock).toHaveBeenCalledWith("bafycustom", {
      ...ipfsElements,
      shardReadMode: "sparse",
    });
  });

  it("forwards explicit full shard decoding to jaxray", async () => {
    const store = { kind: "full-store" };
    const dataset = { kind: "dataset" };
    openIpfsStoreMock.mockResolvedValue({ store });
    openZarrMock.mockResolvedValue(dataset);

    await openDatasetFromCid("bafyfull", {
      ipfsElements: { gatewayUrl: "https://example.invalid" },
      shardReadMode: "full",
    });

    expect(openIpfsStoreMock).toHaveBeenCalledWith("bafyfull", {
      gatewayUrl: "https://example.invalid",
      shardReadMode: "full",
    });
  });

  it("forwards explicit sparse shard decoding to jaxray", async () => {
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
