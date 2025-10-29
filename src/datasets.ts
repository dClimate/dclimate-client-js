import { DatasetNotFoundError } from "./errors.js";
import type { DatasetRequest } from "./types.js";

export const HydrogenEndpoint =
  "https://dclimate-ceramic.duckdns.org/api/datasets";

export interface DatasetVariantConfig {
  variant: string;
  cid?: string;
  url?: string;
}

export interface CatalogDataset {
  dataset: string;
  variants: DatasetVariantConfig[];
}

export interface CatalogCollection {
  collection: string;
  datasets: CatalogDataset[];
}

export type DatasetCatalog = CatalogCollection[];

const DATASET_CATALOG_INTERNAL: DatasetCatalog = [
  {
    collection: "aifs",
    datasets: [
      {
        dataset: "precipitation",
        variants: [
          { variant: "single", url: `${HydrogenEndpoint}/aifs-single-precip` },
          { variant: "ensemble", url: `${HydrogenEndpoint}/aifs-ensemble-precip` },
        ],
      },
      {
        dataset: "temperature",
        variants: [
          { variant: "single", url: `${HydrogenEndpoint}/aifs-single-temperature` },
          { variant: "ensemble", url: `${HydrogenEndpoint}/aifs-ensemble-temperature` },
        ],
      },
      {
        dataset: "wind_u",
        variants: [
          { variant: "single", url: `${HydrogenEndpoint}/aifs-single-wind-u` },
          { variant: "ensemble", url: `${HydrogenEndpoint}/aifs-ensemble-wind-u` },
        ],
      },
      {
        dataset: "wind_v",
        variants: [
          { variant: "single", url: `${HydrogenEndpoint}/aifs-single-wind-v` },
          { variant: "ensemble", url: `${HydrogenEndpoint}/aifs-ensemble-wind-v` },
        ],
      },
      {
        dataset: "solar_radiation",
        variants: [
          { variant: "single", url: `${HydrogenEndpoint}/aifs-single-solar-radiation` },
          { variant: "ensemble", url: `${HydrogenEndpoint}/aifs-ensemble-solar-radiation` },
        ],
      },
    ],
  },
  {
    collection: "copernicus",
    datasets: [
      {
        dataset: "fpar",
        variants: [
          {
            variant: "default",
            cid: "bafyr4iatibj6bk3mvjec5be6ffnxsxde63yekxfhgym4yxgrxoifll6eda",
          },
        ],
      },
    ],
  },
  {
    collection: "ifs",
    datasets: [
      {
        dataset: "precipitation",
        variants: [{ variant: "default", url: `${HydrogenEndpoint}/ifs-precip` }],
      },
      {
        dataset: "temperature",
        variants: [{ variant: "default", url: `${HydrogenEndpoint}/ifs-temperature` }],
      },
      {
        dataset: "wind_u",
        variants: [{ variant: "default", url: `${HydrogenEndpoint}/ifs-wind-u` }],
      },
      {
        dataset: "wind_v",
        variants: [{ variant: "default", url: `${HydrogenEndpoint}/ifs-wind-v` }],
      },
      {
        dataset: "soil_moisture_l3",
        variants: [{ variant: "default", url: `${HydrogenEndpoint}/ifs-soil-moisture-l3` }],
      },
      {
        dataset: "solar_radiation",
        variants: [{ variant: "default", url: `${HydrogenEndpoint}/ifs-solar-radiation` }],
      },
    ],
  },
  {
    collection: "era5",
    datasets: [
      {
        dataset: "2m_temperature",
        variants: [
          {
            variant: "finalized",
            cid: "bafyr4iacuutc5bgmirkfyzn4igi2wys7e42kkn674hx3c4dv4wrgjp2k2u",
          },
          {
            variant: "non-finalized",
            cid: "bafyr4ihicmzx4uw4pefk7idba3mz5r5g27au3l7d62yj4gguxx6neaa5ti",
          },
        ],
      },
      {
        dataset: "total_precipitation",
        variants: [
          {
            variant: "finalized",
            cid: "bafyr4icium3zr6dyewfzkcwpnsb77nmxeblaomdk3kz3f2wz2rqq3i2yfi",
          },
          {
            variant: "non-finalized",
            cid: "bafyr4ifh3khz7f2mj6subudsbri7wfbna7s2iw5inn2wvbhkgms7k6n6ly",
          },
        ],
      },
      {
        dataset: "10m_u_wind",
        variants: [
          {
            variant: "finalized",
            cid: "bafyr4ih6kgfr2pgucs6cgxbyboayqrejv7wbsbcv23ldr7zqbtfhdhniwa",
          },
          {
            variant: "non-finalized",
            cid: "bafyr4ihaevzkwj6ozhbwcpg6h3cacfa2voa4ezhsdlcfnshu7wccutup24",
          },
        ],
      },
      {
        dataset: "10m_v_wind",
        variants: [
          {
            variant: "finalized",
            cid: "bafyr4igqxykzgn7ueyuxnyupb42bgav3o2v6ikarwyhlxisknypeyfjz5q",
          },
          {
            variant: "non-finalized",
            cid: "bafyr4ih5y3nkxdycxjzqhapynjdzbuj56fo4n3apdlcvqhgnggojk22ca4",
          },
        ],
      },
      {
        dataset: "surface_solar_radiation",
        variants: [
          {
            variant: "finalized",
            cid: "bafyr4ico6t4t2ztxbniigqmiy2rfbmhxpoge56oae3afqwxwwdw3ou4qya",
          },
          {
            variant: "non-finalized",
            cid: "bafyr4iaqdlk2ircn72rlaigrb6hufgavcxsqrjvoywokgz25ctel3btqzu",
          },
        ],
      },
      {
        dataset: "land_total_precipitation",
        variants: [
          {
            variant: "finalized",
            cid: "bafyr4ifqx5pq4zwv6tvusndvwm5h3ic2l3wewjroilfeeor55yvzriah5a",
          },
        ],
      },
    ],
  },
];

