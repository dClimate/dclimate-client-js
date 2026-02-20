/**
 * Example: Fetch Siren metric data using the dClimate client.
 *
 * Prerequisites:
 *   - Set SIREN_API_KEY and SIREN_ACCOUNT_ID environment variables
 *   - Or pass them directly in the auth config
 *
 * Run:
 *   npx tsx examples/siren-metric-data.ts
 */

import { DClimateClient } from "../src/index.js";

async function main() {
  const client = new DClimateClient({
    siren: {
      auth: { type: "apiKey" }, // reads from SIREN_API_KEY & SIREN_ACCOUNT_ID env vars
    },
  });

  // Convert unix timestamps to dates
  const startDate = new Date(1767225600 * 1000); // 2025-12-31
  const endDate = new Date(1798761599 * 1000);   // 2026-12-31

  console.log(`Fetching average_precip for region 4c59966e-8653-4534-a640-5b0e9be3de81`);
  console.log(`Date range: ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`);

  const data = await client.getMetricData({
    // Example of region id tied to a specific account
    regionId: "4c59966e-8653-4534-a640-5b0e9be3de81",
    metric: "average_precip",
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
