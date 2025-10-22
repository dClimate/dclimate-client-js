# dClimate Client JS

Foundation for a JavaScript/TypeScript client that loads dClimate Zarr datasets from IPFS using [`jaxray`](https://github.com/dClimate/jaxray).

The goal is to mirror the functionality of the Python `dclimate-zarr-client` package while staying within the JavaScript ecosystem and avoiding any Ethereum/Web3 dependencies. This initial pass focuses on resolving dataset CIDs, opening sharded Zarr stores with jaxray, and exposing a small geotemporal helper API for downstream applications.

## Features

- Dataset loader backed by a curated dataset-to-endpoint map that fetches the latest CID on demand.
- Thin IPFS loader powered by `jaxray`'s `ShardedStore` implementation.
- `GeoTemporalDataset` wrapper with convenience helpers (`point`, `timeRange`, chained selections).
- No blockchain/Web3 code – all resolution happens through static/HTTP sources.

## Getting Started

```bash
# from dclimate-client-js/
npm install
npm run build
```

If this package lives alongside `jaxray`, the relative dependency (`"jaxray": "file:../jaxray"`) will link automatically.

## Usage

```typescript
import { DClimateClient } from "dclimate-client-js";

const client = new DClimateClient();

// Load a dataset by slug. The resolver tries several catalog keys automatically.
const dataset = await client.loadDataset({ dataset: "cpc-precip-conus" });

// Narrow to a single location (nearest neighbour) and time range.
const point = await dataset.point(40.75, -73.99);
const slice = await point.timeRange({
  start: "2023-01-01T00:00:00Z",
  end: "2023-01-07T00:00:00Z",
});

console.log(slice.toRecords("precipitation"));
```

### Selecting while loading

```typescript
const subset = await client.selectDataset(
  { dataset: "era5-2m_temperature", collection: "era5", variant: "finalized" },
  {
    point: { latitude: 40.75, longitude: -73.99 },
    timeRange: {
      start: new Date("2023-02-01T00:00:00Z"),
      end: new Date("2023-02-05T00:00:00Z"),
    },
  }
);
```

## Configuration

- **Dataset map** – only datasets listed in the built-in map are supported. Use `listAvailableDatasets()` to inspect the keys.
- **Gateway** – set `gatewayUrl` on the client or per call inside `loadDataset`.
- **Direct CID access** – supply `cid` in `LoadDatasetOptions` to skip catalog resolution entirely.

## Roadmap

- Broader parity with the Python client (multi-geometry selections, aggregation helpers, S3 support).
- Stronger caching controls and persistent catalog storage.
- Expanded test coverage plus integration fixtures.
