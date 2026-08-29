export type SourceId = "indeed" | "firecrawl";

export type SourceResult = {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  excerpt: string;
  source: SourceId;
};

export type SourceSearchStatus = "ok" | "not-configured" | "skipped" | "error";

export type SourceSearchResponse = {
  source: SourceId;
  label: string;
  status: SourceSearchStatus;
  message?: string;
  results: SourceResult[];
};

export const SOURCE_LABEL: Record<SourceId, string> = {
  indeed: "Indeed",
  firecrawl: "Firecrawl",
};