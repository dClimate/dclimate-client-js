/**
 * Load and inspect an entity dataset through `client.entities`.
 *
 * The entity counterpart to `inspect-dataset.ts`: that one walks a gridded
 * Zarr dataset, this one walks point observations. Both go through the same
 * client, which is the thing worth seeing -- entity data is not a separate
 * SDK, just a second namespace.
 *
 * Usage:
 *   npx tsx scripts/inspect-entities.ts <cid>
 *   npx tsx scripts/inspect-entities.ts <cid> --entity USW00094728 --element TMAX
 *   npx tsx scripts/inspect-entities.ts <cid> --near 40.78,-73.97 --from 2025-07-01 --to 2025-07-08
 *
 * Options:
 *   --gateway <url>     IPFS HTTP gateway (default http://127.0.0.1:8080)
 *   --entity <id>       Restrict to one entity id (repeatable)
 *   --near <lat,lon>    Use the nearest station that reports every --element
 *   --max-km <n>        Fail if the nearest such station is further than this
 *   --element <name>    Restrict to one element, e.g. TMAX, TMIN, PRCP (repeatable)
 *   --from <date>       ISO date, inclusive
 *   --to <date>         ISO date, inclusive
 *   --limit <n>         Rows to print (default 10; 0 prints all). Prints only --
 *                       the reader has no limit to push down, so every matching
 *                       row is fetched regardless. Narrow the query to fetch less.
 *   --max-rows <n>      Refuse to fetch more than this many rows (0 for no limit)
 *   --max-bytes <n>     Refuse to fetch more than this many bytes (0 for no limit)
 *   --list              List every entity first (walks the whole index)
 *   --plan              Show what would be fetched, then stop
 *
 * Requires an IPFS gateway that can serve the dataset's blocks. A local Kubo
 * daemon (`ipfs daemon`) is the usual answer; any gateway works.
 */

import { DClimateClient } from "../src/index.js";
import type {
  EntityColumn,
  EntityDataset,
  EntityInfo,
} from "@dclimate/tabular/reader";

const DEFAULT_GATEWAY = "http://127.0.0.1:8080";

/**
 * What this script will fetch before refusing.
 *
 * Set where an accident is obvious but a deliberate query is not: a few million
 * rows is far more than anyone reads at a terminal, and comfortably more than
 * any single-station query produces even over a full archive. Both are
 * overridable, because the ceiling exists to catch a mistake rather than to
 * decide what a caller is allowed to want.
 */
const MAX_ROWS = 5_000_000;
const MAX_BYTES = 512 * 1024 * 1024;

interface Args {
  cid: string;
  gateway: string;
  entities: string[];
  near: [number, number] | null;
  elements: string[];
  from: string | null;
  to: string | null;
  limit: number;
  plan: boolean;
  list: boolean;
  maxKm: number | null;
  maxRows: number;
  maxBytes: number;
}

