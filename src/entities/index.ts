export {
  EntitiesClient,
  type LoadEntitiesRequest,
  type NearestEntityRequest,
  type EntitiesClientOptions,
} from "./entities-client.js";
export { translateEntityError } from "./errors.js";
export type {
  NearestOptions,
  NearestEntity,
  EntityDataset,
  EntityInfo,
  TimeInput,
  TimeRangeInput,
} from "@dclimate/tabular/reader";
