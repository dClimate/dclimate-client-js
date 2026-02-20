/**
 * Minimal type declarations for optional @x402/* packages.
 * These allow TypeScript to compile without the packages installed.
 * When the packages are installed, their own types take precedence.
 */

declare module "@x402/fetch" {
  export function wrapFetchWithPayment(
    fetchFn: typeof fetch,
    client: unknown
  ): typeof fetch;
}

declare module "@x402/core" {
  export class x402Client {
    constructor();
    register(network: string, client: unknown): x402Client;
  }
}

declare module "@x402/evm" {
  export function registerEvmSchemes(
    client: unknown,
    signer: unknown,
    network: string
  ): void;
}
