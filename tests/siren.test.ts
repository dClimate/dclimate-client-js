import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DClimateClient } from "../src/index.js";
import { SirenClient } from "../src/siren/siren-client.js";
import { createEip1193Signer } from "../src/siren/helpers.js";
import {
  SirenApiError,
  SirenNotConfiguredError,
  X402NotInstalledError,
} from "../src/errors.js";
import type { SirenRegionsResponse } from "../src/siren/types.js";

const MOCK_REGIONS_RESPONSE: SirenRegionsResponse = {
  items: [
    {
      id: "region-1",
      name: "US Midwest",
      internal_code: null,
      region_type: "custom",
      account_id: "acc-123",
      country_id: "us",
      commodity_code: "custom",
      geo_json: '{"type":"Polygon"}',
      extra_info: null,
      created_at: "2025-01-01T00:00:00Z",
      historical_fetch_enabled: true,
      country: { id: "us", name: "United States", code: "US" },
    },
  ],
  limit: 100,
  offset: 0,
  total: 1,
};

const MOCK_METRIC_DATA = [
  { date: "2025-01-01", value: 12.5 },
  { date: "2025-01-02", value: 13.1 },
  { date: "2025-01-03", value: 11.8 },
];

const MOCK_METRIC_DATA_OBJECT = {
  average_precip: {
    "2025-01-01": 12.5,
    "2025-01-02": 13.1,
    "2025-01-03": 11.8,
  },
};

