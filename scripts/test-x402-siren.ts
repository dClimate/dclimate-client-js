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
 *   MAX_AMOUNT_ATOMIC  — Optional hard cap in token atomic units (e.g. 100000 = $0.10 USDC)
 *   MAX_USD_CENTS      — Optional hard cap in USD cents for 6-decimal stablecoins (e.g. 10 = $0.10)
 */

import { createPublicClient, http } from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import { toClientEvmSigner } from "@x402/evm";
import { SirenClient } from "../src/siren/index.js";
import type { EvmSigner } from "../src/siren/types.js";
import * as fs from "fs";
import * as path from "path";

// ─── Config ──────────────────────────────────────────────

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:8080";
const REGION_ID = process.env.REGION_ID || "4c59966e-8653-4534-a640-5b0e9be3de81";
const METRIC = process.env.METRIC || "average_precip";
const NETWORK = process.env.NETWORK || "base-sepolia";
const MAX_AMOUNT_ATOMIC = process.env.MAX_AMOUNT_ATOMIC ? String(process.env.MAX_AMOUNT_ATOMIC) : undefined;
const MAX_USD_CENTS = process.env.MAX_USD_CENTS ? Number(process.env.MAX_USD_CENTS) : undefined;

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

  const publicClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
  });

  // Use x402's built-in viem adapter instead of hand-rolling an EvmSigner.
  return toClientEvmSigner(account, publicClient) as EvmSigner;
}

// ─── Main ────────────────────────────────────────────────

async function main() {
  console.log("=== x402 Siren Gateway Test ===\n");
  console.log(`Gateway:  ${GATEWAY_URL}`);
  console.log(`Network:  ${NETWORK}`);
  console.log(`Region:   ${REGION_ID}`);
  console.log(`Metric:   ${METRIC}\n`);
  if (MAX_AMOUNT_ATOMIC) {
    console.log(`Max atomic payment: ${MAX_AMOUNT_ATOMIC}`);
  }
  if (MAX_USD_CENTS !== undefined) {
    console.log(`Max USD payment:    ${MAX_USD_CENTS} cents`);
  }

  const signer = createViemSigner(NETWORK);
  console.log(`Wallet:   ${signer.address}\n`);

  const client = new SirenClient({
    auth: {
      type: "x402",
      signer,
      network: NETWORK,
      maxAmountAtomic: MAX_AMOUNT_ATOMIC,
      maxUsdCents: MAX_USD_CENTS,
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
  const getMetricDataStartedAt = Date.now();

  try {
    const data = await client.getMetricData({
      regionId: REGION_ID,
      metric: METRIC,
      startDate,
      endDate,
    });
    const getMetricDataElapsedMs = Date.now() - getMetricDataStartedAt;
    console.log(`Received ${data.length} data points`);
    console.log(`Request time: ${getMetricDataElapsedMs} ms (${(getMetricDataElapsedMs / 1000).toFixed(2)} s)`);
    if (data.length > 0) {
      console.log(`  First: ${data[0].date} = ${data[0].value}`);
      console.log(`  Last:  ${data[data.length - 1].date} = ${data[data.length - 1].value}`);
    }
  } catch (err) {
    const getMetricDataElapsedMs = Date.now() - getMetricDataStartedAt;
    console.error("getMetricData failed:", (err as Error).message);
    console.log(`Request time before failure: ${getMetricDataElapsedMs} ms (${(getMetricDataElapsedMs / 1000).toFixed(2)} s)`);
  }

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
