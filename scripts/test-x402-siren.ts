/**
 * Test script: make an x402-paid request to Siren via the local gateway.
 *
 * Prerequisites:
 *   1. Install optional x402 + viem deps:
 *      npm install @x402/core @x402/fetch @x402/evm viem
 *
 *   2. Provide a wallet private key via ONE of:
 *      - PRIVATE_KEY env var (hex, with or without 0x prefix)
 *      - .env file with PRIVATE_KEY=0x...
 *      - mnemonic.txt file in project root (BIP-39 mnemonic phrase)
 *
 *   3. Start the x402 gateway:
 *      cd ../x402-gateway && npm start
 *
 * Usage:
 *   npx tsx scripts/test-x402-siren.ts
 *
 * Environment variables:
 *   PRIVATE_KEY        — Wallet private key (hex)
 *   GATEWAY_URL        — Gateway base URL (default: http://localhost:8080)
 *   REGION_ID          — Siren region ID to query
 *   METRIC             — Metric name (default: average_precip)
 *   NETWORK            — Payment network (default: base-sepolia)
 */

import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import { SirenClient } from "../src/siren/index.js";
import type { EvmSigner } from "../src/siren/types.js";
import * as fs from "fs";
import * as path from "path";

// ─── Config ──────────────────────────────────────────────

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:8080";
const REGION_ID = process.env.REGION_ID || "4c59966e-8653-4534-a640-5b0e9be3de81";
const METRIC = process.env.METRIC || "average_precip";
const NETWORK = process.env.NETWORK || "base-sepolia";

const CHAIN_MAP: Record<string, { chain: (typeof base) | (typeof baseSepolia); rpcUrl?: string }> = {
  base: { chain: base },
  "base-sepolia": { chain: baseSepolia },
};

// ─── Resolve private key ─────────────────────────────────

function loadPrivateKey(): `0x${string}` | null {
  // 1. Environment variable
  if (process.env.PRIVATE_KEY) {
    const key = process.env.PRIVATE_KEY;
    return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
  }

  // 2. .env file (simple parser — just PRIVATE_KEY=value)
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    const match = content.match(/^PRIVATE_KEY=(.+)$/m);
    if (match) {
      const key = match[1].trim();
      return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
    }
  }

  return null;
}

function loadMnemonic(): string | null {
  const mnemonicPath = path.resolve(process.cwd(), "mnemonic.txt");
  if (fs.existsSync(mnemonicPath)) {
    return fs.readFileSync(mnemonicPath, "utf-8").trim();
  }
  return null;
}

// ─── Build EvmSigner from viem wallet ────────────────────

function createViemSigner(network: string): EvmSigner {
  const chainConfig = CHAIN_MAP[network];
  if (!chainConfig) {
    throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(CHAIN_MAP).join(", ")}`);
  }

  const privateKey = loadPrivateKey();
  const mnemonic = loadMnemonic();

  if (!privateKey && !mnemonic) {
    throw new Error(
      "No wallet credentials found. Provide PRIVATE_KEY env var, .env file, or mnemonic.txt"
    );
  }

  const account = privateKey
    ? privateKeyToAccount(privateKey)
    : mnemonicToAccount(mnemonic!);

  const walletClient = createWalletClient({
    account,
    chain: chainConfig.chain,
    transport: http(),
  });

  const publicClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(),
  });

  return {
    get address() {
      return account.address;
    },

    async signTypedData(params) {
      return walletClient.signTypedData({
        domain: params.domain as Record<string, unknown>,
        types: params.types as Record<string, unknown[]>,
        primaryType: params.primaryType,
        message: params.message,
      } as Parameters<typeof walletClient.signTypedData>[0]);
    },

    async readContract(params) {
      return publicClient.readContract({
        address: params.address,
        abi: params.abi,
        functionName: params.functionName,
        args: params.args,
      } as never);
    },
  };
}

// ─── Main ────────────────────────────────────────────────

async function main() {
  console.log("=== x402 Siren Gateway Test ===\n");
  console.log(`Gateway:  ${GATEWAY_URL}`);
  console.log(`Network:  ${NETWORK}`);
  console.log(`Region:   ${REGION_ID}`);
  console.log(`Metric:   ${METRIC}\n`);

  const signer = createViemSigner(NETWORK);
  console.log(`Wallet:   ${signer.address}\n`);

  const client = new SirenClient({
    auth: {
      type: "x402",
      signer,
      network: NETWORK,
    },
    x402BaseUrl: `${GATEWAY_URL}/v1/siren`,
  });

  // 1. Test free endpoint: list regions
  console.log("--- List Regions (free) ---");
  try {
    const regions = await client.listRegions();
    console.log(`Found ${regions.length} regions`);
    if (regions.length > 0) {
      console.log(`  First: ${regions[0].name} (id: ${regions[0].id})`);
    }
    console.log();
  } catch (err) {
    console.error("listRegions failed:", (err as Error).message);
    console.log();
  }

  // 2. Test paid endpoint: get metric data
  console.log("--- Get Metric Data (x402 paid) ---");
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30); // last 30 days

  try {
    const data = await client.getMetricData({
      regionId: REGION_ID,
      metric: METRIC,
      startDate,
      endDate,
    });
    console.log(`Received ${data.length} data points`);
    if (data.length > 0) {
      console.log(`  First: ${data[0].date} = ${data[0].value}`);
      console.log(`  Last:  ${data[data.length - 1].date} = ${data[data.length - 1].value}`);
    }
  } catch (err) {
    console.error("getMetricData failed:", (err as Error).message);
  }

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
