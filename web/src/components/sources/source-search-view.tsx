"use client";

import { FormEvent, useMemo, useState } from "react";
import { BriefcaseBusiness, CircleAlert, ExternalLink, Globe2, Loader2, Search, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { instrumentSerif } from "@/lib/fonts";
import { SOURCE_LABEL, type SourceId, type SourceResult, type SourceSearchResponse } from "@/lib/source-search-types";

type Tab = "all" | SourceId;
const SOURCE_IDS: SourceId[] = ["indeed", "firecrawl"];

export function SourceSearchView() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("India");
  const [domains, setDomains] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [sources, setSources] = useState<SourceSearchResponse[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const visible = useMemo(() => (tab === "all" ? sources : sources.filter((source) => source.source === tab)), [sources, tab]);
  const resultCount = visible.reduce((count, source) => count + source.results.length, 0);

  async function search(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/sources/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, location, domains }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Search failed.");
      setSources(data.sources || []);
      setTab("all");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed.");
      setSources([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <header className="mb-7">
        <div className="flex items-center gap-2.5">
          <Search className="size-6 text-brand" />
          <h1 className={cn(instrumentSerif.className, "text-3xl text-foreground")}>Sources</h1>
          <span className="rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-text">Private</span>
        </div>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-muted">
          Search your Indeed provider and Firecrawl&apos;s employer-career-site search side by side. Every result stays labeled with the connector that returned it.
        </p>
      </header>

      <form onSubmit={search} className="rounded-2xl border border-border bg-surface/30 p-5">
        <div className="grid gap-4 md:grid-cols-[1.3fr_.7fr]">
          <Field label="Role or keywords">
            <input value={query} onChange={(event) => setQuery(event.target.value)} required minLength={3} maxLength={200} placeholder="Product manager, AI strategy" className={inputClass} />
          </Field>
          <Field label="Location">
            <input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={120} placeholder="India, Remote, Bengaluru" className={inputClass} />
          </Field>
        </div>
        <Field label="Employer career-site domains for Firecrawl" hint="Comma separated. Firecrawl runs only against the employer sites you choose; Indeed runs through your configured Apify actor.">
          <input value={domains} onChange={(event) => setDomains(event.target.value)} placeholder="careers.acme.com, jobs.example.org" className={inputClass} />
        </Field>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={loading || query.trim().length < 3} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:brightness-110 disabled:opacity-50">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            {loading ? "Searching both sources…" : "Search sources"}
          </button>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted"><ShieldCheck className="size-3.5 text-emerald-500" /> Firecrawl stays domain-scoped; no open-web crawl.</span>
        </div>
      </form>

      {error && <div className="mt-5 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"><CircleAlert className="size-4 shrink-0" />{error}</div>}

      {sources.length > 0 && (
        <section className="mt-7">
          <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
            <TabButton active={tab === "all"} onClick={() => setTab("all")} label={"All sources (" + sources.reduce((count, source) => count + source.results.length, 0) + ")"} />
            {SOURCE_IDS.map((source) => {
              const state = sources.find((item) => item.source === source);
              return <TabButton key={source} active={tab === source} onClick={() => setTab(source)} label={SOURCE_LABEL[source] + " (" + (state?.results.length || 0) + ")"} />;
            })}
          </div>
          <p className="mt-3 text-xs text-faint">{resultCount} visible result{resultCount === 1 ? "" : "s"}. Each tab reports its connector&apos;s real execution state.</p>
          <div className="mt-4 space-y-4">
            {visible.map((source) => <SourcePanel key={source.source} source={source} />)}
          </div>
        </section>
      )}
    </div>
  );
}

const inputClass = "mt-1.5 w-full rounded-xl border border-border bg-surface/60 px-3.5 py-2.5 text-sm text-foreground outline-none transition placeholder:text-faint focus:border-brand/50";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="mb-4 block text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}{children}{hint && <span className="mt-1.5 block normal-case tracking-normal text-[11px] font-normal leading-relaxed text-faint">{hint}</span>}</label>;
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button type="button" onClick={onClick} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition", active ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-hover hover:text-foreground")}>{label}</button>;
}

function SourcePanel({ source }: { source: SourceSearchResponse }) {
  const icon = source.source === "indeed" ? <BriefcaseBusiness className="size-4" /> : <Globe2 className="size-4" />;
  if (source.status !== "ok") {
    return <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4"><div className="flex items-center gap-2 text-sm font-medium text-foreground">{icon} {source.label} <span className="ml-auto rounded-full border border-amber-500/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">{source.status.replace("-", " ")}</span></div><p className="mt-2 text-sm text-muted">{source.message}</p></div>;
  }
  return <div className="rounded-xl border border-border bg-surface/30"><div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium text-foreground">{icon} {source.label}<span className="ml-auto text-xs font-normal text-faint">{source.results.length} returned</span></div>{source.results.length === 0 ? <p className="p-4 text-sm text-muted">This connector ran successfully but found no matching results.</p> : <div className="divide-y divide-border">{source.results.map((result) => <ResultCard key={result.id} result={result} />)}</div>}</div>;
}

function ResultCard({ result }: { result: SourceResult }) {
  return <article className="p-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><a href={result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground hover:text-brand hover:underline">{result.title}<ExternalLink className="size-3.5" /></a><p className="mt-1 text-sm text-muted">{result.company}{result.location ? " · " + result.location : ""}</p>{result.excerpt && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-faint">{result.excerpt}</p>}</div><span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">{SOURCE_LABEL[result.source]}</span></div></article>;
}