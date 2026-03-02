/**
 * Minimal type declarations for optional @x402/* packages.
 * These allow TypeScript to compile without the packages installed.
 * When the packages are installed, their own types take precedence.
 */

declare module "@x402/fetch" {
  export type PaymentRequirements = {
    amount?: string;
    maxAmountRequired?: string;
    [key: string]: unknown;
  };

  export type PaymentPolicy = (
    x402Version: number,
    paymentRequirements: PaymentRequirements[]
  ) => PaymentRequirements[];

  export function wrapFetchWithPayment(
    fetchFn: typeof fetch,
    client: unknown
  ): typeof fetch;

  export class x402Client {
    constructor();
    register(network: string, scheme: unknown): x402Client;
    registerPolicy(policy: PaymentPolicy): x402Client;
  }

  export class x402HTTPClient {
    constructor(client: unknown);
  }
}

declare module "@x402/evm" {
  export class ExactEvmScheme {
    constructor(signer: unknown);
  }

  export function toClientEvmSigner(
    signer: unknown,
    publicClient?: unknown
  ): unknown;
}
