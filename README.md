# dClimate Client JS

Foundation for a JavaScript/TypeScript client that loads dClimate Zarr datasets from IPFS using [`jaxray`](https://github.com/dClimate/jaxray).

The goal is to mirror the functionality of the Python `dclimate-zarr-client` package while staying within the JavaScript ecosystem and avoiding any Ethereum/Web3 dependencies. This initial pass focuses on resolving dataset CIDs, opening sharded Zarr stores with jaxray, and exposing a small geotemporal helper API for downstream applications.

## Features

- **Dataset loader** with curated catalog that resolves datasets from HTTP endpoints or direct CIDs
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
const dataset = await client.loadDataset({
  request: {
    collection: "aifs",
    dataset: "temperature",
    variant: "ensemble"
  }
});

// Narrow to a single location (nearest neighbour) and time range.
const point = await dataset.point(40.75, -73.99);
const slice = await point.timeRange({
  start: "2023-01-01T00:00:00Z",
  end: "2023-01-07T00:00:00Z",
});

console.log(await slice.toRecords("precipitation"));
```

### Selecting while loading

```typescript
const subset = await client.selectDataset({
  request: {
    collection: "aifs",
    dataset: "temperature",
    variant: "ensemble"
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
    returnJaxrayDataset: false                  // Optional: return raw jaxray Dataset
  }
});
```

- **Dataset catalog** – includes both HTTP-backed dataset endpoints and direct CID entries. Use `listAvailableDatasets()` to explore all available datasets.
- **Gateway** – set `gatewayUrl` on the client constructor or per-call in `loadDataset` options.
- **Direct CID access** – supply `cid` in options to skip catalog resolution and load directly from IPFS.

## API Reference

### DClimateClient

- `constructor(options?: ClientOptions)` - Create a new client instance
- `loadDataset({ request, options })` - Load a dataset from the catalog
- `selectDataset({ request, selection, options })` - Load and apply selections in one call
- `listAvailableDatasets()` - Get the full dataset catalog

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
