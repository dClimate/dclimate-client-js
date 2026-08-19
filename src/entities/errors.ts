import {
  DatasetIntegrityError,
  DatasetReaderError,
  DclimateTabularError,
  PredicateError,
  RangeSourceError,
  EntitySelectionError,
} from "@dclimate/tabular/reader";
import {
  DatasetCorruptError,
  InvalidSelectionError,
  NoDataFoundError,
} from "../errors.js";

/**
 * Re-throw an entity query failure as this library's own error type.
 *
 * Entity queries are answered by `@dclimate/tabular`, whose errors descend from
 * its own base class rather than `DClimateClientError`. A caller writing one
 * `catch (error) { if (error instanceof DClimateClientError) ... }` around the
 * client would therefore miss every entity failure -- so the boundary translates
 * once, here, rather than each method wrapping its own body.
 *
 * The mapping follows the distinction the rest of this library draws, by who has
 * to act: a malformed request is an `InvalidSelectionError` (the caller's to fix),
 * a well-formed request that matched nothing is a `NoDataFoundError` (an empty
 * answer, nobody's fault), and bytes that do not describe a readable dataset are a
 * `DatasetCorruptError` (the publisher's). Tabular marks the first two on the
 * error itself, so this reads a field rather than matching on message text, which
 * would break the first time a message improved.
 *
 * Transport failures are deliberately left untranslated, because they are none of
 * those three: a gateway timeout is retryable and says nothing about the dataset.
 *
 * The original message is preserved verbatim: it is the only part that names the
 * station, column, or distance that actually failed.
 */
export const translateEntityError = (cause: unknown): never => {
  if (cause instanceof EntitySelectionError) {
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
  if (cause instanceof DatasetReaderError || cause instanceof PredicateError) {
    throw new InvalidSelectionError(cause.message);
  }
  // The gateway failing to hand over bytes is a transport fact, not a statement
  // about the dataset: it is retryable, and reporting it as corruption would
  // send a caller to the publisher over what is usually a network blip. Checked
  // before the base class below, which it descends from.
  if (cause instanceof RangeSourceError) {
    throw cause;
  }
  // Any remaining tabular error means bytes arrived and did not describe a
  // readable dataset -- a CID naming a UnixFS file rather than a root (a
  // `CodecError` from the dag-cbor decode), or a well-formed block whose fields
  // are not a dataset root (a `WireError`). Both are corruption in the same
  // sense as `DatasetIntegrityError`, and no rephrasing fixes either.
  //
  // Matched on the base class rather than by listing `CodecError` and
  // `WireError`: this is the branch that keeps the promise that everything
  // escaping the client is a `DClimateClientError`, and a list of leaf types
  // silently stops keeping it the day tabular adds one. The specific classes
  // stay visible in the message, which is preserved verbatim.
  if (cause instanceof DclimateTabularError) {
    throw new DatasetCorruptError(`${cause.name}: ${cause.message}`);
  }
  // Anything else is not tabular's and not ours to reinterpret: a TypeError from
  // a bug in this client, or a `fetch` failure that never reached the reader,
  // should surface as itself.
  throw cause;
};
