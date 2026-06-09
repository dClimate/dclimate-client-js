import { describe, expect, it } from "vitest";
import {
  listAvailableDatasetsFromStac,
  loadStacCatalog,
  type DatasetCatalog,
  type CatalogCollection,
} from "../src/stac/stac-catalog.js";
import {
  listAvailableDatasetsFromStacServer,
  DEFAULT_STAC_SERVER_URL,
} from "../src/stac/stac-server.js";
import { DEFAULT_IPFS_GATEWAY } from "../src/constants.js";

/**
 * Parity test between the two `listAvailableDatasets` paths:
 *   - IPFS walker:  loadStacCatalog(gateway) → listAvailableDatasetsFromStac(...)
 *   - STAC server:  listAvailableDatasetsFromStacServer(stacUrl)
 *
 * Both should return the same `DatasetCatalog` structure: the same collection
 * ids, the same (collection, dataset) pairs, the same variants under each
 * dataset, with matching organization, title, CID, and extents.
 *
 * Intentional differences:
 *   - `category` is set by the IPFS walker (from `dclimate:collections:<category>`
 *     on the org link) but left undefined by the STAC server path. The STAC API
 *     has no equivalent field. Asserted as a documented gap below.
 *
 * Integration test — hits live `api.stac.dclimate.net` and
 * `ipfs-gateway.dclimate.net`. Skips gracefully if either is unreachable, so
 * an IPFS gateway outage doesn't break the suite.
 *
 * Reads happen via top-level await so `it.skipIf` sees the real values at
 * registration time (vitest evaluates skipIf eagerly).
 */

const STAC_SERVER_URL = process.env.STAC_SERVER_URL ?? DEFAULT_STAC_SERVER_URL;
const IPFS_GATEWAY = process.env.IPFS_GATEWAY ?? DEFAULT_IPFS_GATEWAY;