describe("SirenClient", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("API key auth", () => {
    it("fetches metric data with Bearer token", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_METRIC_DATA,
      });

      const client = new SirenClient({
        auth: { type: "apiKey", apiKey: "sk-test", accountId: "acc-123" },
      });

      const data = await client.getMetricData({
        regionId: "region-1",
        metric: "average_precip",
        startDate: "2025-01-01",
        endDate: "2025-01-03",
      });

      expect(data).toEqual(MOCK_METRIC_DATA);
      expect(fetchSpy).toHaveBeenCalledOnce();

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toContain("/metric-data-multiple/acc-123/region-1/average_precip/2025-01-01/2025-01-03");
      expect(opts.headers.Authorization).toBe("Bearer sk-test");
    });

    it("lists regions with Bearer token", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_REGIONS_RESPONSE,
      });

      const client = new SirenClient({
        auth: { type: "apiKey", apiKey: "sk-test", accountId: "acc-123" },
      });

      const regions = await client.listRegions();

      expect(regions).toHaveLength(1);
      expect(regions[0].name).toBe("US Midwest");

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toContain("/custom-regions/acc-123/custom");
      expect(opts.headers.Authorization).toBe("Bearer sk-test");
    });

    it("formats Date objects to YYYY-MM-DD strings", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_METRIC_DATA,
      });

      const client = new SirenClient({
        auth: { type: "apiKey", apiKey: "sk-test", accountId: "acc-123" },
      });

      await client.getMetricData({
        regionId: "region-1",
        metric: "average_temp_mean",
        startDate: new Date("2025-06-01"),
        endDate: new Date("2025-06-30"),
      });

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain("/2025-06-01/2025-06-30");
    });

    it("throws SirenApiError on non-ok response", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      const client = new SirenClient({
        auth: { type: "apiKey", apiKey: "bad-key", accountId: "acc-123" },
      });

      await expect(
        client.getMetricData({
          regionId: "region-1",
          metric: "average_precip",
          startDate: "2025-01-01",
          endDate: "2025-01-03",
        })
      ).rejects.toThrow(SirenApiError);
    });

    it("uses custom baseUrl when provided", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_METRIC_DATA,
      });

      const client = new SirenClient({
        auth: { type: "apiKey", apiKey: "sk-test", accountId: "acc-123" },
        baseUrl: "https://custom-siren.example.com/api",
      });

      await client.getMetricData({
        regionId: "region-1",
        metric: "average_precip",
        startDate: "2025-01-01",
        endDate: "2025-01-03",
      });

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/^https:\/\/custom-siren\.example\.com\/api/);
    });

    it("parses object metric responses using the requested metric key", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_METRIC_DATA_OBJECT,
      });

      const client = new SirenClient({
        auth: { type: "apiKey", apiKey: "sk-test", accountId: "acc-123" },
      });

      const data = await client.getMetricData({
        regionId: "region-1",
        metric: "average_precip",
        startDate: "2025-01-01",
        endDate: "2025-01-03",
      });

      expect(data).toEqual(MOCK_METRIC_DATA);
    });

    it("throws when object metric response does not include requested metric", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ different_metric: { "2025-01-01": 1 } }),
      });

      const client = new SirenClient({
        auth: { type: "apiKey", apiKey: "sk-test", accountId: "acc-123" },
      });

      await expect(
        client.getMetricData({
          regionId: "region-1",
          metric: "average_precip",
          startDate: "2025-01-01",
          endDate: "2025-01-03",
        })
      ).rejects.toThrow(/missing requested metric/i);
    });
  });

  describe("env var fallback", () => {
    it("reads SIREN_API_KEY and SIREN_ACCOUNT_ID from env", () => {
      vi.stubGlobal("process", {
        env: {
          SIREN_API_KEY: "env-key",
          SIREN_ACCOUNT_ID: "env-acc",
        },
      });

      const client = new SirenClient({
        auth: { type: "apiKey" },
      });

      // Client constructed without error — env vars were resolved
      expect(client).toBeDefined();
    });

    it("throws if SIREN_API_KEY is missing from both options and env", () => {
      vi.stubGlobal("process", { env: {} });

      expect(
        () => new SirenClient({ auth: { type: "apiKey" } })
      ).toThrow(SirenApiError);
      expect(
        () => new SirenClient({ auth: { type: "apiKey" } })
      ).toThrow(/SIREN_API_KEY/);
    });

    it("throws if SIREN_ACCOUNT_ID is missing from both options and env", () => {
      vi.stubGlobal("process", {
        env: { SIREN_API_KEY: "env-key" },
      });

      expect(
        () => new SirenClient({ auth: { type: "apiKey" } })
      ).toThrow(SirenApiError);
      expect(
        () => new SirenClient({ auth: { type: "apiKey" } })
      ).toThrow(/SIREN_ACCOUNT_ID/);
    });

    it("explicit options take precedence over env vars", async () => {
      vi.stubGlobal("process", {
        env: {
          SIREN_API_KEY: "env-key",
          SIREN_ACCOUNT_ID: "env-acc",
        },
      });

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_METRIC_DATA,
      });

      const client = new SirenClient({
        auth: { type: "apiKey", apiKey: "explicit-key", accountId: "explicit-acc" },
      });

      await client.getMetricData({
        regionId: "r1",
        metric: "m1",
        startDate: "2025-01-01",
        endDate: "2025-01-02",
      });

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toContain("/explicit-acc/");
      expect(opts.headers.Authorization).toBe("Bearer explicit-key");
    });
  });

  describe("x402 auth", () => {
    it("throws X402NotInstalledError when @x402 packages are not available", async () => {
      const mockSigner = {
        address: "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`,
        signTypedData: vi.fn(),
        readContract: vi.fn(),
      };

      const client = new SirenClient({
        auth: { type: "x402", signer: mockSigner, network: "base" },
        x402BaseUrl: "https://x402-siren.example.com",
      });

      await expect(
        client.getMetricData({
          regionId: "region-1",
          metric: "average_precip",
          startDate: "2025-01-01",
          endDate: "2025-01-03",
        })
      ).rejects.toThrow(X402NotInstalledError);
    });
  });

  describe("DClimateClient integration", () => {
    it("exposes getMetricData and listRegions when siren is configured", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_METRIC_DATA,
      });

      const client = new DClimateClient({
        siren: {
          auth: { type: "apiKey", apiKey: "sk-test", accountId: "acc-123" },
        },
      });

      const data = await client.getMetricData({
        regionId: "region-1",
        metric: "average_precip",
        startDate: "2025-01-01",
        endDate: "2025-01-03",
      });

      expect(data).toEqual(MOCK_METRIC_DATA);
    });

    it("throws when calling getMetricData without siren configured", async () => {
      const client = new DClimateClient();

      await expect(
        client.getMetricData({
          regionId: "region-1",
          metric: "average_precip",
          startDate: "2025-01-01",
          endDate: "2025-01-03",
        })
      ).rejects.toThrow(SirenNotConfiguredError);
    });

    it("throws when calling listRegions without siren configured", async () => {
      const client = new DClimateClient();
      await expect(client.listRegions()).rejects.toThrow(SirenNotConfiguredError);
    });
  });
});

