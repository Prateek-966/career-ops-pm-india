// tests/prescore.test.mjs
//
// prescore.mjs ranks a large scan so the expensive evaluation can be spent on
// the top of the list. The failures worth guarding are not "wrong number" —
// it is a coarse heuristic and the number is allowed to be approximate. They
// are the two ways a triage list becomes actively misleading:
//
//   1. An ABSENT signal read as a NEGATIVE one, which buries good roles whose
//      title happens to be generic.
//   2. A LOW-INFORMATION row scoring higher than a well-understood one, which
//      puts what you know least about at the top.
//
// Both were real defects caught while building it, against the calibration set
// in evals/india-pm/. The assertions below are the regression tests for them.

import { pass, fail } from './helpers.mjs';
import {
  scoreRole, archetypeMatch, seniorityOf, yearsRequired,
  weightedAverage, bandFor, loadArchetypes,
} from '../prescore.mjs';

console.log('\n🎯 prescore — triage ranking');

const archetypes = loadArchetypes();
const LONG = 'x'.repeat(250);

// ── Defect 1: an absent domain word must not read as a bad domain ────────
{
  // "Lead Product Manager" (Nielsen) scored 4.5 in the 2026-08-26 calibration
  // run — the joint-best role in the set. It carries no domain word, so no
  // archetype matches. An early version scored that 42/100 "Low", burying the
  // best role. modes/_custom.md: a domain is "never auto-downgraded for being
  // unlisted".
  const generic = scoreRole({ title: 'Lead Product Manager', location: 'Bengaluru, India' }, { archetypes });
  const junior = scoreRole({ title: 'Associate Product Manager', location: 'Bengaluru, India' }, { archetypes });

  if (generic.score >= 60) pass(`a strong generic title is not buried (${generic.score}/100)`);
  else fail(`generic senior title scored ${generic.score} — an absent domain word is being read as a bad domain`);

  if (generic.score > junior.score) pass('a generic senior title outranks an explicitly junior one');
  else fail(`generic ${generic.score} did not outrank junior ${junior.score}`);

  if (generic.signals.some((s) => /not stated in the title/.test(s))) {
    pass('the missing archetype is disclosed rather than silently absorbed');
  } else {
    fail('a missing archetype must be named in the signals');
  }
}

// ── Defect 2: less information must mean less certainty ─────────────────
{
  // Before shrinkage, a bare "Senior Product Manager" hit a perfect 100:
  // the two available signals both maxed and there was nothing to average
  // against, so the row understood LEAST ranked above every row understood
  // well — backwards for a triage list.
  const bare = scoreRole({ title: 'Senior Product Manager', location: 'Pune, India' }, { archetypes });
  if (bare.score < 100) pass(`a two-signal row cannot score a perfect 100 (${bare.score}/100)`);
  else fail('a low-information row scored 100 — shrinkage is not applied');

  // Same inputs, but with the domain known: more information, and the score
  // should be free to move further from neutral.
  const known = scoreRole({ title: 'Senior Data Product Manager', location: 'Pune, India' }, { archetypes });
  if (known.score >= bare.score) pass('a row with a matched archetype is not penalised for having more signal');
  else fail(`known-domain ${known.score} scored below unknown-domain ${bare.score}`);
}

// ── weightedAverage: the shrinkage itself ────────────────────────────────
{
  if (weightedAverage([]) === 50) pass('no signals at all → neutral 50, not 0');
  else fail('an empty signal set must be neutral, not zero');

  const full = weightedAverage([{ norm: 1, weight: 100 }], 100);
  const half = weightedAverage([{ norm: 1, weight: 40 }], 100);
  if (full === 100) pass('full weight → full spread');
  else fail(`full weight gave ${full}`);
  if (half === 70) pass('40% of the weight → 40% of the distance from neutral (70)');
  else fail(`40% weight gave ${half}, expected 70`);

  const lowBad = weightedAverage([{ norm: 0, weight: 40 }], 100);
  if (lowBad === 30) pass('shrinkage is symmetric — bad scores are pulled up too');
  else fail(`symmetric shrinkage expected 30, got ${lowBad}`);
}

