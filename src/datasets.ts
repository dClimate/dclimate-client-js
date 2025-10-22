export const HydrogenEndpoint =
  "https://dclimate-ceramic.duckdns.org/api/datasets";

export const DATASET_ENDPOINTS = {
  "fpar": `${HydrogenEndpoint}/fpar`,
  "aifs-single-precip": `${HydrogenEndpoint}/aifs-single-precip`,
  "aifs-single-temperature": `${HydrogenEndpoint}/aifs-single-temperature`,
  "aifs-single-wind-u": `${HydrogenEndpoint}/aifs-single-wind-u`,
  "aifs-single-wind-v": `${HydrogenEndpoint}/aifs-single-wind-v`,
  "aifs-single-solar-radiation": `${HydrogenEndpoint}/aifs-single-solar-radiation`,
  "aifs-ensemble-precip": `${HydrogenEndpoint}/aifs-ensemble-precip`,
  "aifs-ensemble-temperature": `${HydrogenEndpoint}/aifs-ensemble-temperature`,
  "aifs-ensemble-wind-u": `${HydrogenEndpoint}/aifs-ensemble-wind-u`,
  "aifs-ensemble-wind-v": `${HydrogenEndpoint}/aifs-ensemble-wind-v`,
  "aifs-ensemble-solar-radiation": `${HydrogenEndpoint}/aifs-ensemble-solar-radiation`,
  "ifs-precip": `${HydrogenEndpoint}/ifs-precip`,
  "ifs-temperature": `${HydrogenEndpoint}/ifs-temperature`,
  "ifs-wind-u": `${HydrogenEndpoint}/ifs-wind-u`,
  "ifs-wind-v": `${HydrogenEndpoint}/ifs-wind-v`,
  "ifs-soil-moisture-l3": `${HydrogenEndpoint}/ifs-soil-moisture-l3`,
  "ifs-solar-radiation": `${HydrogenEndpoint}/ifs-solar-radiation`,
} as const;

export type DatasetKey = keyof typeof DATASET_ENDPOINTS;

export function getDatasetEndpoint(key: DatasetKey): string | undefined {
  return DATASET_ENDPOINTS[key];
}

export function listDatasetKeys(): DatasetKey[] {
  return Object.keys(DATASET_ENDPOINTS) as DatasetKey[];
}
