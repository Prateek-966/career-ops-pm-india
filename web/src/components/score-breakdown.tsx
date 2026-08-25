import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { CompanyTypeBadge } from "@/components/signal-badges";
import type { CompanyType } from "@/lib/job-signals.mjs";
import { parsePmDimensions, machineSummaryField, type DimensionValue } from "@/lib/pm-dimensions.mjs";

/**
 * The score surface (PRD v2 Part C item 5) — where the design budget goes.
 *
 * "This is the decision moment the whole pipeline exists to produce. A bare
 * 1–5 under-serves it: show the dimensional breakdown so the score is
 * inspectable and the candidate can disagree with it."
 *
 * So the panel is built to be ARGUED WITH, not admired. Three consequences:
 *
 *   - Every numeric dimension shows its bar AND its number. A bar alone is a
 *     mood; the number is what you disagree with.
 *   - "Not stated" is rendered explicitly and quietly, never as a zero and
 *     never as a mid-scale default. The rubric is emphatic that an absent
 *     signal is a finding, and a 3-shaped bar for "the JD does not say" is a
 *     fabricated data point on the one screen that must not have any.
 *   - The transferability gap gets its own full-width row at the bottom, in
 *     prose. It is the sentence the candidate has to answer in an interview,
 *     and squeezing it into a table cell buries the most actionable thing here.
 *
 * Everything else on the page stays quiet, per Part C.
 */

const SCALE = [1, 2, 3, 4, 5];

function DimensionRow({ d }: { d: DimensionValue }) {
  const stated = d.score != null || (d.text != null && d.text !== "");
  return (
    <div className="grid grid-cols-[minmax(9rem,1.1fr)_minmax(0,1.4fr)] items-baseline gap-x-4 gap-y-1 py-2.5">
      <div className="min-w-0">
        <p className={cn("text-sm font-medium", !stated && "text-muted")}>{d.label}</p>
        <p className="mt-0.5 text-xs leading-snug text-faint">{d.hint}</p>
      </div>

      <div className="min-w-0">
        {d.score != null ? (
          <div className="flex items-center gap-2.5">
            {/* Discrete pips, not a continuous bar: the rubric scores 1-5, and a
                smooth bar invites reading 3.5 out of a scale that has no 3.5. */}
            <div className="flex gap-1" aria-hidden="true">
              {SCALE.map((n) => (
                <span
                  key={n}
                  className={cn(
                    "h-1.5 w-5 rounded-full transition-colors",
                    n <= Math.round(d.score as number) ? "bg-brand" : "bg-surface-hover",
                  )}
                />
              ))}
            </div>
            <span className="text-sm font-semibold tabular-nums">{d.score}</span>
            <span className="sr-only">out of 5</span>
          </div>
        ) : d.text ? (
          <p className="text-sm">{d.text}</p>
        ) : (
          <p className="text-sm text-faint italic">Not stated in the posting</p>
        )}
      </div>
    </div>
  );
}

export function ScoreBreakdown({ report, className }: { report: string | null; className?: string }) {
  if (!report) return null;

  const dims = parsePmDimensions(report);
  const companyTypeRaw = machineSummaryField(report, "company_type").toLowerCase();
  const companyType = (["gcc", "product", "unclear"].includes(companyTypeRaw)
    ? companyTypeRaw
    : null) as CompanyType | null;
  const evidence = machineSummaryField(report, "company_type_evidence");

  // Nothing to show for a report written before the rubric override, or one
  // whose fence the model omitted. Rendering an empty panel would imply the
  // evaluation considered these dimensions and found nothing.
  if (dims.length === 0 && !companyType) return null;

  const gap = dims.find((d) => d.key === "transferability_gap");
  const rows = dims.filter((d) => d.key !== "transferability_gap");
  const scored = rows.filter((d) => d.score != null).length;

  return (
    <section className={cn("rounded-2xl border border-border bg-surface/40 p-5", className)}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg tracking-tight">Why this score</h2>
          <p className="mt-0.5 text-xs text-faint">
            PM rubric dimensions from this evaluation. Disagree with a row and the score is wrong —
            say so, and it gets re-run.
          </p>
        </div>
        {companyType && (
          <div className="flex items-center gap-2">
            <CompanyTypeBadge companyType={companyType} />
            {companyType !== "unclear" && (
              <span className="text-xs text-faint">does not affect the score</span>
            )}
          </div>
        )}
      </header>

      {/* The GCC evidence line. Shown for every classification, not only the
          unclear one: a `product` label backed by a phrase you can read is a
          different thing from one you have to take on trust. */}
      {companyType && evidence && (
        <p
          className={cn(
            "mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed",
            companyType === "unclear"
              ? "border border-dashed border-amber-500/50 text-amber-700 dark:text-amber-400"
              : "bg-surface-hover text-muted",
          )}
        >
          {companyType === "unclear" ? "Check this before you rely on it: " : "Evidence: "}
          {evidence}
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className="mt-2 divide-y divide-border">
            {rows.map((d) => (
              <DimensionRow key={d.key} d={d} />
            ))}
          </div>
          <p className="mt-3 text-xs text-faint">
            <span className="tabular-nums">{scored}</span> of{" "}
            <span className="tabular-nums">{rows.length}</span> dimensions carry a number; the rest are
            categorical or the posting did not say.
          </p>
        </>
      )}

      {gap && gap.text && (
        <div className="mt-4 rounded-lg border border-border bg-surface-hover/60 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Gap to argue past</p>
          <p className="mt-1 text-sm leading-relaxed">{gap.text}</p>
        </div>
      )}
    </section>
  );
}

/**
 * Compensation, native currency first (PRD Part C item 4).
 *
 * The INR equivalent is secondary, smaller, and always carries the date of the
 * rate that produced it. When no rate is available it shows NOTHING — a stale
 * figure is worse than an absent one, and this is a number someone might
 * negotiate against.
 *
 * There is no conversion in this component and there must never be one in a
 * scoring path: silent FX inside a fit score is a correctness bug (PRD §B7).
 */
export function Compensation({
  native,
  inr,
  rateDate,
  className,
}: {
  /** The posting's own figure, verbatim, in its own currency. */
  native: string | null;
  /** Pre-computed INR equivalent, or null when no rate was available. */
  inr?: string | null;
  /** Date of the rate used for `inr`. Required for `inr` to render at all. */
  rateDate?: string | null;
  className?: string;
}) {
  if (!native) return null;
  const showInr = Boolean(inr && rateDate);
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2", className)}>
      <span className="text-sm font-medium">{native}</span>
      {showInr && (
        <span className="text-xs text-faint">
          ≈ {inr} <span className="opacity-70">· rate {rateDate}</span>
        </span>
      )}
    </span>
  );
}

export function ScoreHeadline({ score, tone }: { score: string; tone: "good" | "warn" | "bad" | "info" | "muted" }) {
  return <Badge tone={tone}>{score}</Badge>;
}
