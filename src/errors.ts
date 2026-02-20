export class DClimateClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DatasetNotFoundError extends DClimateClientError {}

export class InvalidSelectionError extends DClimateClientError {}

export class NoDataFoundError extends DClimateClientError {}

export class SirenApiError extends DClimateClientError {}

export class SirenNotConfiguredError extends DClimateClientError {}

export class X402PaymentError extends DClimateClientError {}

export class X402NotInstalledError extends DClimateClientError {}
