import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeActorId, normalizeFirecrawlResults, normalizeIndeedItems, parseDomains, parseSearchRequest } from "../../src/lib/source-search.mjs";

test("source search request bounds input and normalizes employer domains", () => {
  assert.deepEqual(parseSearchRequest({ query: "  product   manager ", location: " Bengaluru ", domains: "careers.acme.com, www.example.com", limit: 99 }), {
    query: "product manager",
    location: "Bengaluru",
    domains: ["careers.acme.com", "example.com"],
    limit: 25,
  });
});

test("source search rejects a too-short query and unsafe actor ids", () => {
  assert.throws(() => parseSearchRequest({ query: "AI" }), /at least three/i);
  assert.throws(() => normalizeActorId("owner/actor?token=nope"), /INDEED_APIFY_ACTOR/);
  assert.equal(normalizeActorId("owner/actor-name"), "owner~actor-name");
});

test("connector normalizers expose only https job URLs", () => {
  assert.deepEqual(normalizeFirecrawlResults([{ title: "PM", url: "https://jobs.example.com/1", description: "Details" }, { title: "Bad", url: "http://example.com" }]), [{
    id: "https://jobs.example.com/1",
    title: "PM",
    company: "jobs.example.com",
    location: "",
    url: "https://jobs.example.com/1",
    excerpt: "Details",
    source: "firecrawl",
  }]);
  assert.equal(normalizeIndeedItems([{ positionName: "Product Manager", url: "https://indeed.example/1", companyName: "Acme", formattedLocation: "India" }])[0].company, "Acme");
});