async function probeReachable(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function indexByCollection(catalog: DatasetCatalog): Map<string, CatalogCollection> {
  const map = new Map<string, CatalogCollection>();
  for (const c of catalog) map.set(c.collection, c);
  return map;
}

// ── Top-level setup: probe both endpoints and (if reachable) fetch both
// catalogs in parallel. Runs once when this file loads.
const [stacReachable, ipfsReachable] = await Promise.all([
  probeReachable(`${STAC_SERVER_URL}/collections`),
  probeReachable(`${IPFS_GATEWAY}/stac`),
]);

let stacCatalog: DatasetCatalog | null = null;
let ipfsCatalog: DatasetCatalog | null = null;

if (stacReachable && ipfsReachable) {
  const [stacRes, ipfsRes] = await Promise.allSettled([
    listAvailableDatasetsFromStacServer(STAC_SERVER_URL),
    (async () => {
      const catalog = await loadStacCatalog(IPFS_GATEWAY);
      return listAvailableDatasetsFromStac(catalog);
    })(),
  ]);
  if (stacRes.status === "fulfilled") stacCatalog = stacRes.value;
  if (ipfsRes.status === "fulfilled") ipfsCatalog = ipfsRes.value;
}

// "Degraded": the IPFS walker is permissive — it logs 504s on per-organization
// fetches but still returns a valid (empty) catalog. That technically counts as
// success but gives us nothing to compare against. Treat empty-while-STAC-is-not
// as degraded and skip rather than passing vacuously over an empty loop.
const ipfsDegraded =
  ipfsCatalog !== null &&
  stacCatalog !== null &&
  ipfsCatalog.length === 0 &&
  stacCatalog.length > 0;
const haveBoth =
  stacCatalog !== null && ipfsCatalog !== null && !ipfsDegraded;

if (ipfsDegraded) {
  console.warn(
    "[parity] IPFS catalog returned 0 collections while STAC server returned " +
      `${stacCatalog!.length} — IPFS gateway can serve the root pointer but not ` +
      "the deeper catalog tree. Skipping parity assertions; re-run when the gateway " +
      "is healthy. (Failing fetches are logged above by the walker itself.)",
  );
}

describe("listAvailableDatasets parity (IPFS walker vs STAC server)", () => {
  it.skipIf(!haveBoth)("produces the same set of collection ids", () => {
    const stacIds = new Set(stacCatalog!.map((c) => c.collection));
    const ipfsIds = new Set(ipfsCatalog!.map((c) => c.collection));
    expect([...stacIds].sort()).toEqual([...ipfsIds].sort());
  });

  it.skipIf(!haveBoth)("agrees on organization for each collection", () => {
    const stacIndex = indexByCollection(stacCatalog!);
    const ipfsIndex = indexByCollection(ipfsCatalog!);
    for (const [id, ipfsColl] of ipfsIndex) {
      const stacColl = stacIndex.get(id);
      if (!stacColl) continue;
      expect(stacColl.organization, `organization for ${id}`).toBe(ipfsColl.organization);
    }
  });

  it.skipIf(!haveBoth)("agrees on title for each collection", () => {
    const stacIndex = indexByCollection(stacCatalog!);
    const ipfsIndex = indexByCollection(ipfsCatalog!);
    for (const [id, ipfsColl] of ipfsIndex) {
      const stacColl = stacIndex.get(id);
      if (!stacColl) continue;
      expect(stacColl.title, `title for ${id}`).toBe(ipfsColl.title);
    }
  });

  it.skipIf(!haveBoth)("produces the same (collection, dataset) pairs", () => {
    const stacPairs = new Set<string>();
    for (const c of stacCatalog!) {
      for (const d of c.datasets) stacPairs.add(`${c.collection}/${d.dataset}`);
    }

    // The IPFS walker can include datasets with zero variants (when an
    // org-link's `dclimate:datasets` lists a slug that has no STAC items
    // yet). The STAC path won't see those. Filter to ≥1-variant datasets
    // before comparing.
    const ipfsPairsWithVariants = new Set<string>();
    for (const c of ipfsCatalog!) {
      for (const d of c.datasets) {
        if (d.variants.length > 0) ipfsPairsWithVariants.add(`${c.collection}/${d.dataset}`);
      }
    }

    expect([...stacPairs].sort()).toEqual([...ipfsPairsWithVariants].sort());
  });

  it.skipIf(!haveBoth)("produces the same (collection, dataset, variant) triples", () => {
    const flatten = (cat: DatasetCatalog) => {
      const triples = new Set<string>();
      for (const c of cat) {
        for (const d of c.datasets) {
          for (const v of d.variants) triples.add(`${c.collection}/${d.dataset}/${v.variant}`);
        }
      }
      return triples;
    };
    expect([...flatten(stacCatalog!)].sort()).toEqual([...flatten(ipfsCatalog!)].sort());
  });

  it.skipIf(!haveBoth)("agrees on CID for each (collection, dataset, variant)", () => {
    const cidOf = (cat: DatasetCatalog) => {
      const map = new Map<string, string | undefined>();
      for (const c of cat) {
        for (const d of c.datasets) {
          for (const v of d.variants) {
            map.set(`${c.collection}/${d.dataset}/${v.variant}`, v.cid);
          }
        }
      }
      return map;
    };

    const stacCids = cidOf(stacCatalog!);
    const ipfsCids = cidOf(ipfsCatalog!);

    const mismatches: Array<{ key: string; stac?: string; ipfs?: string }> = [];
    for (const [key, ipfsCid] of ipfsCids) {
      const stacCid = stacCids.get(key);
      if (stacCid !== ipfsCid) mismatches.push({ key, stac: stacCid, ipfs: ipfsCid });
    }

    // CIDs can transiently disagree if the hourly cron republishes between
    // our two reads. Allow up to 2 to absorb that; anything more is real.
    if (mismatches.length > 2) {
      throw new Error(
        `CID mismatch in ${mismatches.length} variants:\n` +
          mismatches
            .slice(0, 10)
            .map((m) => `  ${m.key}\n    STAC:  ${m.stac}\n    IPFS:  ${m.ipfs}`)
            .join("\n"),
      );
    }
  });

  it.skipIf(!haveBoth)("agrees on spatial bbox for each variant", () => {
    const bboxOf = (cat: DatasetCatalog) => {
      const map = new Map<string, number[] | undefined>();
      for (const c of cat) {
        for (const d of c.datasets) {
          for (const v of d.variants) {
            map.set(`${c.collection}/${d.dataset}/${v.variant}`, v.spatialExtent?.bbox);
          }
        }
      }
      return map;
    };

    const stacBboxes = bboxOf(stacCatalog!);
    const ipfsBboxes = bboxOf(ipfsCatalog!);

    for (const [key, ipfsBbox] of ipfsBboxes) {
      const stacBbox = stacBboxes.get(key);
      expect(stacBbox, `bbox for ${key}`).toEqual(ipfsBbox);
    }
  });

  it.skipIf(!haveBoth)("agrees on temporal extent for each variant", () => {
    // Compare as instants, not strings — STAC API normalizes ISO timestamps
    // to no-millis ("...:00Z") while the IPFS catalog preserves explicit
    // millis ("...:00.000Z"). Same point in time, different serialization.
    const toMs = (s: string | null | undefined): number | null => {
      if (s == null) return null;
      const ms = Date.parse(s);
      return Number.isNaN(ms) ? null : ms;
    };
    const tempOf = (cat: DatasetCatalog) => {
      const map = new Map<string, { start: number | null; end: number | null } | undefined>();
      for (const c of cat) {
        for (const d of c.datasets) {
          for (const v of d.variants) {
            const ext = v.temporalExtent;
            map.set(
              `${c.collection}/${d.dataset}/${v.variant}`,
              ext === undefined ? undefined : { start: toMs(ext.start), end: toMs(ext.end) },
            );
          }
        }
      }
      return map;
    };

    const stacTemp = tempOf(stacCatalog!);
    const ipfsTemp = tempOf(ipfsCatalog!);

    const mismatches: Array<{ key: string; stac: unknown; ipfs: unknown }> = [];
    for (const [key, ipfsExt] of ipfsTemp) {
      const stacExt = stacTemp.get(key);
      if (JSON.stringify(stacExt) !== JSON.stringify(ipfsExt)) {
        mismatches.push({ key, stac: stacExt, ipfs: ipfsExt });
      }
    }

    // Temporal extents can still drift mid-republish on forecast datasets
    // that update frequently. Allow a tiny tolerance for that case.
    if (mismatches.length > 2) {
      throw new Error(
        `Temporal extent mismatch in ${mismatches.length} variants:\n` +
          mismatches
            .slice(0, 10)
            .map(
              (m) =>
                `  ${m.key}\n    STAC:  ${JSON.stringify(m.stac)}\n    IPFS:  ${JSON.stringify(m.ipfs)}`,
            )
            .join("\n"),
      );
    }
  });

  it.skipIf(!haveBoth)("agrees on category for each collection", () => {
    // STAC walker derives category from items' `dclimate:observation` (when
    // unanimous across the collection); IPFS walker reads it from
    // `dclimate:collections:<category>` on the org link. Both should agree.
    const stacIndex = indexByCollection(stacCatalog!);
    const ipfsIndex = indexByCollection(ipfsCatalog!);
    for (const [id, ipfsColl] of ipfsIndex) {
      const stacColl = stacIndex.get(id);
      if (!stacColl) continue;
      expect(stacColl.category, `category for ${id}`).toBe(ipfsColl.category);
    }
  });
});