// ── The years bar — the calibration run's headline finding ──────────────
{
  if (yearsRequired('3+ years technical background. 9+ years of dedicated SaaS product management.') === 9) {
    pass('yearsRequired takes the HIGHEST bar, not the first');
  } else {
    fail('a soft opening bar must not mask the real one stated later');
  }
  if (yearsRequired('Celebrating 50 years of innovation. 5+ years PM experience.') === 5) {
    pass('company age is not mistaken for a requirement');
  } else {
    fail('an out-of-range number was read as a requirement');
  }
  if (yearsRequired('No years mentioned.') === null) pass('absent bar → null');
  else fail('absent bar must be null');

  // JFrog: evaluated 3.0 in the calibration run, blocked on 12+/6+ years
  // despite a primary-domain match. The triage must reach the same conclusion
  // and say why.
  const jfrog = scoreRole(
    { title: 'Senior Product Manager (Platform Access)', location: 'Bengaluru, India',
      description: `${LONG} 12+ years of industry experience with minimum 6+ years of Product Management experience.` },
    { archetypes, pmYears: 3.6 },
  );
  if (jfrog.signals.some((s) => /short by/.test(s))) pass('an over-bar years requirement is named in the signals');
  else fail('the years shortfall must be explicit, not folded silently into the number');

  const under = scoreRole(
    { title: 'Product Manager - Supply Chain', location: 'Bengaluru, India',
      description: `${LONG} 3-5 years of Product Management experience.` },
    { archetypes, pmYears: 3.6 },
  );
  if (under.score > jfrog.score) pass(`a clearable bar outranks an unclearable one (${under.score} > ${jfrog.score})`);
  else fail(`clearable ${under.score} did not outrank unclearable ${jfrog.score}`);

  // Without a declared pm_years the bar is reported, never guessed at.
  const noYears = scoreRole(
    { title: 'Senior Product Manager', location: 'Pune, India', description: `${LONG} 9+ years required.` },
    { archetypes },
  );
  if (noYears.signals.some((s) => /asks 9\+/.test(s)) && !noYears.signals.some((s) => /short by/.test(s))) {
    pass('with no declared pm_years the bar is reported, not judged');
  } else {
    fail('an undeclared pm_years must not produce a shortfall claim');
  }
}

// ── The non-role guard ───────────────────────────────────────────────────
{
  const rejected = scoreRole(
    { title: 'Warehouse Forklift Operator', location: 'Pune, India' },
    { archetypes, matchesTitle: () => false },
  );
  if (rejected.score === 0 && rejected.confidence === 'rejected') {
    pass('a title the filter rejects scores 0 — not "worth a look"');
  } else {
    fail(`filter-rejected title scored ${rejected.score}/${rejected.confidence}`);
  }

  const noFilter = scoreRole({ title: 'Senior Product Manager', location: 'Pune, India' }, { archetypes });
  if (noFilter.score > 0) pass('an absent title filter skips the check rather than zeroing everything');
  else fail('a missing portals.yml must not silently zero every score');
}

// ── Confidence is reported, never blended away ──────────────────────────
{
  const t = scoreRole({ title: 'Senior Product Manager', location: 'Pune, India' }, { archetypes });
  const f = scoreRole(
    { title: 'Senior Product Manager', location: 'Pune, India', description: `${LONG} 4+ years required.` },
    { archetypes, pmYears: 3.6 },
  );
  if (t.confidence === 'title-only' && f.confidence === 'full-jd') pass('the two confidence tiers are distinguishable');
  else fail(`confidence tiers wrong: ${t.confidence} / ${f.confidence}`);

  if (t.signals.some((s) => /title alone/.test(s))) pass('a title-only score says so in its signals');
  else fail('a title-only score must disclose that it is coarse');
}

// ── Bands are actions, not verdicts ─────────────────────────────────────
{
  if (bandFor(85).id === 'review_first' && bandFor(0).id === 'skip') pass('bands map to actions across the range');
  else fail('band mapping wrong');

  const labels = [bandFor(85), bandFor(60), bandFor(40), bandFor(10)].map((b) => b.label);
  // A band that reads as a fit verdict ("Excellent match") invites the number
  // to be treated as the decision. These are instructions for what to do next.
  if (!labels.some((l) => /match|fit|excellent|great/i.test(l))) {
    pass('no band label reads as a fit verdict — they name the next action');
  } else {
    fail(`a band label reads as a verdict: ${labels.join(', ')}`);
  }
}

// ── Seniority ordering ───────────────────────────────────────────────────
{
  const cases = [['Product Manager Intern', 'intern'], ['Associate Product Manager', 'entry'],
    ['Director of Product', 'exec'], ['Staff Product Manager', 'lead'],
    ['Senior Product Manager', 'senior'], ['Product Manager', 'mid']];
  let ok = 0;
  for (const [title, want] of cases) {
    if (seniorityOf(title).id === want) ok++;
    else fail(`seniorityOf(${title}) = ${seniorityOf(title).id}, expected ${want}`);
  }
  if (ok === cases.length) pass(`seniority detected correctly for all ${cases.length} title shapes`);

  // PwC's real posting title from the calibration set. Underscore is a WORD
  // character in JS regex, so \bassociate\b does not match "Associate_Product"
  // — this read as SENIOR until normalizeTitle was added, ranking the
  // consultancy row high when it should rank low.
  const pwc = 'IN_Senior Associate_Product Manager - AI Products__GCC_Advisory_Bangalore';
  if (seniorityOf(pwc).id === 'entry') {
    pass('an underscore-separated ATS title still boundary-matches ("Senior Associate" → entry)');
  } else {
    fail(`"Senior Associate" read as ${seniorityOf(pwc).id} — underscores are breaking word boundaries`);
  }
}

// ── archetypeMatch ───────────────────────────────────────────────────────
{
  if (archetypeMatch('Senior Data Product Manager', archetypes)?.fit === 'primary') pass('a primary archetype matches');
  else fail('primary archetype did not match');
  if (archetypeMatch('Warehouse Forklift Operator', archetypes) === null) pass('an unrelated title matches no archetype');
  else fail('an unrelated title matched an archetype');
}
