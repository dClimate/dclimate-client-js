import { Dataset, ShardedStore, createIpfsElements } from "@dclimate/jaxray";
import { DEFAULT_IPFS_GATEWAY } from "../constants.js";

export type IpfsElements = ReturnType<typeof createIpfsElements>;

export interface OpenDatasetOptions {
  gatewayUrl?: string;
  ipfsElements?: IpfsElements;
}

export async function openDatasetFromCid(
  cid: string,
  options: OpenDatasetOptions = {}
): Promise<Dataset> {
  if (!cid) {
    throw new Error("A CID must be provided to load a dataset.");
  }

  const gatewayUrl = options.gatewayUrl ?? DEFAULT_IPFS_GATEWAY;
  const ipfsElements =
    options.ipfsElements ?? createIpfsElements(gatewayUrl);

  const store = await ShardedStore.open(cid, ipfsElements);
  return Dataset.open_zarr(store);
}