describe("createEip1193Signer", () => {
  it("creates a signer that calls eth_requestAccounts and eth_signTypedData_v4", async () => {
    const mockProvider = {
      request: vi.fn(),
    };

    // Mock eth_requestAccounts
    mockProvider.request.mockImplementation(async (args: { method: string }) => {
      if (args.method === "eth_requestAccounts") {
        return ["0xabcdef1234567890abcdef1234567890abcdef12"];
      }
      if (args.method === "eth_signTypedData_v4") {
        return "0xsignature123";
      }
      throw new Error(`Unexpected method: ${args.method}`);
    });

    const signer = createEip1193Signer(mockProvider);

    const sig = await signer.signTypedData({
      domain: { name: "test" },
      types: { Test: [{ name: "value", type: "uint256" }] },
      primaryType: "Test",
      message: { value: 1 },
    });

    expect(sig).toBe("0xsignature123");

    // Should have called eth_requestAccounts first, then eth_signTypedData_v4
    expect(mockProvider.request).toHaveBeenCalledWith({
      method: "eth_requestAccounts",
    });
    expect(mockProvider.request).toHaveBeenCalledWith({
      method: "eth_signTypedData_v4",
      params: [
        "0xabcdef1234567890abcdef1234567890abcdef12",
        expect.any(String),
      ],
    });
  });

  it("caches the wallet address after first call", async () => {
    const mockProvider = {
      request: vi.fn(),
    };

    mockProvider.request.mockImplementation(async (args: { method: string }) => {
      if (args.method === "eth_requestAccounts") return ["0xabc123"];
      if (args.method === "eth_signTypedData_v4") return "0xsig";
      throw new Error(`Unexpected: ${args.method}`);
    });

    const signer = createEip1193Signer(mockProvider);

    // Call signTypedData twice
    await signer.signTypedData({
      domain: {},
      types: {},
      primaryType: "Test",
      message: {},
    });
    await signer.signTypedData({
      domain: {},
      types: {},
      primaryType: "Test",
      message: {},
    });

    // eth_requestAccounts should only be called once (cached)
    const accountCalls = mockProvider.request.mock.calls.filter(
      (call: unknown[]) => (call[0] as { method: string }).method === "eth_requestAccounts"
    );
    expect(accountCalls).toHaveLength(1);
  });

  it("throws if no accounts available", async () => {
    const mockProvider = {
      request: vi.fn().mockResolvedValue([]),
    };

    const signer = createEip1193Signer(mockProvider);

    await expect(
      signer.signTypedData({
        domain: {},
        types: {},
        primaryType: "Test",
        message: {},
      })
    ).rejects.toThrow(/No accounts available/);
  });

  it("throws when accessing address before any signing", () => {
    const mockProvider = { request: vi.fn() };
    const signer = createEip1193Signer(mockProvider);

    expect(() => signer.address).toThrow(/not yet available/);
  });

  it("encodes readContract eth_call data for common ERC-20 selectors", async () => {
    const mockProvider = {
      request: vi.fn(async (args: { method: string }) => {
        if (args.method === "eth_call") return "0x01";
        throw new Error(`Unexpected method: ${args.method}`);
      }),
    };

    const signer = createEip1193Signer(mockProvider);
    const result = await signer.readContract({
      address: "0x1111111111111111111111111111111111111111",
      abi: [
        {
          type: "function",
          name: "balanceOf",
          inputs: [{ type: "address" }],
        },
      ],
      functionName: "balanceOf",
      args: ["0x2222222222222222222222222222222222222222"],
    });

    expect(result).toBe("0x01");
    expect(mockProvider.request).toHaveBeenCalledWith({
      method: "eth_call",
      params: [
        {
          to: "0x1111111111111111111111111111111111111111",
          data:
            "0x70a082310000000000000000000000002222222222222222222222222222222222222222",
        },
        "latest",
      ],
    });
  });
});
