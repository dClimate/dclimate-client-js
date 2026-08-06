import { describe, expect, it } from "vitest";
import { DClimateClient } from "../src/index.js";
import { StationsClient } from "../src/stations/stations-client.js";
import { DatasetNotFoundError } from "../src/errors.js";

const REAL_CID =
  "bafyr4igxoe2toq5t3afp4embl3p2v4rgdfndymlhjiuizca3zwlvrmhcam";

describe("client.stations", () => {
  it("is available without configuration, unlike siren", () => {
    // Siren needs credentials and throws when unconfigured; station reads only
    // need the gateway the client already has, so requiring an option would be
    // ceremony with nothing behind it.
    const client = new DClimateClient({ gatewayUrl: "http://127.0.0.1:8080" });
    expect(client.stations).toBeInstanceOf(StationsClient);
  });

  it("reuses one instance across accesses", () => {
    const client = new DClimateClient({ gatewayUrl: "http://127.0.0.1:8080" });
    expect(client.stations).toBe(client.stations);
  });

  it("rejects a malformed CID before touching the network", async () => {
    const client = new DClimateClient({ gatewayUrl: "http://127.0.0.1:8080" });
    let fetched = 0;
    const stations = new StationsClient({
      gatewayUrl: "http://127.0.0.1:8080",
      fetch: (async () => {
        fetched += 1;
        return new Response(null, { status: 500 });
      }) as typeof fetch,
    });

    await expect(stations.load({ cid: "obviously-not-a-cid" })).rejects.toThrow(
      DatasetNotFoundError
    );
    // The point of the assertion: a typo'd CID should fail locally and
    // instantly, not after a gateway round trip.
    expect(fetched).toBe(0);
    expect(client.stations).toBeDefined();
  });

  it("requires a CID until catalog resolution exists", async () => {
    const client = new DClimateClient({ gatewayUrl: "http://127.0.0.1:8080" });
    await expect(
      client.stations.load({ cid: "" })
    ).rejects.toThrow(DatasetNotFoundError);
  });

  it("routes reads through the gateway it was given", async () => {
    const requested: string[] = [];
    const stations = new StationsClient({
      gatewayUrl: "https://gateway.example",
      fetch: (async (input: string | URL | Request) => {
        requested.push(String(input instanceof Request ? input.url : input));
        // A 404 ends the load; the assertion is about where it went, not
        // whether the dataset resolves.
        return new Response(null, { status: 404 });
      }) as typeof fetch,
    });

    await expect(stations.load({ cid: REAL_CID })).rejects.toThrow();
    expect(requested[0]).toContain("https://gateway.example/ipfs/");
    expect(requested[0]).toContain(REAL_CID);
  });

  it("lets a per-request gateway override the client default", async () => {
    const requested: string[] = [];
    const stations = new StationsClient({
      gatewayUrl: "https://default.example",
      fetch: (async (input: string | URL | Request) => {
        requested.push(String(input instanceof Request ? input.url : input));
        return new Response(null, { status: 404 });
      }) as typeof fetch,
    });

    await expect(
      stations.load({ cid: REAL_CID, gatewayUrl: "https://override.example" })
    ).rejects.toThrow();
    expect(requested[0]).toContain("https://override.example/");
  });
});
