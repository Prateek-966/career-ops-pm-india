import { cn } from "@/lib/cn";
import {
  TRIAGE_BAND_LABELS,
  TRIAGE_CONFIDENCE_LABELS,
  type TriageBand,
  type TriageConfidence,
} from "@/lib/job-signals.mjs";

/**
 * The zero-token triage rank from prescore.mjs.
 *
 * ── Why this looks nothing like the fit score ─────────────────────────────
 *
 * Two numbers now appear against a role and they mean very different things:
 *
 *   the fit score (0-5)   a JUDGEMENT — Blocks A-G, evidence, PM dimensions.
 *                         Costs tokens. Rendered as a good/warn/bad Badge.
 *   the triage rank (0-100)  a SORT KEY — regex over a title, free, computed on
 *                         every row so the expensive one can be spent well.
 *
 * If they shared a visual register the cheap one would be read as the
 * considered one, which is the exact failure prescore.mjs is written to avoid.
 * So the triage rank deliberately does NOT use good/warn/bad — that register
 * stays reserved for the real score — and does not use brand orange either,
 * which badge.tsx reserves for active/selected.
 *
 * ── Colour encodes nothing ────────────────────────────────────────────────
 *
 * Magnitude is carried by ARC LENGTH and by the number itself; the hue is fixed
 * regardless of score. A red-to-green ramp would say "bad role / good role",
 * which a title-derived heuristic has not earned the right to say. A fixed hue
 * cannot miscommunicate, and it is colourblind-safe by construction because no
 * information is in the colour at all.
 *
 * ── Confidence is never dropped ───────────────────────────────────────────
 *
 * A title-only 100 and a full-JD 100 are different claims, so the tier is
 * always rendered or, in the compact variant, always in the accessible label.
 */

const RADIUS = 15.9155; // circumference = 100, so strokeDasharray maps 1:1 to %

export function TriageRing({
  score,
  band,
  confidence,
  className,
}: {
  score: number | null;
  band: TriageBand | null;
  confidence: TriageConfidence | null;
  className?: string;
}) {
  // Absent is absent. A missing score must not render as 0 — an unmeasured row
  // is not a bad one, and a 0 ring would say otherwise at a glance.
  if (score === null) return null;

  const bandLabel = band ? TRIAGE_BAND_LABELS[band] : "Unranked";
  const confLabel = confidence ? TRIAGE_CONFIDENCE_LABELS[confidence] : null;
  const label =
    `Triage rank ${score} of 100 — ${bandLabel}` +
    (confLabel ? `, ${confLabel}` : "") +
    ". A sort order, not a fit score.";

  return (
    <div className={cn("flex items-center gap-2", className)} title={label}>
      <svg viewBox="0 0 36 36" className="size-9 shrink-0 -rotate-90" role="img" aria-label={label}>
        <circle
          cx="18" cy="18" r={RADIUS} fill="none"
          className="stroke-border" strokeWidth="3"
        />
        <circle
          cx="18" cy="18" r={RADIUS} fill="none"
          className="stroke-sky-500 dark:stroke-sky-400"
          strokeWidth="3"
          strokeDasharray={`${score} 100`}
          strokeLinecap="round"
        />
      </svg>
      <div className="min-w-0 leading-tight">
        {/* The number is text, never colour-alone, and tabular so a column of
            them stays aligned. */}
        <div className="text-sm font-semibold tabular-nums text-foreground">{score}</div>
        <div className="truncate text-[11px] text-faint">{bandLabel}</div>
      </div>
    </div>
  );
}

/**
 * Dense-row variant: number + band, no ring. Same rules — colour carries
 * nothing, confidence lives in the accessible label.
 */
export function TriageBadge({
  score,
  band,
  confidence,
  className,
}: {
  score: number | null;
  band: TriageBand | null;
  confidence: TriageConfidence | null;
  className?: string;
}) {
  if (score === null) return null;
  const bandLabel = band ? TRIAGE_BAND_LABELS[band] : "Unranked";
  const confLabel = confidence ? TRIAGE_CONFIDENCE_LABELS[confidence] : null;
  const label =
    `Triage rank ${score} of 100 — ${bandLabel}` +
    (confLabel ? `, ${confLabel}` : "") +
    ". A sort order, not a fit score.";

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5",
        "text-xs text-muted",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-block size-1.5 rounded-full bg-sky-500 dark:bg-sky-400"
      />
      <span className="font-semibold tabular-nums text-foreground">{score}</span>
      <span className="text-faint">{bandLabel}</span>
    </span>
  );
}
