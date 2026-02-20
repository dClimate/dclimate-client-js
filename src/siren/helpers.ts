/**
 * Browser wallet helpers for x402 payment signing.
 *
 * Provides a thin adapter from the standard EIP-1193 provider interface
 * (MetaMask, Coinbase Wallet, WalletConnect, etc.) to the EvmSigner
 * interface used by this SDK.
 */

import { encodeFunctionData, type Abi } from "viem";
import type { EvmSigner } from "./types.js";

/**
 * Minimal EIP-1193 provider interface.
 * Compatible with window.ethereum from MetaMask and other injected wallets.
 */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
}

/**
 * Creates an EvmSigner from any EIP-1193 compatible provider.
 *
 * @example Browser with MetaMask
 * ```typescript
 * const signer = createEip1193Signer(window.ethereum);
 * const client = new DClimateClient({
 *   siren: {
 *     auth: { type: "x402", signer, network: "base" },
 *     x402BaseUrl: "https://x402-api-siren.dclimate.net",
 *   },
 * });
 * ```
 */
export function createEip1193Signer(provider: Eip1193Provider): EvmSigner {
  let cachedAddress: `0x${string}` | undefined;

  async function getAddress(): Promise<`0x${string}`> {
    if (cachedAddress) return cachedAddress;
    const accounts = (await provider.request({
      method: "eth_requestAccounts",
    })) as string[];
    if (!accounts || accounts.length === 0) {
      throw new Error("No accounts available from wallet provider");
    }
    cachedAddress = accounts[0] as `0x${string}`;
    return cachedAddress;
  }

  return {
    get address(): `0x${string}` {
      if (!cachedAddress) {
        throw new Error(
          "Wallet address not yet available. The address is populated after the first signing request. " +
            "If you need the address upfront, call any Siren method first or access window.ethereum directly."
        );
      }
      return cachedAddress;
    },

    async signTypedData(params) {
      const address = await getAddress();
      const typedData = JSON.stringify({
        domain: params.domain,
        types: params.types,
        primaryType: params.primaryType,
        message: params.message,
      });
      const signature = (await provider.request({
        method: "eth_signTypedData_v4",
        params: [address, typedData],
      })) as `0x${string}`;
      return signature;
    },

    async readContract(params) {
      const { address: contractAddress, abi, functionName, args = [] } = params;

      const data = encodeFunctionData({
        abi: abi as Abi,
        functionName,
        args,
      });
      const result = await provider.request({
        method: "eth_call",
        params: [
          {
            to: contractAddress,
            data,
          },
          "latest",
        ],
      });
      return result;
    },
  };
}
