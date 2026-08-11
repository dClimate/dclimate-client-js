import { describe, expect, it } from "vitest";
import {
  DatasetReaderError,
  StationSelectionError,
} from "@dclimate/tabular/reader";
import { DClimateClient } from "../src/index.js";
import { StationsClient } from "../src/stations/stations-client.js";
import { translateStationError } from "../src/stations/errors.js";
import {
  DatasetNotFoundError,
  DClimateClientError,
  InvalidSelectionError,
  NoDataFoundError,
} from "../src/errors.js";

const REAL_CID =
  "bafyr4ieoihgvnl5rvu6eh2fqduapjtz7wjp3e7kdtfxjospmavi5lgkoq4";

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

describe("station error translation", () => {
  it("maps a not-found selection to NoDataFoundError", () => {
    // The distinction this library draws everywhere else: a well-formed request
    // that matched nothing is an empty answer, not a bad question.
    const cause = new StationSelectionError(
      "No station within 50 km of (43.4, -79.8) reports TMAX",
      "not-found"
    );
    expect(() => translateStationError(cause)).toThrow(NoDataFoundError);
    // The message is the only part naming the columns and distance that failed,
    // so it survives the translation verbatim.
    expect(() => translateStationError(cause)).toThrow(
      "No station within 50 km of (43.4, -79.8) reports TMAX"
    );
  });

  it("maps an invalid selection to InvalidSelectionError", () => {
    const cause = new StationSelectionError("Unknown element: NOPE", "invalid");
    expect(() => translateStationError(cause)).toThrow(InvalidSelectionError);
  });

  it("maps other reader failures to InvalidSelectionError", () => {
    expect(() => translateStationError(new DatasetReaderError("Unknown element: X")))
      .toThrow(InvalidSelectionError);
  });

  it("re-throws an unrecognised error unchanged", () => {
    // A bug or a network failure is not ours to reinterpret as a selection
    // problem; swallowing it into InvalidSelectionError would hide the cause.
    const bug = new TypeError("cannot read properties of undefined");
    expect(() => translateStationError(bug)).toThrow(TypeError);
    expect(() => translateStationError(bug)).toThrow("cannot read properties of undefined");
  });

  it("makes station failures catchable as DClimateClientError", () => {
    // The whole point of translating: one catch around the client covers station
    // queries too, which it did not before.
    try {
      translateStationError(new StationSelectionError("nothing here", "not-found"));
      expect.unreachable("translateStationError must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DClimateClientError);
    }
  });
});

describe("client.stations.nearest", () => {
  it("is reachable from the memoized namespace", () => {
    const client = new DClimateClient({ gatewayUrl: "http://127.0.0.1:8080" });
    expect(typeof client.stations.nearest).toBe("function");
    expect(client.stations).toBe(client.stations);
  });

  it("rejects a malformed CID before touching the network", async () => {
    let fetched = 0;
    const stations = new StationsClient({
      gatewayUrl: "http://127.0.0.1:8080",
      fetch: (async () => {
        fetched += 1;
        return new Response(null, { status: 500 });
      }) as typeof fetch,
    });

    await expect(
      stations.nearest({ cid: "not-a-cid", latitude: 43.4, longitude: -79.8 })
    ).rejects.toThrow(DatasetNotFoundError);
    expect(fetched).toBe(0);
  });
});
