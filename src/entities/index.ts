export {
  EntitiesClient,
  type LoadEntitiesRequest,
  type NearestEntityRequest,
  type EntitiesClientOptions,
} from "./entities-client.js";
// `translateEntityError` is deliberately not re-exported: it is the internal
// translation boundary, and a value export from `./errors.js` would statically
// chain the main entry to tabular's reader stack -- the exact eager load that
// `load()` importing it dynamically exists to avoid. Type re-exports below are
// erased at compile time, so they cost nothing.
export type {
  NearestOptions,
  NearestEntity,
  EntityDataset,
  EntityInfo,
  TableField,
  TimeInput,
  TimeRangeInput,
} from "@dclimate/tabular/reader";
