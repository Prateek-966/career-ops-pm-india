"use client";

import { cn } from "@/lib/cn";
import { MARKET_IDS, marketLabel, UNKNOWN_MARKET } from "@/lib/market-map.mjs";

/**
 * Market filter for /pipeline and /explore (PRD v2 Part C item 1).
 *
 * Deliberately the same shape as the existing status tabs above it — one filter
 * row that looks like a different filter row is how an alpha app grows a second
 * visual identity.
 *
 * The `Unknown market` bucket is ALWAYS rendered, including at zero. That is the
 * whole point of it: PRD §B7 requires unmatched locations to be surfaced rather
 * than dropped, and a bucket that disappears when empty is indistinguishable
 * from one that silently swallows rows. At zero it reads as "nothing needs
 * attention", which is information too.
 */
export function MarketFilter({
  value,
  counts,
  onChange,
  className,
}: {
  /** Selected market id, or null for "All". */
  value: string | null;
  /** market id → row count, from countByMarket(). */
  counts: Record<string, number>;
  onChange: (market: string | null) => void;
  className?: string;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const buckets: Array<{ id: string | null; label: string; count: number }> = [
    { id: null, label: "All markets", count: total },
    ...MARKET_IDS.map((id: string) => ({ id, label: marketLabel(id), count: counts[id] || 0 })),
    { id: UNKNOWN_MARKET, label: marketLabel(UNKNOWN_MARKET), count: counts[UNKNOWN_MARKET] || 0 },
  ];

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} role="group" aria-label="Filter by market">
      {buckets.map((b) => {
        const active = value === b.id;
        const isUnknown = b.id === UNKNOWN_MARKET;
        return (
          <button
            key={b.id ?? "all"}
            type="button"
            onClick={() => onChange(active ? null : b.id)}
            aria-pressed={active}
            title={
              isUnknown
                ? "Postings whose location did not match a known market. Surfaced, never dropped — add the pattern to market-map.mjs."
                : undefined
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors max-sm:min-h-[36px]",
              active
                ? "border-brand/40 bg-brand-soft text-brand"
                : "border-border text-muted hover:text-foreground",
              // Dashed only when it holds something: an empty Unknown bucket has
              // nothing to chase, and a permanent dashed outline would train the
              // eye to ignore it by the time it does.
              isUnknown && !active && b.count > 0 && "border-dashed border-amber-500/50",
            )}
          >
            {b.label}
            <span className="text-faint tabular-nums">{b.count}</span>
          </button>
        );
      })}
    </div>
  );
}
