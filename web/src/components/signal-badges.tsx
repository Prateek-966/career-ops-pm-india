import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import {
  SOURCE_LABELS,
  COMPANY_TYPE_LABELS,
  type SourceTier,
  type CompanyType,
} from "@/lib/job-signals.mjs";

/**
 * Provenance. Coverage differs by tier, so the user needs to know where a role
 * came from — but it is a FACT, not a quality signal, so it is deliberately the
 * quietest thing on the card. All four tiers share one neutral tone: styling
 * Indeed differently from ATS would read as a ranking, and the ranking would be
 * wrong (a Firecrawl-found role at a company with no ATS is not a worse role).
 */
export function SourceBadge({ source, className }: { source: SourceTier | null; className?: string }) {
  if (!source) return null;
  return (
    <Badge tone="muted" className={cn("font-normal", className)} title={`Discovered via ${SOURCE_LABELS[source]}`}>
      {SOURCE_LABELS[source]}
    </Badge>
  );
}

/**
 * GCC / Product / Unclear — the highest-information label on the card for this
 * candidate, because an identically-titled PM role at a global capability
 * centre and at a product company are different jobs with different ceilings.
 *
 * Two deliberate choices:
 *
 *   1. GCC and Product share the neutral `info`/`muted` register rather than
 *      good/bad. This is a label, never a penalty — a strong GCC platform role
 *      can outrank a weak startup role, and colouring GCC red would encode the
 *      opposite of what the rubric says.
 *
 *   2. `Unclear` is the one that is visually distinct — a dashed outline, so it
 *      reads as unfinished rather than as a third category. It is a prompt to
 *      go and check, not a verdict, and it must not be mistakable for a settled
 *      answer.
 */
export function CompanyTypeBadge({
  companyType,
  className,
}: {
  companyType: CompanyType | null;
  className?: string;
}) {
  if (!companyType) return null;

  if (companyType === "unclear") {
    return (
      <span
        title="Could not tell a capability centre from a product company — check the posting before you rely on this."
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-dashed border-amber-500/60 px-1.5 py-0.5",
          "text-xs font-semibold text-amber-700 dark:text-amber-400",
          className,
        )}
      >
        {COMPANY_TYPE_LABELS.unclear}
        <span aria-hidden="true">?</span>
      </span>
    );
  }

  return (
    <Badge
      tone={companyType === "product" ? "info" : "muted"}
      className={className}
      title={
        companyType === "product"
          ? "Product company — the product is the business, so roadmap ownership is usually real."
          : "Global capability centre — scope is often delivery or regional, and the product is owned elsewhere. Not a penalty."
      }
    >
      {COMPANY_TYPE_LABELS[companyType]}
    </Badge>
  );
}

/**
 * The market a row was normalized into. Rendered only for the `unknown`
 * bucket in dense contexts — a known market is already implied by the filter
 * the user is standing in, while `unknown` is a call to extend market-map.mjs's
 * pattern list and therefore worth the pixels wherever it appears.
 */
export function UnknownMarketBadge({ market, className }: { market: string; className?: string }) {
  if (market !== "unknown") return null;
  return (
    <Badge
      tone="warn"
      className={cn("font-normal", className)}
      title="This posting's location did not match a known market. It is surfaced rather than dropped — add the pattern to market-map.mjs."
    >
      Unknown market
    </Badge>
  );
}
