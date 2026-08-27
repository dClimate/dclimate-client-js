# dClimate Client JS

Foundation for a JavaScript/TypeScript client that loads dClimate Zarr datasets from IPFS using [`jaxray`](https://github.com/dClimate/jaxray).

The goal is to mirror the functionality of the Python `dclimate-zarr-client` package while staying within the JavaScript ecosystem and avoiding any Ethereum/Web3 dependencies. This initial pass focuses on resolving dataset CIDs, opening sharded Zarr stores with jaxray, and exposing a small geotemporal helper API for downstream applications.

## Features

- **Dataset loader** with curated catalog that resolves datasets from HTTP endpoints or direct CIDs
- **Smart variant concatenation** – automatically merges finalized and non-finalized data for complete time series
- **IPFS integration** powered by `@dclimate/jaxray` for efficient Zarr store access
- **GeoTemporalDataset** wrapper with rich selection capabilities:
  - Single point selection with nearest-neighbor matching
  - Multiple points selection
  - Circular region selection (radius-based)
  - Rectangular bounding box selection
  - Time range filtering
  - Chained selections for complex queries
- **No blockchain dependencies** – all resolution through HTTP APIs and IPFS
- **TypeScript support** with full type definitions
- **Dual build targets** for Node.js and browser environments
- **OpenTelemetry hooks** for IPFS/Zarr open latency, status, and gateway attribution

## Installation

```bash
npm install @dclimate/dclimate-client-js
```

## Getting Started

### For contributors

```bash
# Clone and build from source
git clone https://github.com/dClimate/dclimate-client-js.git
cd dclimate-client-js
npm install
npm run build
```

## Usage

```typescript
import { DClimateClient } from "@dclimate/dclimate-client-js";

const client = new DClimateClient();

// Load a dataset by collection, dataset name, and variant.
// Returns a tuple: [dataset, metadata]
const [dataset, metadata] = await client.loadDataset({
  request: {
    collection: "aifs",
    dataset: "temperature",
    variant: "ensemble"
  }
});

// Check metadata about what was loaded
console.log(`Loaded: ${metadata.path}`);
console.log(`CID: ${metadata.cid}`);
console.log(`Timestamp: ${metadata.timestamp}`); // Unix timestamp in milliseconds
console.log(`Source: ${metadata.source}`); // 'catalog' or 'direct_cid'
console.log(`URL: ${metadata.url}`); // URL if fetched from endpoint

// Narrow to a single location (nearest neighbour) and time range.
const point = await dataset.point(40.75, -73.99);
const slice = await point.timeRange({
  start: "2023-01-01T00:00:00Z",
  end: "2023-01-07T00:00:00Z",
});

console.log(await slice.toRecords("precipitation"));
```

### Entity data usage

Gridded Zarr datasets come from `loadDataset`. Point-observation **entity**
datasets (GHCND and friends) live under `client.entities`, and read the same way:
degrees, ISO timestamps, chained selections.

"Entity" is the format's word for whatever a row belongs to — a weather station
in GHCND, a buoy in NDBC.

```typescript
// Addressed through the STAC catalog, like `loadDataset`. Separate from it
// because the two return different types: `EntityDataset` has no `point()`, and
// its `nearest()` is async and can find nothing.
const [entities, metadata] = await client.loadEntities({
  request: { collection: "noaa_ghcnd", dataset: "station_observations" },
});

// `metadata.commitId` identifies the snapshot this read ran against, so the
// same one can be re-resolved later instead of whatever is newest then.

// To pin an exact snapshot, or to read a dataset that is not in the catalog,
// `client.entities.load({ cid })` remains available. It takes `columnKey`,
// which maps schema field names to published column names -- a property of the
// dataset's profile, not the stored blocks: GHCND stores `tmax`, publishes
// `TMAX`. `loadEntities` defaults it to upper case, which is what this catalog
// publishes; the direct form defaults to the schema's own names.

// Every entity, with position and coverage window.
for (const e of await entities.listEntities()) {
  console.log(e.entityId, e.latitude, e.longitude, e.start, e.end);
}

// Windows the dataset states it does *not* know, as distinct from windows where
// nothing happened. `[start, end]` is only an outer envelope: a station can go
// dark in the middle of it, and without this a missing row and an unfetched one
// look identical. Carried on every info row at no extra cost.
for (const gap of (await entities.infoFor("USW00094728")).gaps) {
  console.log(gap.beginUs, gap.endUs, gap.reason); // e.g. "awdb: HTTP 500"
}

// Every column the dataset defines, with its stated unit.
console.log(entities.columns()); // [{ name: "TMAX", units: "degC_tenths" }, ...]

// Entities within 50 km of a point, over one week.
const records = await entities
  .circle(40.75, -73.99, 50)
  .timeRange({ start: "2023-01-01", end: "2023-01-07" })
  .toRecords("TMAX");
```

Selections return new instances, so a partial selection can be branched:

```typescript
const week = entities.timeRange({ start: "2023-01-01", end: "2023-01-07" });
const nyc = await week.select("USW00094728").rows();
const lax = await week.select("USW00023174").rows();
```

Two things differ from `GeoTemporalDataset`, because the data model differs:

- **`nearest(lat, lon, { maxKm })` instead of `point()`.** A grid always has a
  cell under any coordinate; stations are irregular, so the nearest one may be
  far away. Pass `maxKm` to make that a hard bound rather than a surprise. Use
  `findNearestEntity(lat, lon)` when you need the distance itself — it returns
  `{ entityId, km, latitude, longitude }` instead of a chainable dataset.
- **`where(...)` has no gridded counterpart.** Row-level predicates are pushed
  down to fragment statistics, so most fragments are skipped without being read:

```typescript
// `nearest` reads the entity index to find the match, so it is async --
// unlike the synchronous selections above, it has to be awaited before the
// chain continues.
const hotDays = await (await entities.nearest(29.98, -95.36))
  .timeRange({ start: "2025-01-01", end: "2025-12-31" })
  .where({ element: "TMAX", op: "gt", value: 350 }) // tenths of °C, so 35 °C
  .rows();
```

A third difference is worth stating on its own, because it changes how a result
should be read:

- **An empty result may mean "unknown", not "nothing happened".** `plan()`
  reports the known gaps overlapping the range you asked for, so a query that
  lands in a hole says so instead of returning a plausible, silent zero rows.
  Only overlapping gaps are listed — asking about 2024 stays quiet about a hole
  in 1996.

```typescript
const range = entities
  .select("2001:NE:SCAN")
  .timeRange({ start: "1996-06-01", end: "1996-07-01" });

const { gaps } = await range.plan();
for (const { entityId, gaps: windows } of gaps) {
  for (const g of windows) {
    console.warn(`${entityId}: no data for ${g.beginUs}..${g.endUs} (${g.reason})`);
  }
}
const rows = await range.rows(); // may be empty *because* of the gap above
```

Reads go over the IPFS HTTP gateway, so no local daemon is required and the same
code runs in a browser. Datasets resolve through the STAC catalog via
`loadEntities`; `entities.load({ cid })` stays available for pinning an exact
snapshot.

### Dataset version history

For datasets that advertise version history in STAC, the client follows the
item's `dclimate:versions_api` URL. STAC therefore selects Hydrogen, Tritium,
or a future version service without a client-side dataset routing table.

```typescript
const versions = await client.listDatasetVersions({
  collection: "noaa_aigfs",
  dataset: "wind_u_forecast",
  variant: "operational",
  filters: {
    anchored: true,
    isCitable: true,
    versionLabel: "2026-08",
  },
});

for (const release of versions.versions) {
  console.log(release.versionLabel, release.cid);
}

const exactVersion = await client.getDatasetVersion({
  collection: "noaa_aigfs",
  dataset: "wind_u_forecast",
  variant: "operational",
  commitId: "commit-id",
});

console.log(exactVersion.cid);
```

The low-level `listVersionsFromUrl`, `getExactVersionFromUrl`, and
`getCitationFromUrl` helpers are also exported for applications that already
have the complete URLs. Items backed by hard-coded CIDs may not advertise a
version-history service.

### Multiresolution datasets

Pyramidal datasets require an explicit resolution (recommended) or raw Zarr
group. The client reports the available resolutions instead of silently
choosing between different precision, chunking, and fetching strategies.

```typescript
const [data, metadata] = await client.loadDataset({
  request: {
    collection: "copernicus_clms",
    dataset: "fpar",
    resolution: "2km",
  },
});

console.log(metadata.resolution, metadata.zarrGroup);
```

FPAR advertises `500m` → group `"0"`, `2km` → group `"1"`, and `8km` →
group `"2"`. Change `request.resolution` to select any of those levels. A raw
`options.zarrGroup` is supported for storage-aware callers, but must not be
combined with `request.resolution`.

During migration, STAC may also contain a legacy `assets.data` alias for the
500 m asset. The client ignores it when building the three choices, and it is
neither a fourth resolution nor a default. Consumers relying on `assets.data`
or implicit group `"0"` should migrate before the alias is removed in a future
breaking release.

Direct CID requests have no STAC resolution mapping and must use
`options.zarrGroup` when the store contains multiple groups; a human-readable
resolution is rejected. STAC's internal `metadataGroup` controls only catalog
metadata extraction and never selects a client resolution.

### Siren REST API usage

Use Siren methods by configuring `siren` in the client options.

```typescript
import { DClimateClient } from "@dclimate/dclimate-client-js";

const client = new DClimateClient({
  siren: {
    auth: { type: "apiKey" }, // reads SIREN_API_KEY + SIREN_ACCOUNT_ID from env when omitted
  },
});

const metrics = await client.siren.listMetrics(); // returns string[] of available metric names
const regions = await client.siren.listRegions();
const data = await client.siren.getMetricData({
  regionId: regions[0].id,
  metric: metrics[0],
  startDate: "2025-01-01",
  endDate: "2025-01-31",
});
```

Siren lives under the `client.siren` namespace, kept separate from the core
dataset API. Accessing it without configuring `siren` throws
`SirenNotConfiguredError`. You can also use the standalone `SirenClient`
directly if you don't need the dataset client at all.

Credentials can be passed explicitly instead of via environment variables:

```typescript
const client = new DClimateClient({
  siren: {
    auth: { type: "apiKey", apiKey: "sk-...", accountId: "acc-..." },
    // baseUrl: "https://production-api-siren.dclimate.net/api", // override if needed
  },
});
```

### Automatic variant concatenation

For datasets with multiple variants (e.g., ERA5 with "finalized" and "non-finalized" data), the client automatically merges them into a complete time series when no specific variant is requested:

```typescript
// Automatically loads and concatenates finalized + non-finalized variants
const [dataset, metadata] = await client.loadDataset({
  request: {
    organization: "ecmwf",
    collection: "era5",
    dataset: "temperature_2m"
    // No variant specified - triggers auto-concatenation if possible
  }
});

// Returns a dataset with:
// - Finalized data (high-quality, historical)
// - Non-finalized data (recent, after finalized ends)
// - No duplicate timestamps

console.log(metadata.concatenatedVariants);
// Output: ["finalized", "non-finalized"]
console.log(dataset.info.concatenatedVariants);
// Output: ["finalized", "non-finalized"]
```

The concatenation:
- **Prioritizes finalized data** – Higher quality historical data comes first
- **Avoids duplicates** – Non-finalized data is automatically sliced to start after the last finalized timestamp
- **Works with any variants** – Supports finalized/non-finalized, analysis/reanalysis, or any custom variant combinations
- **Configurable** – Controlled by `concatPriority` in the dataset catalog

To load a specific variant without concatenation:

```typescript
// Load only finalized data
const [finalized, metadata] = await client.loadDataset({
  request: {
    organization: "ecmwf",
    collection: "era5",
    dataset: "temperature_2m",
    variant: "finalized"  // Specific variant - no concatenation
  }
});

```

### ERA5 land datasets

ERA5 and ERA5-Land datasets are separate dataset IDs within the ECMWF ERA5 collection. Use `listAvailableDatasets()` to inspect the exact names before loading.

```typescript
// Non-land ERA5 total precipitation
const [precipitation, precipitationMetadata] = await client.loadDataset({
  request: {
    organization: "ecmwf",
    collection: "era5",
    dataset: "precipitation_total",
    variant: "finalized"
  }
});

// ERA5-Land total precipitation
const [landPrecipitation, landPrecipitationMetadata] = await client.loadDataset({
  request: {
    organization: "ecmwf",
    collection: "era5",
    dataset: "precipitation_total_land",
    variant: "finalized"
  }
});

// ERA5-Land wind datasets follow the same pattern:
// dataset: "wind_u_10m_land" or dataset: "wind_v_10m_land"
```

### Selecting while loading

```typescript
const [subset, metadata] = await client.selectDataset({
  request: {
    organization: "ecmwf",
    collection: "era5",
    dataset: "temperature_2m",
    variant: "finalized"
  },
  selection: {
    point: { latitude: 40.75, longitude: -73.99 },
    timeRange: {
      start: new Date("2023-02-01T00:00:00Z"),
      end: new Date("2023-02-05T00:00:00Z"),
    },
  }
});
```

Use `bounds` for rectangular lon/lat selections. Tuple bounds are
`[west, south, east, north]`.

```typescript
const [westernEurope, metadata] = await client.selectDataset({
  request: {
    organization: "ecmwf",
    collection: "era5",
    dataset: "temperature_2m",
    variant: "finalized"
  },
  selection: {
    bounds: [-12, 35, 16, 60],
    timeRange: {
      start: "2024-01-01T00:00:00Z",
      end: "2024-01-07T23:00:00Z",
    },
  }
});
```

### Geographic shape selections

The client supports advanced geographic selections beyond single points:

#### Multiple points

```typescript
// Select data at multiple specific coordinates
const pointsData = await dataset.points(
  [40.75, 41.0, 42.5],  // latitudes
  [-73.99, -74.5, -75.0], // longitudes
  {
    epsgCrs: 4326,
    snapToGrid: true,
    tolerance: 0.1
  }
);
```

#### Circle selection

```typescript
// Select all data within a circular region
const circleData = await dataset.circle(
  40.75,   // center latitude
  -73.99,  // center longitude
  50,      // radius in kilometers
  {
    latitudeKey: "latitude",
    longitudeKey: "longitude"
  }
);
```

#### Rectangle selection

```typescript
// Select all data within a rectangular bounding box
const rectangleData = await dataset.rectangle(
  40.0,    // min latitude (south)
  -75.0,   // min longitude (west)
  41.0,    // max latitude (north)
  -73.0,   // max longitude (east)
  {
    latitudeKey: "latitude",
    longitudeKey: "longitude"
  }
);
```

### Discovering available datasets

```typescript
const catalog = client.listAvailableDatasets();

catalog.forEach(({ collection, datasets }) => {
  console.log(collection);
  datasets.forEach(({ dataset, variants }) => {
    variants.forEach(({ variant, cid, url }) => {
      console.log(`  ${dataset} (${variant})`);
      if (cid) console.log(`    CID: ${cid}`);
      if (url) console.log(`    URL: ${url}`);
    });
  });
});
```

### Resolving a CID directly

Use the public STAC resolver when you need the selected CID and variant without loading the dataset. The API is natively asynchronous and uses the platform's pooled `fetch` implementation.

```typescript
import { resolveCidFromStacServer } from "@dclimate/dclimate-client-js";

const resolved = await resolveCidFromStacServer(
  "ecmwf_aifs",
  "temperature_forecast",
  "single"
);

console.log(resolved.cid, resolved.variant);
```

## Configuration

### Client options

```typescript
const client = new DClimateClient({
  gatewayUrl: "https://custom-ipfs-gateway.com" // Optional, defaults to public gateway
});
```

### Dataset loading options

```typescript
const dataset = await client.loadDataset({
  request: {
    collection: "aifs",
    dataset: "temperature",
    variant: "ensemble"
  },
  options: {
    gatewayUrl: "https://custom-gateway.com",  // Optional: override client gateway
    cid: "bafyr4ia...",                         // Optional: load directly from CID
    zarrGroup: "0",                             // Optional: open a specific Zarr group
    shardReadMode: "sparse",                    // Optional: decode only requested shard entries
    returnJaxrayDataset: false,                 // Optional: return raw jaxray Dataset
    autoConcatenate: true                       // Optional: auto-merge variants (default: false)
  }
});
```

- **Dataset catalog** – includes both HTTP-backed dataset endpoints and direct CID entries. Use `listAvailableDatasets()` to explore all available datasets.
- **Gateway** – set `gatewayUrl` on the client constructor or per-call in `loadDataset` options.
- **Direct CID access** – supply `cid` in options to skip catalog resolution and load directly from IPFS.
- **Grouped Zarr stores** – set `zarrGroup` when loading grouped sharded Zarr v2 stores such as pyramid level `"0"`.
- **Sparse shard decoding** – read-only loads use `shardReadMode: "sparse"` by default to decode only requested shard entries. Set `shardReadMode: "full"` for dense reads that should reuse a fully decoded shard cache.

### OpenTelemetry

The client emits OpenTelemetry API spans and metrics around IPFS/Zarr dataset opens. This is passive by default: no telemetry is exported unless the application configures an OpenTelemetry SDK/provider.

Emitted names include:

- Span `dclimate_client.ipfs.load_zarr_dataset`
- Span `dclimate_client.ipfs.open_jaxray_store`
- Counter `dclimate_client.ipfs.dataset_open.requests`
- Histogram `dclimate_client.ipfs.dataset_open.duration`
- Counter `dclimate_client.ipfs.store_open.requests`
- Histogram `dclimate_client.ipfs.store_open.duration`

Metric attributes include the gateway URL, store type, and status. The dataset CID is only attached to the trace span to avoid high-cardinality metric labels.

## API Reference

### DClimateClient

- `constructor(options?: ClientOptions)` - Create a new client instance
- `loadDataset({ request, options })` - Load a dataset from the catalog
- `selectDataset({ request, selection, options })` - Load and apply selections in one call
- `listAvailableDatasets()` - Get the full dataset catalog
- `siren` - Namespaced Siren REST API client (getter; throws `SirenNotConfiguredError` unless `siren` is configured)

### STAC utilities

- `resolveCidFromStacServer(collection, dataset, variant?, serverUrl?)` - Resolve a CID and selected variant without loading the dataset
- `resolveDatasetCidFromStacServer(collection, dataset, variant?, serverUrl?)` - Resolve only the CID string
- `listAvailableDatasetsFromStacServer(serverUrl?)` - List collections, datasets, and variants directly from the paginated STAC API

### SirenClient (via `client.siren` or standalone)

- `getMetricData(query)` - Fetch metric data for a region over a date range
- `listRegions()` - List available regions (auto-paginates)
- `listMetrics()` - List available metric names

### GeoTemporalDataset

- `point(latitude, longitude, options?)` - Select nearest point
- `points(latitudes, longitudes, options?)` - Select multiple points
- `circle(centerLat, centerLon, radiusKm, options?)` - Select circular region
- `rectangle(minLat, minLon, maxLat, maxLon, options?)` - Select rectangular region
- `timeRange(range, dimension?)` - Filter by time range
- `select(options)` - Apply combined point and time selections
- `toRecords(varName, options?)` - Convert to array of records
- `getVariable(name)` - Access a specific variable
- `variables` - List all data variables
- `coords` - Access coordinate arrays
- `info` - Get dataset metadata

## Roadmap

- Aggregation helpers (spatial and temporal statistics)
- S3 storage backend support
- Advanced caching controls and persistent catalog storage
- Additional coordinate reference system (CRS) transformations
- Expanded test coverage and integration fixtures
