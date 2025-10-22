import { DEFAULT_DATASET_API_ENDPOINT } from "./constants.js";

const DATASET_KEYS = [
  "fpar",
  "aifs-single-precip",
  "aifs-single-temperature",
  "aifs-single-wind-u",
  "aifs-single-wind-v",
  "aifs-single-solar-radiation",
  "aifs-ensemble-precip",
  "aifs-ensemble-temperature",
  "aifs-ensemble-wind-u",
  "aifs-ensemble-wind-v",
  "aifs-ensemble-solar-radiation",
  "ifs-precip",
  "ifs-temperature",
  "ifs-wind-u",
  "ifs-wind-v",
  "ifs-soil-moisture-l3",
  "ifs-solar-radiation",
] as const;

export type DatasetKey = (typeof DATASET_KEYS)[number];

export const DATASET_ENDPOINTS: Record<DatasetKey, string> = DATASET_KEYS.reduce(
  (acc, key) => {
    acc[key] = `${DEFAULT_DATASET_API_ENDPOINT}/${key}`;
    return acc;
  },
  {} as Record<DatasetKey, string>
);

export function getDatasetEndpoint(key: string): string | undefined {
  return DATASET_ENDPOINTS[key as DatasetKey];
}

export function listDatasetKeys(): DatasetKey[] {
  return [...DATASET_KEYS];
}
