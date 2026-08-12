export interface VerificationInfo {
  anchorStatus?: string;
  [key: string]: unknown;
}

export interface DatasetVersion {
  dataset: string;
  cid: string;
  oldCid?: string;
  timestamp?: number;
  streamId?: string;
  commitId?: string;
  controllerDid?: string;
  publishedAt?: string;
  versionLabel?: string;
  releaseClass?: string;
  isCitable?: boolean;
  retentionClass?: string;
  verification?: VerificationInfo;
}

export interface DatasetVersionListing {
  dataset: string;
  streamId?: string;
  versions: DatasetVersion[];
}

export interface CitationInfo {
  dataset: string;
  streamId?: string;
  commitId?: string;
  cid: string;
  publishedAt?: string;
  versionLabel?: string;
  isCitable?: boolean;
  retentionClass?: string;
  citation: string;
}

export interface VersionFilters {
  anchored?: boolean;
  isCitable?: boolean;
  versionLabel?: string;
}
