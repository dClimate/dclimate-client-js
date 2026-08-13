import { StationDataset } from "@dclimate/tabular/reader";
import { translateStationError } from "./errors.js";

/**
 * Wrap a `StationDataset` so every method failure -- not just `open`'s -- comes
 * back as a `DClimateClientError`.
 *
 * Translating only at `load` leaves a hole the size of the actual API. `open`
 * parses a manifest; the errors a caller is far likelier to hit come later, from
 * `select` on an unknown station, `where` on a non-comparable column, or `rows`
 * on a selection that matched nothing. Those are raised inside tabular and,
 * untranslated, escape as `DatasetReaderError` -- so the one `catch (e) { if (e
 * instanceof DClimateClientError) }` this library tells people to write misses
 * precisely the failures they were most likely to be catching for.
 *
 * A Proxy rather than a hand-written class of forwarding methods, for two
 * reasons. Selections return *new* `StationDataset` instances, so a class would
 * have to remember to re-wrap the result of every chainable -- and a method
 * added to tabular later would silently return an unwrapped dataset, reopening
 * the hole halfway down a chain. And `toQuery`/`plan`/`rows` return plain data
 * that must pass through untouched; a proxy distinguishes those by what comes
 * back rather than by a list someone has to keep current.
 *
 * Three return shapes are handled, because the API has all three:
 *   - sync chainable  (`select`, `timeRange`, `where`) -> re-wrap
 *   - async chainable (`nearest`)                      -> re-wrap on resolve
 *   - async terminal  (`rows`, `plan`, `listStations`) -> translate rejection
 */
export const wrapStationDataset = (dataset: StationDataset): StationDataset =>
  new Proxy(dataset, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;

      return (...args: unknown[]): unknown => {
        let result: unknown;
        try {
          // Called on `target`, not the proxy: tabular's methods touch private
          // fields, and a proxied `this` would trap those reads too.
          result = (value as (...a: unknown[]) => unknown).apply(target, args);
        } catch (cause) {
          // A synchronous throw -- an unknown column rejected at selection time,
          // before any I/O.
          return translateStationError(cause);
        }

        if (result instanceof Promise) {
          return result.then(
            (resolved) =>
              // `nearest` resolves to a further dataset; keep the chain wrapped.
              resolved instanceof StationDataset
                ? wrapStationDataset(resolved as StationDataset)
                : resolved,
            (cause: unknown) => translateStationError(cause)
          );
        }

        // Sync selections return a new dataset, which must be wrapped or the
        // translation stops at the first link of the chain.
        return result instanceof StationDataset
          ? wrapStationDataset(result as StationDataset)
          : result;
      };
    },
  });
