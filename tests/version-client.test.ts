import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCitationFromUrl,
  getExactVersionFromUrl,
  listVersionsFromUrl,
} from "../src/versions/version-client.js";
import { VersionApiError } from "../src/errors.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("STAC-discovered version API URLs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("preserves the Tritium dataset slug and appends filters", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ dataset: "era5-temperature-2m-finalized", versions: [] })
    );

    const result = await listVersionsFromUrl(
      "https://tritium.dclimate.net/api/datasets/era5-temperature-2m-finalized/versions",
      { anchored: true, isCitable: false, versionLabel: "2026-08" },
      fetchMock
    );

    expect(result.dataset).toBe("era5-temperature-2m-finalized");
    const requested = new URL(fetchMock.mock.calls[0][0].toString());
    expect(requested.hostname).toBe("tritium.dclimate.net");
    expect(requested.pathname).toBe(
      "/api/datasets/era5-temperature-2m-finalized/versions"
    );
    expect(Object.fromEntries(requested.searchParams)).toEqual({
      anchored: "true",
      isCitable: "false",
      versionLabel: "2026-08",
    });
  });

  it("encodes an exact commit without rebuilding the dataset URL", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ dataset: "aigfs-wind-u", cid: "bafy-version" })
    );

    await getExactVersionFromUrl(
      "https://hydrogen.dclimate.net/api/datasets/aigfs-wind-u/versions",
      "commit/one",
      fetchMock
    );

    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      "https://hydrogen.dclimate.net/api/datasets/aigfs-wind-u/versions/commit%2Fone"
    );
  });

  it("preserves an existing citation commit query", async () => {
    const citationUrl =
      "https://hydrogen.dclimate.net/api/datasets/aigfs-wind-u/citation?commitId=commit-1";
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        dataset: "aigfs-wind-u",
        cid: "bafy-version",
        citation: "citation text",
      })
    );

    const result = await getCitationFromUrl(citationUrl, fetchMock);

    expect(result.citation).toBe("citation text");
    expect(fetchMock.mock.calls[0][0]).toBe(citationUrl);
  });

  it("reports the response status and URL for service errors", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ detail: "missing" }, 404));

    await expect(
      listVersionsFromUrl("https://hydrogen.test/datasets/missing/versions", {}, fetchMock)
    ).rejects.toMatchObject<Partial<VersionApiError>>({ status: 404 });
  });
});
