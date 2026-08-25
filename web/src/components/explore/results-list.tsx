"use client";

import { useMemo, useState } from "react";
import { Search, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DiscoveredOffer } from "@/lib/explore";
import { CostBadge } from "@/components/cost/cost-badge";
import { DiscoveryCard } from "./discovery-card";
import { useExplore } from "./explore-provider";
import { MarketFilter } from "@/components/market-filter";
import { jobSignals, countByMarket, marketLabel } from "@/lib/job-signals.mjs";

export type EnrichedOffer = DiscoveredOffer & { inPipeline: boolean; evaluatedN?: string };

export function ResultsList({ offers }: { offers: EnrichedOffer[] }) {
  const { companiesScanned, partial, addToPipeline, added, mode } = useExplore();
  const isAi = mode === "ai";
  const [sort, setSort] = useState<"fresh" | "company">("fresh");
  const [q, setQ] = useState("");
  // Explore is a transient result list, not a URL-addressable view like
  // /pipeline, so its market filter is local state rather than a query param.
  const [market, setMarket] = useState<string | null>(null);

  // Counts come from the search-filtered set but BEFORE the market filter, so
  // the other chips keep telling you what is there to switch to.
  const marketCounts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? offers.filter((o) => o.title.toLowerCase().includes(needle) || o.company.toLowerCase().includes(needle))
      : offers;
    return countByMarket(list);
  }, [offers, q]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = offers;
    if (needle) list = list.filter((o) => o.title.toLowerCase().includes(needle) || o.company.toLowerCase().includes(needle));
    if (market) list = list.filter((o) => jobSignals(o).market === market);
    const sorted = [...list].sort((a, b) =>
      sort === "fresh" ? (b.postedAt || "").localeCompare(a.postedAt || "") : a.company.localeCompare(b.company),
    );
    return sorted;
  }, [offers, q, sort, market]);

  const addable = offers.filter((o) => !o.inPipeline && !o.evaluatedN && !added.has(o.url));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-sm text-foreground">
            <span className="font-semibold">{offers.length}</span> {isAi ? `candidate${offers.length === 1 ? "" : "s"}` : `fresh role${offers.length === 1 ? "" : "s"}`}
            <CostBadge kind={isAi ? "spend" : "free-network"} size="xs" className="ml-2 align-middle" />
          </p>
          <p className="text-[12px] text-faint">
            {isAi
              ? "found by AI on the open web · unverified until you evaluate"
              : `${companiesScanned > 0 ? `${companiesScanned.toLocaleString()} companies scanned · ` : ""}0 tokens spent${partial ? " · some boards were unreachable (normal for public directories)" : ""}`}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface/40 px-2.5 py-1.5">
            <Search className="size-3.5 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter results…"
              className="w-32 bg-transparent text-[13px] outline-none placeholder:text-faint"
            />
          </div>
          <div className="inline-flex rounded-lg border border-border bg-surface/40 p-0.5 text-xs">
            {(["fresh", "company"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                className={cn("rounded-md px-2.5 py-1 font-medium capitalize transition-colors", sort === s ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground")}
              >
                {s}
              </button>
            ))}
          </div>
          {addable.length > 1 && (
            <button
              type="button"
              onClick={() => addToPipeline(addable)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/40 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-brand-soft hover:text-brand"
            >
              <Plus className="size-3.5" /> Add all {addable.length}
            </button>
          )}
        </div>
      </div>

      <MarketFilter value={market} counts={marketCounts} onChange={setMarket} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {view.map((o) => (
          <DiscoveryCard key={o.url} offer={o} inPipeline={o.inPipeline} evaluatedN={o.evaluatedN} />
        ))}
      </div>

      {view.length === 0 && (
        <p className="py-10 text-center text-sm text-faint">
          {market
            ? `No ${marketLabel(market)} roles in this scan. Add company tenants in Config → Portals, then scan again.`
            : `No results match “${q}”.`}
        </p>
      )}
    </div>
  );
}
