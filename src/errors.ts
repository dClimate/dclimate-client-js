export class DClimateClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class CatalogUnavailableError extends DClimateClientError {}

export class DatasetNotFoundError extends DClimateClientError {}

export class InvalidSelectionError extends DClimateClientError {}

export class SelectionTooLargeError extends DClimateClientError {}

export class NoDataFoundError extends DClimateClientError {}
