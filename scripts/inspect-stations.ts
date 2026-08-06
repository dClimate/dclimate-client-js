/**
 * Load and inspect a station dataset through `client.stations`.
 *
 * The station counterpart to `inspect-dataset.ts`: that one walks a gridded
 * Zarr dataset, this one walks point observations. Both go through the same
 * client, which is the thing worth seeing -- station data is not a separate
 * SDK, just a second namespace.
 *
 * Usage:
 *   npx tsx scripts/inspect-stations.ts <cid>
 *   npx tsx scripts/inspect-stations.ts <cid> --station USW00094728 --element TMAX
 *   npx tsx scripts/inspect-stations.ts <cid> --near 40.78,-73.97 --from 2025-07-01 --to 2025-07-08
 *
 * Options:
 *   --gateway <url>     IPFS HTTP gateway (default http://127.0.0.1:8080)
 *   --station <id>      Restrict to one station id (repeatable)
 *   --near <lat,lon>    Use the single nearest station to a point instead
 *   --element <name>    Restrict to one element, e.g. TMAX, TMIN, PRCP (repeatable)
 *   --from <date>       ISO date, inclusive
 *   --to <date>         ISO date, inclusive
 *   --limit <n>         Rows to print (default 10; 0 prints all)
 *   --plan              Show what would be fetched, then stop
 *
 * Requires an IPFS gateway that can serve the dataset's blocks. A local Kubo
 * daemon (`ipfs daemon`) is the usual answer; any gateway works.
 */

import { DClimateClient } from "../src/index.js";
import type { StationDataset, StationInfo } from "@dclimate/dparquet/reader";

const DEFAULT_GATEWAY = "http://127.0.0.1:8080";

interface Args {
  cid: string;
  gateway: string;
  stations: string[];
  near: [number, number] | null;
  elements: string[];
  from: string | null;
  to: string | null;
  limit: number;
  plan: boolean;
}

const USAGE = `Usage:
  npx tsx scripts/inspect-stations.ts <cid> [options]

Options:
  --gateway <url>     IPFS HTTP gateway (default ${DEFAULT_GATEWAY})
  --station <id>      Restrict to one station id (repeatable)
  --near <lat,lon>    Use the single nearest station to a point
  --element <name>    Restrict to one element, e.g. TMAX (repeatable)
  --from <date>       ISO date, inclusive
  --to <date>         ISO date, inclusive
  --limit <n>         Rows to print (default 10; 0 prints all)
  --plan              Show what would be fetched, then stop`;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    cid: "",
    gateway: process.env.IPFS_GATEWAY_URL ?? DEFAULT_GATEWAY,
    stations: [],
    near: null,
    elements: [],
    from: null,
    to: null,
    limit: 10,
    plan: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    // A flag whose value is missing is a typo, not a request for the default:
    // silently falling back would produce a plausible-looking wrong answer.
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${arg} needs a value`);
      }
      i += 1;
      return next;
    };

    switch (arg) {
      case "--gateway": args.gateway = value(); break;
      case "--station": args.stations.push(value()); break;
      case "--element": args.elements.push(value().toUpperCase()); break;
      case "--from": args.from = value(); break;
      case "--to": args.to = value(); break;
      case "--limit": args.limit = Number(value()); break;
      case "--plan": args.plan = true; break;
      case "--near": {
        const parts = value().split(",");
        const lat = Number(parts[0]);
        const lon = Number(parts[1]);
        if (parts.length !== 2 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
          throw new Error("--near expects <lat,lon>, e.g. --near 40.78,-73.97");
        }
        args.near = [lat, lon];
        break;
      }
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
        if (args.cid) throw new Error(`Unexpected argument: ${arg}`);
        args.cid = arg;
    }
  }

  if (!args.cid) throw new Error("A root CID is required");
  if (!Number.isFinite(args.limit) || args.limit < 0) {
    throw new Error("--limit must be a non-negative number");
  }
  return args;
}

const day = (date: Date): string => date.toISOString().slice(0, 10);

function describeStation(station: StationInfo): string {
  const where =
    station.latitude === null || station.longitude === null
      ? "no position"
      : `${station.latitude.toFixed(4)}, ${station.longitude.toFixed(4)}`;
  return `${station.stationId}  ${where}  ${day(station.start)} .. ${day(station.end)}`;
}

function applySelection(dataset: StationDataset, args: Args): StationDataset {
  let selected = dataset;

  if (args.near) {
    const [lat, lon] = args.near;
    selected = selected.nearest(lat, lon);
    console.log(`\nNearest station to ${lat}, ${lon}: ${selected.toQuery().stations?.[0]}`);
  } else if (args.stations.length > 0) {
    selected = selected.select(...args.stations);
  }

  if (args.elements.length > 0) selected = selected.elements(...args.elements);

  if (args.from || args.to) {
    // Either bound alone is meaningful, so the missing side widens to the
    // dataset's own extent rather than forcing the caller to pass both.
    const covered = dataset.stations;
    const earliest = Math.min(...covered.map((s) => s.start.getTime()));
    const latest = Math.max(...covered.map((s) => s.end.getTime()));
    selected = selected.timeRange({
      start: args.from ?? new Date(earliest),
      end: args.to ?? new Date(latest),
    });
  }

  return selected;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const args = parseArgs(argv);
  const client = new DClimateClient({ gatewayUrl: args.gateway, stacServerUrl: null });

  console.log(`Loading station dataset ${args.cid}`);
  console.log(`Gateway: ${args.gateway}\n`);

  const dataset = await client.stations.load({ cid: args.cid });

  console.log(`Stations (${dataset.stations.length}):`);
  for (const station of dataset.stations) console.log(`  ${describeStation(station)}`);

  const selected = applySelection(dataset, args);
  console.log(`\nQuery (wire units): ${JSON.stringify(selected.toQuery())}`);

  const plan = await selected.plan();
  const bytes = plan.fragments.reduce((sum, f) => sum + f.byteLength, 0);
  const rows = plan.fragments.reduce((sum, f) => sum + f.rowCount, 0);
  console.log(
    `Plan: ${plan.fragments.length} fragment(s), ` +
      `${plan.stations.length} station(s), ` +
      `${rows} row(s), ${(bytes / 1024).toFixed(1)} KiB`
  );
  // The number that shows predicate pushdown doing something: fragments ruled
  // out by column statistics are never fetched at all.
  console.log(`      ${plan.stats.fragmentsPruned} fragment(s) pruned by statistics`);

  if (args.plan) return;

  const started = Date.now();
  const element = args.elements.length === 1 ? args.elements[0] : undefined;
  const records = await selected.toRecords(element);
  const elapsed = Date.now() - started;

  console.log(`\n${records.length} record(s) in ${elapsed} ms`);

  const shown = args.limit === 0 ? records : records.slice(0, args.limit);
  for (const record of shown) {
    const value =
      element === undefined
        ? JSON.stringify(record.values)
        : String(record.value ?? "—");
    console.log(`  ${day(record.time as Date)}  ${record.stationId}  ${value}`);
  }
  if (shown.length < records.length) {
    console.log(`  ... ${records.length - shown.length} more (--limit 0 for all)`);
  }

  // Stored in NOAA's own scaling rather than converted, so the archive's exact
  // integers survive. Saying so beats letting a reader assume whole °C.
  if (element) {
    console.log(`\nValues are integers in tenths (TMAX 317 = 31.7 °C).`);
  }
}

main().catch((error: unknown) => {
  console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
