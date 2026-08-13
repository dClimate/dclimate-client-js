export class DClimateClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DatasetNotFoundError extends DClimateClientError {}

export class InvalidSelectionError extends DClimateClientError {}

export class MultiresolutionSelectionRequiredError extends InvalidSelectionError {
  constructor(
    message: string,
    public availableResolutions: string[] = [],
    public availableGroups: string[] = []
  ) {
    super(message);
  }
}

export class ResolutionNotAvailableError extends InvalidSelectionError {}

export class ConflictingResolutionSelectionError extends InvalidSelectionError {}

export class NoDataFoundError extends DClimateClientError {}

/**
 * The stored dataset is malformed, rather than the request against it.
 *
 * Distinct from `InvalidSelectionError` because the two point at different
 * culprits. An invalid selection is the caller's to fix by asking differently;
 * this says the bytes behind the CID are inconsistent, so no rephrasing helps
 * and the dataset's publisher is who needs to know. Reporting it as a bad
 * selection would send a caller hunting for a mistake in their own query.
 */
export class DatasetCorruptError extends DClimateClientError {}

export class SirenApiError extends DClimateClientError {}

export class SirenNotConfiguredError extends DClimateClientError {}

export class VersionHistoryUnavailableError extends DClimateClientError {}

export class VersionApiError extends DClimateClientError {
  constructor(message: string, public status?: number) {
    super(message);
  }
}
