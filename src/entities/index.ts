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
  // Re-exported because `EntityInfo.gaps` and `QueryPlan.gaps` hand these to
  // every caller: without it a consumer can read a gap but cannot write down the
  // type of what they are holding, and would have to depend on
  // `@dclimate/tabular` directly to annotate a variable or a function parameter.
  DataGap,
  TableField,
  TimeInput,
  TimeRangeInput,
} from "@dclimate/tabular/reader";
