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
 *   METRIC             — Single metric name for SDK smoke test (default: average_precip)
 *   SECOND_METRIC      — Second metric for multi-metric raw test (default: average_temp_max)
 *   MULTI_METRICS      — Optional override for comma-separated multi-metric request
 *   NETWORK            — Payment network (default: base-sepolia)
 *   MAX_AMOUNT_ATOMIC  — Optional hard cap in token atomic units (e.g. 100000 = $0.10 USDC)
 *   MAX_USD_CENTS      — Optional hard cap in USD cents for 6-decimal stablecoins (e.g. 10 = $0.10)
 */

import { createPublicClient, http } from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { SirenClient } from "../src/siren/index.js";
import type { EvmSigner } from "../src/siren/types.js";
import * as fs from "fs";
import * as path from "path";

// ─── Config ──────────────────────────────────────────────

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:8080";
const REGION_ID = process.env.REGION_ID || "4c59966e-8653-4534-a640-5b0e9be3de81";
const METRIC = process.env.METRIC || "average_precip";
const SECOND_METRIC = process.env.SECOND_METRIC || (METRIC === "average_temp_max" ? "average_temp_min" : "average_temp_max");
const MULTI_METRICS = process.env.MULTI_METRICS || `${METRIC},${SECOND_METRIC}`;
const NETWORK = process.env.NETWORK || "base-sepolia";
const MAX_AMOUNT_ATOMIC = process.env.MAX_AMOUNT_ATOMIC ? String(process.env.MAX_AMOUNT_ATOMIC) : undefined;
const MAX_USD_CENTS = process.env.MAX_USD_CENTS ? Number(process.env.MAX_USD_CENTS) : undefined;
const USD_CENTS_TO_6_DECIMAL_ATOMIC = 10_000n;

const CHAIN_MAP: Record<string, { chain: (typeof base) | (typeof baseSepolia); rpcUrl?: string }> = {
  base: { chain: base },
  "base-sepolia": { chain: baseSepolia },
};

const NETWORK_TO_CAIP2: Record<string, string> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  ethereum: "eip155:1",
  arbitrum: "eip155:42161",
  optimism: "eip155:10",
  polygon: "eip155:137",
  avalanche: "eip155:43114",
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

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function parsePositiveBigInt(value: string | bigint, fieldName: string): bigint {
  if (typeof value === "bigint") {
    if (value <= 0n) {
      throw new Error(`${fieldName} must be greater than 0.`);
    }
    return value;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${fieldName} must be a positive integer string.`);
  }

  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new Error(`${fieldName} must be greater than 0.`);
  }
  return parsed;
}

function resolveMaxPaymentAmountAtomic(): bigint | undefined {
  const fromAtomic =
    MAX_AMOUNT_ATOMIC !== undefined
      ? parsePositiveBigInt(MAX_AMOUNT_ATOMIC, "MAX_AMOUNT_ATOMIC")
      : undefined;

  const fromUsdCents =
    MAX_USD_CENTS !== undefined
      ? (() => {
          if (!Number.isInteger(MAX_USD_CENTS) || MAX_USD_CENTS <= 0) {
            throw new Error("MAX_USD_CENTS must be a positive integer.");
          }
          return BigInt(MAX_USD_CENTS) * USD_CENTS_TO_6_DECIMAL_ATOMIC;
        })()
      : undefined;

  if (fromAtomic !== undefined && fromUsdCents !== undefined) {
    return fromAtomic < fromUsdCents ? fromAtomic : fromUsdCents;
  }

  return fromAtomic ?? fromUsdCents;
}

function getRequirementAmountAtomic(requirement: unknown): bigint | null {
  if (!requirement || typeof requirement !== "object") return null;

  const record = requirement as Record<string, unknown>;
  const rawAmount = record.amount ?? record.maxAmountRequired;
  if (typeof rawAmount !== "string" || !/^\d+$/.test(rawAmount)) return null;
  return BigInt(rawAmount);
}

function createX402Fetch(signer: EvmSigner, network: string): typeof fetch {
  const caip2 = (NETWORK_TO_CAIP2[network] ?? network) as `${string}:${string}`;
  const scheme = new ExactEvmScheme(toClientEvmSigner(signer as never));
  const client = new x402Client();
  const maxAmountAtomic = resolveMaxPaymentAmountAtomic();

  if (maxAmountAtomic !== undefined) {
    client.registerPolicy((_x402Version, requirements) => {
      const affordable = requirements.filter((requirement) => {
        const amountAtomic = getRequirementAmountAtomic(requirement);
        return amountAtomic !== null && amountAtomic <= maxAmountAtomic;
      });

      if (affordable.length === 0) {
        const offered = requirements
          .map((requirement) => getRequirementAmountAtomic(requirement))
          .filter((amount): amount is bigint => amount !== null)
          .map((amount) => amount.toString());

        throw new Error(
          `x402 payment exceeds configured max amount (${maxAmountAtomic.toString()} atomic units). Offered amounts: ${offered.length > 0 ? offered.join(", ") : "unknown"}.`
        );
      }

      return affordable;
    });
  }

  client.register(caip2, scheme);
  return wrapFetchWithPayment(fetch, client);
}

function printMetricSeriesSummary(metric: string, series: unknown): void {
  if (!series || typeof series !== "object" || Array.isArray(series)) {
    console.log(`  ${metric}: unexpected response shape`);
    return;
  }

  const entries = Object.entries(series as Record<string, unknown>);
  console.log(`  ${metric}: ${entries.length} data points`);

  if (entries.length === 0) return;

  const [firstDate, firstValue] = entries[0];
  const [lastDate, lastValue] = entries[entries.length - 1];
  console.log(`    First: ${firstDate} = ${firstValue}`);
  console.log(`    Last:  ${lastDate} = ${lastValue}`);
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
  console.log(`Metric:   ${METRIC}`);
  console.log(`Metrics:  ${MULTI_METRICS}\n`);
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
  console.log("--- Get Metric Data (single metric, x402 paid) ---");
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

  // 3. Test paid endpoint: get multiple metrics in one request.
  // SirenClient.getMetricData() currently flattens a single metric only, so
  // use raw x402 fetch here to verify the combined response shape directly.
  console.log("\n--- Get Metric Data (multiple metrics, raw x402 paid) ---");
  const x402Fetch = createX402Fetch(signer, NETWORK);
  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);
  const multiMetricUrl = `${GATEWAY_URL}/v1/siren/metric-data/${REGION_ID}/${MULTI_METRICS}/${startDateStr}/${endDateStr}`;
  const multiMetricStartedAt = Date.now();

  try {
    const response = await x402Fetch(multiMetricUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Gateway returned ${response.status}: ${response.statusText}`);
    }

    const body = await response.json();
    const elapsedMs = Date.now() - multiMetricStartedAt;
    console.log(`Request time: ${elapsedMs} ms (${(elapsedMs / 1000).toFixed(2)} s)`);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Unexpected multi-metric response format: expected an object keyed by metric.");
    }

    const metrics = Object.keys(body as Record<string, unknown>);
    console.log(`Received ${metrics.length} metric series`);
    for (const metric of metrics) {
      printMetricSeriesSummary(metric, (body as Record<string, unknown>)[metric]);
    }
  } catch (err) {
    const elapsedMs = Date.now() - multiMetricStartedAt;
    console.error("multi-metric request failed:", (err as Error).message);
    console.log(`Request time before failure: ${elapsedMs} ms (${(elapsedMs / 1000).toFixed(2)} s)`);
  }

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