const USAGE = `Usage:
  npx tsx scripts/inspect-entities.ts <cid> [options]

Options:
  --gateway <url>     IPFS HTTP gateway (default ${DEFAULT_GATEWAY})
  --entity <id>       Restrict to one entity id (repeatable)
  --near <lat,lon>    Use the nearest station that reports every --element
  --max-km <n>        Fail if the nearest such station is further than this
  --element <name>    Restrict to one element, e.g. TMAX (repeatable)
  --from <date>       ISO date, inclusive
  --to <date>         ISO date, inclusive
                      (passing only one widens the other to the selected
                       entities' extent; walks the index unless --entity
                       or --near narrowed the selection first)
  --limit <n>         Rows to print (default 10; 0 prints all)
                      (printing only: every matching row is fetched either way)
  --max-rows <n>      Refuse to fetch more than this many rows
                      (default ${MAX_ROWS.toLocaleString()}; 0 for no limit)
  --max-bytes <n>     Refuse to fetch more than this many bytes
                      (default ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MiB; 0 for no limit)
  --list              List every entity first (walks the whole index)
  --plan              Show what would be fetched, then stop`;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    cid: "",
    gateway: process.env.IPFS_GATEWAY_URL ?? DEFAULT_GATEWAY,
    entities: [],
    near: null,
    elements: [],
    from: null,
    to: null,
    limit: 10,
    plan: false,
    list: false,
    maxKm: null,
    maxRows: MAX_ROWS,
    maxBytes: MAX_BYTES,
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
      case "--entity": args.entities.push(value()); break;
      // Kept verbatim. Which casing is correct belongs to the dataset, not to
      // this parser -- GHCND publishes `TMAX`, other feeds publish `tmax` -- so
      // it is resolved against the real column list in `resolveElements` once
      // the dataset is open.
      case "--element": args.elements.push(value()); break;
      case "--from": args.from = value(); break;
      case "--to": args.to = value(); break;
      case "--limit": args.limit = Number(value()); break;
      case "--plan": args.plan = true; break;
      case "--list": args.list = true; break;
      case "--max-km": args.maxKm = Number(value()); break;
      case "--max-rows": args.maxRows = Number(value()); break;
      case "--max-bytes": args.maxBytes = Number(value()); break;
      case "--near": {
        const parts = value().split(",");
        // Empty components are rejected before conversion: `Number("")` is 0,
        // so `--near ,-73.97` would otherwise silently query the equator.
        if (parts.length !== 2 || parts.some((part) => part.trim() === "")) {
          throw new Error("--near expects <lat,lon>, e.g. --near 40.78,-73.97");
        }
        const lat = Number(parts[0]);
        const lon = Number(parts[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
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
  if (args.maxKm !== null && (!Number.isFinite(args.maxKm) || args.maxKm <= 0)) {
    throw new Error("--max-km must be a positive number");
  }
  // 0 disables the ceiling rather than setting it to nothing, so there is a way
  // to say "yes, really, fetch it all" that does not require guessing a number
  // larger than the dataset.
  for (const [flag, size] of [
    ["--max-rows", args.maxRows],
    ["--max-bytes", args.maxBytes],
  ] as const) {
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`${flag} must be a non-negative number (0 for no limit)`);
    }
  }
  if (args.maxKm !== null && !args.near) {
    throw new Error("--max-km only applies with --near");
  }
  // Both name an entity set, and honouring one means ignoring the other. Since
  // the output does not restate which ids were queried, silently dropping
  // --entity would print a confident answer for an entity nobody asked about.
  if (args.near && args.entities.length > 0) {
    throw new Error(
      "--near and --entity both choose entities; pass one or the other"
    );
  }
  return args;
}

const day = (date: Date): string => date.toISOString().slice(0, 10);

function describeEntity(entity: EntityInfo): string {
  const where =
    entity.latitude === null || entity.longitude === null
      ? "no position"
      : `${entity.latitude.toFixed(4)}, ${entity.longitude.toFixed(4)}`;
  return `${entity.entityId}  ${where}  ${day(entity.start)} .. ${day(entity.end)}`;
}

/**
 * Match each `--element` to a column the dataset actually publishes, ignoring
 * case when — and only when — that is unambiguous.
 *
 * Column casing belongs to the publisher, and publishers disagree: GHCND emits
 * `TMAX`, other feeds emit `tmax`. Forcing either one here made the flag unusable
 * against half of them, so the name is resolved against the real column list
 * instead of guessed at parse time.
 *
 * An exact match always wins outright, and a case-insensitive match is accepted
 * only if exactly one column matches. That second rule is not pedantry: NDBC
 * headers carry `MM` (month) and `mm` (minute) as distinct columns in the same
 * table, so a blanket casefold would silently resolve to whichever came first
 * and return the wrong data. Ambiguity is reported rather than guessed.
 *
 * Done here rather than in `@dclimate/tabular` deliberately — the reader's exact
 * matching is what makes `MM`/`mm` addressable at all, and this convenience
 * belongs to a human typing at a terminal, not to the library's query semantics.
 */
/**
 * Render a station's columns with the units the dataset states.
 *
 * A column that states no unit prints bare rather than as `name ()` -- the
 * dataset genuinely does not say, and inventing a guess here is what the old
 * hardcoded "integers in tenths" line did wrong.
 */
function formatColumns(columns: readonly EntityColumn[]): string {
  return columns
    .map((column) =>
      column.units === null ? column.name : `${column.name} (${column.units})`
    )
    .join(", ");
}

