import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listAvailableDatasetsFromStacServer,
  resolveCidFromStacServer,
} from "../../src/index.js";

const collection = "example_collection";
const dataset = "temperature_mean";

function feature(name: string, cid: string) {
  return {
    type: "Feature" as const,
    id: `${collection}-${name}-default`,
    collection,
    properties: {
      "dclimate:dataset_id": name,
      "dclimate:variant": "default",
      "dclimate:latest_dataset_cid": `ipfs://${cid}`,
    },
    assets: { data: { href: `ipfs://${cid}` } },
  };
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => "redirected",
  } as Response;
}

describe("STAC server parity hardening", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    "https://attacker.example/collect",
    "http://stac.example/search?page=2",
  ])("rejects an untrusted pagination link %s", async (nextHref) => {
    const fetchMock = vi.fn(async () =>
      response({
        features: [feature("other_dataset", "bafy-other")],
        links: [{ rel: "next", href: nextHref }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveCidFromStacServer(
        collection,
        dataset,
        undefined,
        "https://stac.example"
      )
    ).rejects.toThrow(/configured server origin/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported pagination methods", async () => {
    const fetchMock = vi.fn(async () =>
      response({
        features: [feature("other_dataset", "bafy-other")],
        links: [
          {
            rel: "next",
            href: "/search?page=2",
            method: "DELETE",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveCidFromStacServer(
        collection,
        dataset,
        undefined,
        "https://stac.example"
      )
    ).rejects.toThrow(/unsupported method: 'DELETE'/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects repeated pagination requests instead of returning partial results", async () => {
    const fetchMock = vi.fn(async () =>
      response({
        features: [feature("other_dataset", "bafy-other")],
        links: [
          {
            rel: "next",
            href: "/search",
            method: "POST",
            merge: true,
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveCidFromStacServer(
        collection,
        dataset,
        undefined,
        "https://stac.example"
      )
    ).rejects.toThrow(/repeated a request.*truncated/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats fragment-only pagination changes as repeated requests", async () => {
    let fragment = 0;
    const fetchMock = vi.fn(async () => {
      fragment += 1;
      return response({
        features: [feature("other_dataset", "bafy-other")],
        links: [{ rel: "next", href: `/search#${fragment}` }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveCidFromStacServer(
        collection,
        dataset,
        undefined,
        "https://stac.example"
      )
    ).rejects.toThrow(/repeated a request.*truncated/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://stac.example/search");
  });

  it("sends an empty object for a POST continuation without a body", async () => {
    const requestBodies: Array<BodyInit | null | undefined> = [];
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        requestBodies.push(init?.body);
        return response(
          requestBodies.length === 1
            ? {
                features: [feature("other_dataset", "bafy-other")],
                links: [
                  {
                    rel: "next",
                    href: "/search?page=2",
                    method: "POST",
                  },
                ],
              }
            : { features: [feature(dataset, "bafy-target")] }
        );
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveCidFromStacServer(
        collection,
        dataset,
        undefined,
        "https://stac.example"
      )
    ).resolves.toMatchObject({ cid: "bafy-target" });
    expect(requestBodies[1]).toBe("{}");
  });

  it("does not forward linked headers over plaintext HTTP", async () => {
    const seenHeaders: Array<Record<string, string>> = [];
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        seenHeaders.push((init?.headers ?? {}) as Record<string, string>);
        return response(
          seenHeaders.length === 1
            ? {
                features: [feature("other_dataset", "bafy-other")],
                links: [
                  {
                    rel: "next",
                    href: "/search?page=2",
                    headers: { Authorization: "Bearer continuation" },
                  },
                ],
              }
            : { features: [feature(dataset, "bafy-target")] }
        );
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveCidFromStacServer(
        collection,
        dataset,
        undefined,
        "http://stac.example"
      )
    ).resolves.toMatchObject({ cid: "bafy-target" });
    expect(seenHeaders[1]?.Authorization).toBeUndefined();
  });

  it("disables automatic redirect following", async () => {
    const fetchMock = vi.fn(async () => response({}, 302));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveCidFromStacServer(
        collection,
        dataset,
        undefined,
        "https://stac.example"
      )
    ).rejects.toThrow(/302/);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://stac.example/search",
      expect.objectContaining({ redirect: "manual" })
    );
  });

  it("uses paginated search results when listing datasets", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.endsWith("/collections")) {
          return response({ collections: [{ id: collection }] });
        }
        if (url.endsWith("?page=2")) {
          return response({ features: [feature(dataset, "bafy-target")] });
        }
        return response({
          features: [feature("other_dataset", "bafy-other")],
          links: [{ rel: "next", href: "/search?page=2" }],
        });
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await listAvailableDatasetsFromStacServer(
      "https://stac.example"
    );

    expect(catalog[0]?.datasets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dataset,
          variants: [
            expect.objectContaining({
              variant: "default",
              cid: "bafy-target",
            }),
          ],
        }),
      ])
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
