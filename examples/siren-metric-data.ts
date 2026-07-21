/**
 * Example: Fetch Siren metric data using the dClimate client.
 *
 * Prerequisites:
 *   - Set SIREN_API_KEY and SIREN_ACCOUNT_ID environment variables
 *   - Or pass them directly in the auth config
 *
 * Run:
 *   npx tsx examples/siren-metric-data.ts [regionId]
 *
 * Optionally pass a region id as the first argument (or via the REGION_ID env
 * var). If omitted, the example uses the first region available to your account.
 */

import { DClimateClient } from "../src/index.js";

async function main() {
  const client = new DClimateClient({
    siren: {
      auth: { type: "apiKey" }, // reads from SIREN_API_KEY & SIREN_ACCOUNT_ID env vars
    },
  });

  // Discover a region from the caller's own account rather than hardcoding an
  // id (region ids are account-scoped, so a fixed one fails for most users).
  const requestedRegionId = process.env.REGION_ID ?? process.argv[2];
  const regions = await client.siren.listRegions();
  if (regions.length === 0) {
    throw new Error("No Siren regions available for this account.");
  }
  const region = regions.find((r) => r.id === requestedRegionId) ?? regions[0];

  // Prefer average_precip if the account exposes it, else the first metric.
  const metrics = await client.siren.listMetrics();
  const metric = metrics.includes("average_precip") ? "average_precip" : metrics[0];
  if (!metric) {
    throw new Error("No Siren metrics available.");
  }

  // Convert unix timestamps to dates
  const startDate = new Date(1767225600 * 1000); // 2025-12-31
  const endDate = new Date(1798761599 * 1000);   // 2026-12-31

  console.log(`Fetching ${metric} for region ${region.id} (${region.name})`);
  console.log(`Date range: ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`);

  const data = await client.siren.getMetricData({
    regionId: region.id,
    metric,
    startDate,
    endDate,
  });

  console.log("Response:");
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
