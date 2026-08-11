export {
  StationsClient,
  type LoadStationsRequest,
  type NearestStationRequest,
  type StationsClientOptions,
} from "./stations-client.js";
export { translateStationError } from "./errors.js";
export type {
  NearestOptions,
  NearestStation,
  StationDataset,
  StationInfo,
  TimeInput,
  TimeRangeInput,
} from "@dclimate/tabular/reader";
