const MAX_QUERY_LENGTH = 200;
const MAX_LOCATION_LENGTH = 120;
const MAX_DOMAINS = 12;
const MAX_RESULTS = 25;
const ACTOR_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*[~/][A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function parseSearchRequest(raw = {}) {
  const query = String(raw.query ?? "").trim().replace(/\s+/g, " ");
  const location = String(raw.location ?? "").trim().replace(/\s+/g, " ");
  const domains = parseDomains(raw.domains);
  const limit = clamp(raw.limit, 1, MAX_RESULTS, 15);
  if (query.length < 3) throw new Error("Enter at least three characters for the job search.");
  if (query.length > MAX_QUERY_LENGTH) throw new Error("Keep the job search under 200 characters.");
  if (location.length > MAX_LOCATION_LENGTH) throw new Error("Keep the location under 120 characters.");
  return { query, location, domains, limit };
}

export function parseDomains(value) {
  const parts = Array.isArray(value) ? value : String(value ?? "").split(/[\s,]+/);
  const domains = [];
  for (const part of parts) {
    const normalized = normalizeDomain(part);
    if (normalized && !domains.includes(normalized)) domains.push(normalized);
  }
  return domains.slice(0, MAX_DOMAINS);
}

function normalizeDomain(value) {
  let domain = String(value ?? "").trim().toLowerCase();
  if (!domain) return "";
  try {
    if (!domain.includes("://")) domain = "https://" + domain;
    const url = new URL(domain);
    if (!url.hostname || url.username || url.password) return "";
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function clamp(value, low, high, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(low, Math.min(high, Math.trunc(n))) : fallback;
}

export function normalizeActorId(actorId) {
  if (!ACTOR_ID_RE.test(String(actorId ?? ""))) throw new Error("INDEED_APIFY_ACTOR must be an Apify actor id like owner/actor.");
  const [owner, name] = actorId.split(/[~/]/, 2);
  return encodeURIComponent(owner) + "~" + encodeURIComponent(name);
}

export function normalizeFirecrawlResults(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const url = httpsUrl(item?.url);
      const title = text(item?.title);
      if (!url || !title) return null;
      return {
        id: url,
        title,
        company: hostOf(url),
        location: "",
        url,
        excerpt: text(item?.description || item?.markdown || item?.content).slice(0, 500),
        source: "firecrawl",
      };
    })
    .filter(Boolean);
}

export function normalizeIndeedItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const url = httpsUrl(item?.url || item?.jobUrl || item?.link || item?.applyUrl);
      const title = text(item?.title || item?.positionName || item?.jobTitle || item?.name);
      if (!url || !title) return null;
      return {
        id: url,
        title,
        company: text(item?.company || item?.companyName || item?.company_name) || "Indeed",
        location: text(item?.location || item?.formattedLocation || item?.jobLocation),
        url,
        excerpt: text(item?.description || item?.snippet || item?.jobDescription).slice(0, 500),
        source: "indeed",
      };
    })
    .filter(Boolean);
}

function httpsUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}