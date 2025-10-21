import staticCatalog from "./static-catalog.json" assert { type: "json" };
import {
  CatalogUnavailableError,
  DatasetNotFoundError,
} from "../errors.js";
import {
  CatalogMap,
  CatalogResolverOptions,
  DatasetRequest,
} from "../types.js";
import {
  DEFAULT_CATALOG_ENDPOINT,
} from "../constants.js";
import { buildCatalogCandidates } from "../utils.js";

type Fetcher = typeof fetch;

export interface ResolveOptions {
  path?: string;
  variant?: string;
  signal?: AbortSignal;
}

function normalizeCatalog(source: CatalogMap | null | undefined): CatalogMap {
  const normalized: CatalogMap = {};
  if (!source) {
    return normalized;
  }
  for (const [rawKey, value] of Object.entries(source)) {
    normalized[rawKey.trim().toLowerCase()] = value;
  }
  return normalized;
}

export class CatalogResolver {
  private readonly endpoint?: string;
  private readonly fetcher?: Fetcher;
  private readonly staticCatalog: CatalogMap;
  private readonly autoRefresh: boolean;

  private cache: CatalogMap | null = null;
  private loadedFromRemote = false;

  constructor(options: CatalogResolverOptions = {}) {
    this.endpoint =
      options.endpoint === null
        ? undefined
        : options.endpoint ?? DEFAULT_CATALOG_ENDPOINT;
    this.fetcher = options.fetcher ?? (globalThis.fetch as Fetcher | undefined);
    this.autoRefresh = options.autoRefresh ?? true;

    this.staticCatalog = normalizeCatalog({
      ...(staticCatalog as CatalogMap),
      ...(options.staticCatalog ?? {}),
    });
  }

  private mergeCatalogs(remote: CatalogMap | null): CatalogMap {
    return {
      ...this.staticCatalog,
      ...normalizeCatalog(remote ?? {}),
    };
  }

  private async fetchRemoteCatalog(signal?: AbortSignal): Promise<CatalogMap> {
    if (!this.endpoint) {
      throw new CatalogUnavailableError(
        "No catalog endpoint configured and static catalog was empty."
      );
    }

    if (!this.fetcher) {
      throw new CatalogUnavailableError(
        "Fetch implementation not available to retrieve remote catalog."
      );
    }

    try {
      const response = await this.fetcher(this.endpoint, { signal });
      if (!response.ok) {
        throw new CatalogUnavailableError(
          `Failed to download remote CID catalog (status ${response.status}).`
        );
      }
      const payload = (await response.json()) as CatalogMap;
      this.loadedFromRemote = true;
      return payload;
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      throw new CatalogUnavailableError(
        `Unable to retrieve CID catalog: ${String((error as Error).message ?? error)}`
      );
    }
  }

  private async getCatalog(signal?: AbortSignal): Promise<CatalogMap> {
    if (this.cache) {
      return this.cache;
    }

    let remote: CatalogMap | null = null;

    if (this.endpoint && this.fetcher) {
      try {
        remote = await this.fetchRemoteCatalog(signal);
      } catch (error) {
        if (!this.autoRefresh && Object.keys(this.staticCatalog).length === 0) {
          throw error;
        }
        // Fall back to static catalog if available
        if (Object.keys(this.staticCatalog).length === 0) {
          throw error;
        }
      }
    }

    const merged = this.mergeCatalogs(remote);
    if (Object.keys(merged).length === 0) {
      throw new CatalogUnavailableError(
        "Dataset catalog is empty. Provide a static catalog or remote endpoint."
      );
    }

    this.cache = merged;
    return merged;
  }

  clearCache() {
    this.cache = null;
    this.loadedFromRemote = false;
  }

  /**
   * Resolve a catalog path directly to a CID.
   */
  async resolvePath(path: string, signal?: AbortSignal): Promise<string> {
    const normalized = path.trim().toLowerCase();
    const catalog = await this.getCatalog(signal);
    const cid = catalog[normalized];
    if (!cid) {
      throw new DatasetNotFoundError(
        `No CID found for dataset key "${normalized}".`
      );
    }
    return cid;
  }

  /**
   * Resolve a dataset request to a CID, trying multiple candidate keys.
   */
  async resolveDataset(
    request: DatasetRequest,
    options: ResolveOptions = {}
  ): Promise<{ cid: string; path: string }> {
    const catalog = await this.getCatalog(options.signal);
    const candidates = buildCatalogCandidates(request, {
      path: options.path,
    });

    let lastError: unknown;
    for (const candidate of candidates) {
      const cid = catalog[candidate];
      if (cid) {
        return { cid, path: candidate };
      }
      lastError = new DatasetNotFoundError(
        `Dataset key "${candidate}" not found in catalog.`
      );
    }

    throw (lastError ??
      new DatasetNotFoundError(
        `Dataset "${request.dataset}" could not be resolved from catalog.`
      ));
  }

  listKnownDatasets(): string[] {
    if (this.cache) {
      return Object.keys(this.cache);
    }
    return Object.keys(this.staticCatalog);
  }

  loadedFromRemoteCatalog(): boolean {
    return this.loadedFromRemote;
  }
}