interface ResolvedDatasetSource {
  collection: string;
  dataset: string;
  variant: string;
  slug: string;
  path: string;
  source:
    | { type: "cid"; cid: string }
    | { type: "url"; url: string };
}

export function listDatasetCatalog(): DatasetCatalog {
  return DATASET_CATALOG_INTERNAL.map((collection) => ({
    collection: collection.collection,
    datasets: collection.datasets.map((dataset) => ({
      dataset: dataset.dataset,
      variants: dataset.variants.map((variant) => ({ ...variant })),
    })),
  }));
}

export function resolveDatasetSource(
  request: DatasetRequest
): ResolvedDatasetSource {
  const datasetKey = normalizeKey(request.dataset);
  if (!datasetKey) {
    throw new DatasetNotFoundError("Dataset name must be provided.");
  }

  const collectionEntry = findCollection(request.collection, datasetKey);
  const datasetEntry = findDataset(collectionEntry, datasetKey);
  const variantEntry = findVariant(datasetEntry, request.variant);

  const collectionName = collectionEntry.collection;
  const datasetName = datasetEntry.dataset;
  const variantName = variantEntry.variant;
  const slug = buildSlug(collectionName, datasetName, variantName);
  const path = slug;

  if (variantEntry.cid) {
    return {
      collection: collectionName,
      dataset: datasetName,
      variant: variantName,
      slug,
      path,
      source: { type: "cid", cid: variantEntry.cid },
    };
  }

  if (variantEntry.url) {
    const resolvedUrl = resolveVariantUrl(
      collectionName,
      datasetName,
      variantName,
      variantEntry.url
    );
    return {
      collection: collectionName,
      dataset: datasetName,
      variant: variantName,
      slug,
      path,
      source: { type: "url", url: resolvedUrl },
    };
  }

  throw new DatasetNotFoundError(
    `Variant "${variantName}" for dataset "${datasetName}" does not provide a CID or URL.`
  );
}

