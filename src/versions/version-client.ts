import { VersionApiError } from "../errors.js";
import type {
  CitationInfo,
  DatasetVersion,
  DatasetVersionListing,
  VersionFilters,
} from "./types.js";

export type FetchImplementation = typeof fetch;

async function requestJson<T>(
  url: string,
  fetchImpl: FetchImplementation
): Promise<T> {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new VersionApiError(
      `Version API request failed (${response.status}) for ${url}: ${text}`,
      response.status
    );
  }
  return response.json() as Promise<T>;
}

export async function listVersionsFromUrl(
  versionsUrl: string,
  filters: VersionFilters = {},
  fetchImpl: FetchImplementation = fetch
): Promise<DatasetVersionListing> {
  const url = new URL(versionsUrl);
  if (filters.anchored !== undefined) {
    url.searchParams.set("anchored", String(filters.anchored));
  }
  if (filters.isCitable !== undefined) {
    url.searchParams.set("isCitable", String(filters.isCitable));
  }
  if (filters.versionLabel !== undefined) {
    url.searchParams.set("versionLabel", filters.versionLabel);
  }
  return requestJson<DatasetVersionListing>(url.toString(), fetchImpl);
}

export async function getExactVersionFromUrl(
  versionsUrl: string,
  commitId: string,
  fetchImpl: FetchImplementation = fetch
): Promise<DatasetVersion> {
  const url = new URL(versionsUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(commitId)}`;
  return requestJson<DatasetVersion>(url.toString(), fetchImpl);
}

export async function getCitationFromUrl(
  citationUrl: string,
  fetchImpl: FetchImplementation = fetch
): Promise<CitationInfo> {
  return requestJson<CitationInfo>(citationUrl, fetchImpl);
}
