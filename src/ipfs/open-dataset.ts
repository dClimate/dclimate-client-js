import { Dataset, openIpfsStore } from "@dclimate/jaxray";
import type { IPFSELEMENTS_INTERFACE } from "@dclimate/jaxray";
import { DEFAULT_IPFS_GATEWAY } from "../constants.js";

export type IpfsElements = IPFSELEMENTS_INTERFACE;

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
  const { store } = await openIpfsStore(
    cid,
    options.ipfsElements ?? { gatewayUrl }
  );

  return Dataset.open_zarr(store);
}