function resolveVariantUrl(
  collection: string,
  dataset: string,
  variant: string,
  value: string
): string {
  if (/^https?:/i.test(value)) {
    return value;
  }
  const baseSlug = value || buildSlug(collection, dataset, variant);
  return `${HydrogenEndpoint}/${baseSlug}`;
}

function findCollection(
  collection: string | undefined,
  datasetKey: string
): CatalogCollection {
  if (collection) {
    const normalized = normalizeKey(collection);
    const entry = DATASET_CATALOG_INTERNAL.find(
      (candidate) => normalizeKey(candidate.collection) === normalized
    );
    if (!entry) {
      const availableCollections = DATASET_CATALOG_INTERNAL.map(c => c.collection).join(", ");
      throw new DatasetNotFoundError(
        `Collection "${collection}" is not registered in the dataset catalog. Available collections: ${availableCollections}`
      );
    }
    return entry;
  }

  const matches = DATASET_CATALOG_INTERNAL.filter((candidate) =>
    candidate.datasets.some((dataset) => normalizeKey(dataset.dataset) === datasetKey)
  );

  if (matches.length === 0) {
    const allDatasets = DATASET_CATALOG_INTERNAL.flatMap(c =>
      c.datasets.map(d => `${c.collection}/${d.dataset}`)
    ).join(", ");
    throw new DatasetNotFoundError(
      `Dataset "${datasetKey}" is not registered in the dataset catalog. Available datasets: ${allDatasets}`
    );
  }
  if (matches.length > 1) {
    throw new DatasetNotFoundError(
      `Dataset "${datasetKey}" exists in multiple collections; please specify the collection.`
    );
  }

  return matches[0];
}

function findDataset(
  collection: CatalogCollection,
  datasetKey: string
): CatalogDataset {
  const datasetEntry = collection.datasets.find(
    (dataset) => normalizeKey(dataset.dataset) === datasetKey
  );
  if (!datasetEntry) {
    const availableDatasets = collection.datasets.map(d => d.dataset).join(", ");
    throw new DatasetNotFoundError(
      `Dataset "${datasetKey}" is not registered in collection "${collection.collection}". Available datasets in this collection: ${availableDatasets}`
    );
  }
  return datasetEntry;
}

function findVariant(
  dataset: CatalogDataset,
  variant: string | undefined
): DatasetVariantConfig {
  const normalizedVariant = normalizeKey(variant);

  if (normalizedVariant) {
    const match = dataset.variants.find(
      (candidate) => normalizeKey(candidate.variant) === normalizedVariant
    );
    if (!match) {
      const availableVariants = dataset.variants.map(v => v.variant).join(", ");
      throw new DatasetNotFoundError(
        `Variant "${variant}" is not available for dataset "${dataset.dataset}". Available variants: ${availableVariants}`
      );
    }
    return match;
  }

  if (dataset.variants.length === 1) {
    return dataset.variants[0];
  }

  const defaultVariant = dataset.variants.find(
    (candidate) => normalizeKey(candidate.variant) === "default"
  );
  if (defaultVariant) {
    return defaultVariant;
  }

  const availableVariants = dataset.variants.map(v => v.variant).join(", ");
  throw new DatasetNotFoundError(
    `Dataset "${dataset.dataset}" requires a variant to be specified. Available variants: ${availableVariants}`
  );
}

function buildSlug(
  collection: string,
  dataset: string,
  variant: string
): string {
  return [collection, dataset, variant]
    .map((segment) => segment.trim().toLowerCase().replace(/[_\s]+/g, "-"))
    .join("-");
}

function normalizeKey(value: string | undefined): string {
  return value
    ? value
        .trim()
        .toLowerCase()
        .replace(/[-\s]+/g, "_")
        .replace(/__+/g, "_")
    : "";
}

export { DATASET_CATALOG_INTERNAL as DATASET_CATALOG };
