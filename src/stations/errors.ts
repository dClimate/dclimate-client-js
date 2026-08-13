import {
  DatasetIntegrityError,
  DatasetReaderError,
  StationSelectionError,
} from "@dclimate/tabular/reader";
import {
  DatasetCorruptError,
  InvalidSelectionError,
  NoDataFoundError,
} from "../errors.js";

/**
 * Re-throw a station query failure as this library's own error type.
 *
 * Station queries are answered by `@dclimate/tabular`, whose errors descend from
 * its own base class rather than `DClimateClientError`. A caller writing one
 * `catch (error) { if (error instanceof DClimateClientError) ... }` around the
 * client would therefore miss every station failure -- so the boundary translates
 * once, here, rather than each method wrapping its own body.
 *
 * The mapping follows the distinction the rest of this library draws: a malformed
 * request is an `InvalidSelectionError` (a bad question), and a well-formed
 * request that matched nothing is a `NoDataFoundError` (an empty answer). Tabular
 * marks which is which on the error itself, so this reads a field rather than
 * matching on message text, which would break the first time a message improved.
 *
 * The original message is preserved verbatim: it is the only part that names the
 * station, column, or distance that actually failed.
 */
export const translateStationError = (cause: unknown): never => {
  if (cause instanceof StationSelectionError) {
    throw cause.reason === "not-found"
      ? new NoDataFoundError(cause.message)
      : new InvalidSelectionError(cause.message);
  }
  // Corrupt data is not a bad question. Checked as its own branch rather than
  // before the reader case for emphasis: tabular deliberately does not descend
  // `DatasetIntegrityError` from `DatasetReaderError`, precisely so a boundary
  // like this one cannot sweep it into "you asked wrong".
  if (cause instanceof DatasetIntegrityError) {
    throw new DatasetCorruptError(cause.message);
  }
  // Other reader failures are malformed requests too -- an unknown column, a
  // predicate against a column that is not comparable.
  if (cause instanceof DatasetReaderError) {
    throw new InvalidSelectionError(cause.message);
  }
  // Anything else is not ours to reinterpret: a TypeError from a bug, or a
  // network failure from the gateway, should surface as itself.
  throw cause;
};
