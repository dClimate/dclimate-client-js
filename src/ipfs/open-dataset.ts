import { Dataset, openIpfsStore } from "@dclimate/jaxray";
import type { IPFSELEMENTS_INTERFACE } from "@dclimate/jaxray";
import { DEFAULT_IPFS_GATEWAY } from "../constants.js";
import type { ShardReadMode } from "../types.js";
import {
  classifyRetrievalError,
  recordDatasetOpen,
  recordSpanError,
  recordStoreOpen,
  secondsSince,
  withSpan,
  type RetrievalStatus,
} from "../instrumentation.js";

export type IpfsElements = IPFSELEMENTS_INTERFACE;

export interface OpenDatasetOptions {
  gatewayUrl?: string;
  ipfsElements?: IpfsElements;
  zarrGroup?: string;
  shardReadMode?: ShardReadMode;
}

export function normalizeZarrGroup(group?: string): string | undefined {
  const normalized = group?.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized || undefined;
}

export async function openDatasetFromCid(
  cid: string,
  options: OpenDatasetOptions = {}
): Promise<Dataset> {
  if (!cid) {
    throw new Error("A CID must be provided to load a dataset.");
  }

  const gatewayUrl = options.gatewayUrl ?? DEFAULT_IPFS_GATEWAY;
  const zarrGroup = normalizeZarrGroup(options.zarrGroup);
  const ipfsElements = options.ipfsElements ?? { gatewayUrl };
  const storeOptions = {
    ...ipfsElements,
    shardReadMode: options.shardReadMode ?? "sparse",
  };
  const storeType = "JaxrayIpfsStore";
  const datasetStartedAt = performance.now();
  let status: RetrievalStatus = "error";

  return withSpan(
    "dclimate_client.ipfs.load_zarr_dataset",
    {
      "dclimate_client.ipfs.cid": cid,
      "dclimate_client.ipfs.gateway": gatewayUrl,
      ...(zarrGroup ? { "dclimate_client.ipfs.zarr_group": zarrGroup } : {}),
    },
    async (datasetSpan) => {
      try {
        const { store } = await withSpan(
          "dclimate_client.ipfs.open_jaxray_store",
          {
            "dclimate_client.ipfs.gateway": gatewayUrl,
            "dclimate_client.ipfs.store_type": storeType,
          },
          async (storeSpan) => {
            const storeStartedAt = performance.now();
            try {
              const openedStore = await openIpfsStore(cid, storeOptions);
              recordStoreOpen({
                gatewayUrl,
                storeType,
                status: "ok",
                seconds: secondsSince(storeStartedAt),
              });
              return openedStore;
            } catch (error) {
              const storeStatus = classifyRetrievalError(error);
              recordStoreOpen({
                gatewayUrl,
                storeType,
                status: storeStatus,
                seconds: secondsSince(storeStartedAt),
              });
              recordSpanError(storeSpan, error);
              throw error;
            }
          }
        );

        const dataset = zarrGroup
          ? await Dataset.open_zarr(store, { group: zarrGroup })
          : await Dataset.open_zarr(store);
        status = "ok";
        return dataset;
      } catch (error) {
        status = classifyRetrievalError(error);
        recordSpanError(datasetSpan, error);
        throw error;
      } finally {
        datasetSpan.setAttribute("dclimate_client.ipfs.store_type", storeType);
        datasetSpan.setAttribute("dclimate_client.ipfs.status", status);
        recordDatasetOpen({
          gatewayUrl,
          storeType,
          status,
          seconds: secondsSince(datasetStartedAt),
        });
      }
    }
  );
}
