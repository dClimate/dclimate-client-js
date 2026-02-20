/**
 * Simple script to load and inspect a dataset.
 *
 * Usage:
 *   npx tsx scripts/inspect-dataset.ts <org> <collection> <dataset> [variant]
 *   npx tsx scripts/inspect-dataset.ts --cid <cid>
 *
 * Examples:
 *   npx tsx scripts/inspect-dataset.ts ecmwf era5 temperature_2m finalized
 *   npx tsx scripts/inspect-dataset.ts ecmwf era5 temperature_2m
 *   npx tsx scripts/inspect-dataset.ts --cid bafybeig...
 */

import { DClimateClient } from "../src/index.js";
import type { DatasetMetadata } from "../src/index.js";
import { Dataset } from "@dclimate/jaxray";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage:");
    console.log("  npx tsx scripts/inspect-dataset.ts <org> <collection> <dataset> [variant]");
    console.log("  npx tsx scripts/inspect-dataset.ts --cid <cid>");
    process.exit(1);
  }

  const client = new DClimateClient({ stacServerUrl: null });
  let dataset: Dataset;
  let metadata: DatasetMetadata;

  if (args[0] === "--cid") {
    const cid = args[1];
    if (!cid) {
      console.error("Error: --cid requires a CID argument");
      process.exit(1);
    }
    console.log(`Loading dataset from CID: ${cid}\n`);
    [dataset, metadata] = await client.loadDataset({
      request: { cid },
      options: { returnJaxrayDataset: true },
    }) as [Dataset, DatasetMetadata];
  } else {
    const [organization, collection, datasetName, variant] = args;
    if (!organization || !collection || !datasetName) {
      console.error("Error: need at least <org> <collection> <dataset>");
      process.exit(1);
    }
    console.log(`Loading: ${organization}/${collection}/${datasetName}${variant ? `/${variant}` : ""}\n`);
    [dataset, metadata] = await client.loadDataset({
      request: { organization, collection, dataset: datasetName, variant },
      options: { returnJaxrayDataset: true },
    }) as [Dataset, DatasetMetadata];
  }

  // Print metadata
  console.log("=== Metadata ===");
  console.log(JSON.stringify(metadata, null, 2));

  // Print dataset attrs
  console.log("\n=== Dataset Attrs ===");
  console.log(JSON.stringify(dataset.attrs, null, 2));

  // Print dimensions & coordinates
  console.log("\n=== Dimensions ===");
  for (const [dim, size] of Object.entries(dataset.dims)) {
    console.log(`  ${dim}: ${size}`);
  }

  console.log("\n=== Coordinates ===");
  for (const [name, values] of Object.entries(dataset.coords)) {
    const arr = values as unknown[];
    const preview = arr.length > 6
      ? [...arr.slice(0, 3), "...", ...arr.slice(-3)]
      : arr;
    console.log(`  ${name} (${arr.length}): [${preview.join(", ")}]`);
  }

  // Print data variables
  console.log("\n=== Data Variables ===");
  const varNames = dataset.dataVars ?? Object.keys(dataset.dataVars ?? {});
  for (const name of varNames) {
    const v = dataset.getVariable(name);
    console.log(`  ${name}: dims=${JSON.stringify(v.dims)}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Error loading dataset:", err);
  process.exit(1);
});
