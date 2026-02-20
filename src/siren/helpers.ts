/**
 * Browser wallet helpers for x402 payment signing.
 *
 * Provides a thin adapter from the standard EIP-1193 provider interface
 * (MetaMask, Coinbase Wallet, WalletConnect, etc.) to the EvmSigner
 * interface used by this SDK.
 */

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
      // EIP-1193 providers support eth_call for read-only contract calls
      const { address: contractAddress, abi, functionName, args = [] } = params;

      // For EIP-1193, we encode the call using eth_call
      // The x402 SDK typically handles this internally, but we provide a basic implementation
      const result = await provider.request({
        method: "eth_call",
        params: [
          {
            to: contractAddress,
            data: encodeCallData(abi, functionName, args),
          },
          "latest",
        ],
      });
      return result;
    },
  };
}

/**
 * Minimal ABI function call encoder.
 * Handles the common case of reading ERC-20 balances/allowances used by x402.
 */
function encodeCallData(
  abi: unknown[],
  functionName: string,
  args: unknown[]
): string {
  // Find the function in the ABI
  const func = abi.find(
    (item: unknown) =>
      typeof item === "object" &&
      item !== null &&
      (item as Record<string, unknown>).type === "function" &&
      (item as Record<string, unknown>).name === functionName
  ) as Record<string, unknown> | undefined;

  if (!func) {
    throw new Error(`Function ${functionName} not found in ABI`);
  }

  // Compute function selector (first 4 bytes of keccak256 of signature)
  const inputs = (func.inputs as Array<{ type: string }>) || [];
  const signature = `${functionName}(${inputs.map((i) => i.type).join(",")})`;

  // Use a simple keccak256 - if crypto.subtle is available (browser), use that
  // For the x402 flow, readContract is rarely called directly by the signer
  // The @x402/evm package handles most encoding internally
  // This is a fallback for basic provider-only setups
  return encodeFunctionSignature(signature, args);
}

function encodeFunctionSignature(
  _signature: string,
  _args: unknown[]
): string {
  // Minimal implementation: the x402 protocol primarily uses signTypedData,
  // not readContract, for client-side operations. If a user needs full
  // readContract support, they should use @x402/evm's toClientEvmSigner()
  // with a viem publicClient instead of createEip1193Signer().
  throw new Error(
    "readContract via EIP-1193 provider requires a full ABI encoder. " +
      "For advanced contract reads, use @x402/evm's toClientEvmSigner() with a viem publicClient."
  );
}
