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

export class SirenApiError extends DClimateClientError {}

export class SirenNotConfiguredError extends DClimateClientError {}

export class VersionHistoryUnavailableError extends DClimateClientError {}

export class VersionApiError extends DClimateClientError {
  constructor(message: string, public status?: number) {
    super(message);
  }
}