function resolveElements(
  requested: readonly string[],
  available: readonly string[]
): string[] {
  return requested.map((element) => {
    if (available.includes(element)) return element;

    const folded = available.filter(
      (column) => column.toLowerCase() === element.toLowerCase()
    );
    if (folded.length === 1) return folded[0]!;
    if (folded.length > 1) {
      throw new Error(
        `--element ${element} is ambiguous: this dataset publishes ` +
          `${folded.join(" and ")}, which differ only by case. ` +
          `Pass the exact name.`
      );
    }
    throw new Error(
      `Unknown element: ${element}. This dataset publishes: ${available.join(", ")}`
    );
  });
}

async function applySelection(
  dataset: EntityDataset,
  args: Args
): Promise<EntityDataset> {
  let selected = dataset;

  if (args.near) {
    const [lat, lon] = args.near;
    // Resolved rather than just recorded, so this is the one async selection --
    // and the only place the distance is available to print. A station 3,000 km
    // away is a usable answer or a useless one depending entirely on that number,
    // and printing the id alone hides the difference.
    // Asking for an element over a date range means asking for a station that
    // reported it *then*. Without this, a station whose TMAX stopped in 1987
    // satisfies a 2024 query and answers it entirely in nulls.
    const within =
      args.elements.length > 0 && (args.from || args.to)
        ? { start: args.from ?? "0001-01-01", end: args.to ?? "9999-12-31" }
        : null;
    const found = await selected.findNearestEntity(lat, lon, {
      // Asking for an element means asking for a station that reports it. The
      // nearest station that has never recorded TMAX is not a TMAX answer.
      ...(args.elements.length > 0 ? { requireColumns: args.elements } : {}),
      ...(args.maxKm === null ? {} : { maxKm: args.maxKm }),
      ...(within === null ? {} : { withinRange: within }),
    });
    selected = selected.select(found.entityId);
    const columns = await dataset.columnsFor(found.entityId);
    console.log(
      `\nNearest station to ${lat}, ${lon}: ${found.entityId} (${found.km.toFixed(1)} km)`
    );
    console.log(
      `  reports: ${formatColumns(columns)}${within === null ? "" : "  (ever)"}`
    );
    if (found.km > 500) {
      console.log(
        `  NOTE: ${found.km.toFixed(0)} km away -- this dataset may not cover that region.`
      );
    }
  } else if (args.entities.length > 0) {
    selected = selected.select(...args.entities);
  }

  if (args.elements.length > 0) selected = selected.elements(...args.elements);

  if (args.from || args.to) {
    // Either bound alone is meaningful, so the missing side widens to the
    // covered extent rather than forcing the caller to pass both. A query that
    // supplies both bounds never reads coverage at all.
    let start: Date | string = args.from ?? "";
    let end: Date | string = args.to ?? "";
    if (!args.from || !args.to) {
      // Scoped to whatever --entity/--near already picked, for both reasons:
      // widening from every entity would stretch the range to one no selected
      // entity covers -- a station retired in 1987 pulling `start` back decades
      // before the station actually queried -- and `infoFor` resolves each named
      // entity with a single lookup instead of the index walk `listEntities()`
      // costs. Only an unfiltered query still pays for the walk, which it must,
      // since it really is asking about every entity.
      const chosen = selected.toQuery().entities ?? [];
      const covered =
        chosen.length === 0
          ? await selected.listEntities()
          : await Promise.all(
              chosen.map((entityId) => selected.infoFor(entityId))
            );
      // Folded rather than spread into Math.min/Math.max: at GHCND's station
      // count the spread exceeds V8's argument limit and throws.
      let earliest = Infinity;
      let latest = -Infinity;
      for (const entity of covered) {
        earliest = Math.min(earliest, entity.start.getTime());
        latest = Math.max(latest, entity.end.getTime());
      }
      if (!Number.isFinite(earliest) || !Number.isFinite(latest)) {
        throw new Error(
          "Dataset reports no entities, so an open-ended --from/--to cannot be widened."
        );
      }
      if (!args.from) start = new Date(earliest);
      if (!args.to) end = new Date(latest);
    }
    selected = selected.timeRange({ start, end });
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

  console.log(`Loading entity dataset ${args.cid}`);
  console.log(`Gateway: ${args.gateway}\n`);

  const dataset = await client.entities.load({ cid: args.cid });

  // Opt-in, because listing walks the whole entity index -- a block per entity,
  // ~136k reads on GHCND -- and every other path here needs at most a few of them.
  if (args.list) {
    const entities = await dataset.listEntities();
    console.log(`Entities (${entities.length}):`);
    for (const entity of entities) console.log(`  ${describeEntity(entity)}`);
  }

  // Resolved before any selection, because `--element` feeds `requireColumns`
  // inside `applySelection` as well as the projection below.
  //
  // Resolved against the dataset's own vocabulary -- every column its schema
  // defines -- rather than one station's `columnsFor` report. This used to pick
  // a reference station (the first `--entity`, or the *unfiltered* nearest) and
  // validate against what that one station had reported, which rejected
  // elements the dataset could answer: the station nearest a point is routinely
  // one that has never recorded TMAX, and `--near`'s own `requireColumns`
  // search exists precisely to skip past it. The vocabulary also carries each
  // column's stated unit, which the footer below reads. Costs nothing: it is
  // read off the schema the load already fetched.
  const vocabulary = dataset.columns();
  if (args.elements.length > 0) {
    args.elements = resolveElements(
      args.elements,
      vocabulary.map((column) => column.name)
    );
  }

  const selected = await applySelection(dataset, args);
  console.log(`\nQuery (wire units): ${JSON.stringify(selected.toQuery())}`);

  const plan = await selected.plan();
  const bytes = plan.fragments.reduce((sum, f) => sum + f.byteLength, 0);
  const rows = plan.fragments.reduce((sum, f) => sum + f.rowCount, 0);
  console.log(
    `Plan: ${plan.fragments.length} fragment(s), ` +
      `${plan.entities.length} entity(s), ` +
      `${rows} row(s), ${(bytes / 1024).toFixed(1)} KiB`
  );
  // The number that shows predicate pushdown doing something: fragments ruled
  // out by column statistics are never fetched at all.
  console.log(`      ${plan.stats.fragmentsPruned} fragment(s) pruned by statistics`);

  if (args.plan) return;

  // `--limit` slices after the fact, because `toRecords()` has no limit to push
  // down: the reader materializes every matching row before anything here can
  // discard one. On a bare `<cid>` that means the default ten-row print would
  // pull the whole dataset -- GHCND is ~136k stations of daily observations --
  // and die on memory long before printing.
  //
  // The plan above already priced it, from index metadata rather than a fetch,
  // so the check costs nothing extra. Refusing beats truncating silently: the
  // limits exist to stop an accident, and a run that quietly returned the first
  // slice of a dataset the caller never meant to ask for would look like a
  // complete answer.
  const overRows = args.maxRows > 0 && rows > args.maxRows;
  const overBytes = args.maxBytes > 0 && bytes > args.maxBytes;
  if (overRows || overBytes) {
    const measured = overRows
      ? `${rows.toLocaleString()} rows`
      : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
    const ceiling = overRows
      ? `${args.maxRows.toLocaleString()} rows`
      : `${(args.maxBytes / 1024 / 1024).toFixed(0)} MiB`;
    throw new Error(
      `This query reads ${measured}, over the ${ceiling} this script will fetch.\n` +
        `  '--limit' only trims what is printed, so it cannot make this smaller.\n` +
        `  Narrow it instead: --entity or --near picks one station, --from/--to\n` +
        `  a date range, --element one variable. Use --plan to price a query\n` +
        `  without running it, or --max-rows / --max-bytes to raise the ceiling.`
    );
  }

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
    console.log(`  ${day(record.time as Date)}  ${record.entityId}  ${value}`);
  }
  if (shown.length < records.length) {
    console.log(`  ... ${records.length - shown.length} more (--limit 0 for all)`);
  }

  // Stored in the source's own scaling rather than converted, so its exact
  // values survive. Read the unit off the dataset rather than asserting one:
  // this line used to hardcode GHCND's tenths, which was simply false for NDBC,
  // where the same column type holds real floats in m/s and hPa.
  if (element !== undefined) {
    const stated = vocabulary.find(
      (column) => column.name === element
    )?.units;
    console.log(
      stated === undefined || stated === null
        ? `\nValues are stored exactly as the source published them; this dataset states no unit for ${element}.`
        : `\nValues are in ${stated}, stored exactly as the source published them.`
    );
  }
}

main().catch((error: unknown) => {
  console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
