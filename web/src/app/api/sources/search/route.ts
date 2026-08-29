import { NextRequest } from "next/server";
import { normalizeActorId, normalizeFirecrawlResults, normalizeIndeedItems, parseSearchRequest } from "@/lib/source-search.mjs";
import type { SourceSearchResponse } from "@/lib/source-search-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/search";
const APIFY_URL = "https://api.apify.com/v2";

export async function POST(req: NextRequest) {
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON request." }, { status: 400 });
  }

  let input: ReturnType<typeof parseSearchRequest>;
  try {
    input = parseSearchRequest(raw);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid search." }, { status: 400 });
  }

  const [indeed, firecrawl] = await Promise.all([
    searchIndeed(input).catch((error) => failed("indeed", "Indeed", error)),
    searchFirecrawl(input).catch((error) => failed("firecrawl", "Firecrawl", error)),
  ]);
  return Response.json({ query: input.query, location: input.location, sources: [indeed, firecrawl] }, { headers: { "Cache-Control": "no-store" } });
}

async function searchIndeed(input: ReturnType<typeof parseSearchRequest>): Promise<SourceSearchResponse> {
  const token = process.env.APIFY_TOKEN?.trim();
  const actor = process.env.INDEED_APIFY_ACTOR?.trim();
  if (!token || !actor) {
    return { source: "indeed", label: "Indeed", status: "not-configured", message: "Set APIFY_TOKEN and INDEED_APIFY_ACTOR to enable your Indeed provider.", results: [] };
  }
  const actorId = normalizeActorId(actor);
  const response = await timedFetch(APIFY_URL + "/acts/" + actorId + "/run-sync-get-dataset-items", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ position: input.query, query: input.query, location: input.location || undefined, maxItems: input.limit }),
  }, 110_000);
  if (!response.ok) throw new Error("Indeed provider failed (HTTP " + response.status + ").");
  return { source: "indeed", label: "Indeed", status: "ok", results: normalizeIndeedItems(await response.json()).slice(0, input.limit) };
}

async function searchFirecrawl(input: ReturnType<typeof parseSearchRequest>): Promise<SourceSearchResponse> {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) return { source: "firecrawl", label: "Firecrawl", status: "not-configured", message: "Set FIRECRAWL_API_KEY to enable career-site search.", results: [] };
  if (input.domains.length === 0) {
    return { source: "firecrawl", label: "Firecrawl", status: "skipped", message: "Add one or more employer career-site domains to run Firecrawl safely.", results: [] };
  }
  const query = [input.query, input.location, "jobs careers"].filter(Boolean).join(" ");
  const response = await timedFetch(FIRECRAWL_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ query, includeDomains: input.domains, limit: input.limit, scrapeOptions: { formats: ["markdown"], onlyMainContent: true } }),
  }, 60_000);
  if (!response.ok) throw new Error("Firecrawl search failed (HTTP " + response.status + ").");
  const json = await response.json();
  return { source: "firecrawl", label: "Firecrawl", status: "ok", results: normalizeFirecrawlResults(json?.data?.web).slice(0, input.limit) };
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function failed(source: SourceSearchResponse["source"], label: string, error: unknown): SourceSearchResponse {
  return { source, label, status: "error", message: error instanceof Error ? error.message : label + " could not complete the search.", results: [] };
}