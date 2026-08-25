// tests/market-map-parity.test.mjs — web/src/lib/market-map.mjs must agree with
// the repo-root market-map.mjs (PRD v2 §B7).
//
// The web app cannot import the core module at build time: Turbopack's root is
// pinned to web/ and refuses modules outside it (web/next.config.mjs). So the
// web carries a mirror — and a mirror is exactly the thing that drifts. The
// repo has already paid for that once: tests/profile-keywords-parity.test.mjs
// exists because web/ carried a copy of the keyword logic and the copy was
// wrong.
//
// This guard lives in the ROOT suite, not web/tests/, for the same two reasons
// the profile-keywords guard does: web-ci.yml runs `npm ci` inside web/ only,
// and .github/workflows/test.yml (which runs test-all.mjs) is the required
// check.
//
// What is frozen, and why both halves are needed:
//
//   1. The phrase TABLES, compared as sets. Catches a city added to one side
//      only — the common drift, and one that behaviour-testing a fixed corpus
//      would miss entirely, because a corpus written today cannot contain a
//      city someone adds next month.
//
//   2. The normalized OUTPUT over a corpus. Catches a change to the matching
//      rules themselves (tokenizer, country-before-city precedence, phrase vs
//      substring) that leaves the tables identical. The corpus is built FROM
//      the tables, so it grows automatically as they do, plus the literal
//      shapes the PRD names as required behaviour.

import { pass, fail, warn, ROOT } from './helpers.mjs';
import { existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import * as core from '../market-map.mjs';

console.log('\nmarket-map — web mirror vs core module');

// web/ is NOT in update-system.mjs's SYSTEM_PATHS but tests/ is, so this file
// ships to installs whose checkout has no web/ at all — and a static import
// cannot be skipped, so it would turn a core-only install into a permanent
// failure. Three branches, exactly as the profile-keywords guard: an absent
// web/ is a real absence, but a mirror missing under a present web/ is a move,
// and a silent skip is how a parity freeze quietly stops guarding.
const WEB_MIRROR = join(ROOT, 'web', 'src', 'lib', 'market-map.mjs');
if (!existsSync(join(ROOT, 'web', 'src'))) {
  warn('web/ not present in this checkout — skipping the market-map parity check');
} else if (!existsSync(WEB_MIRROR)) {
  fail('web/ exists but web/src/lib/market-map.mjs is missing — the parity check cannot verify (moved?)');
} else {
  const web = await import(pathToFileURL(WEB_MIRROR).href);

  // ---- 1. Tables ---------------------------------------------------------
  const sameSet = (a, b) => {
    const A = new Set(a);
    const B = new Set(b);
    if (A.size !== B.size) return false;
    for (const v of A) if (!B.has(v)) return false;
    return true;
  };

  if (sameSet(core.MARKET_IDS, web.MARKET_IDS)) {
    pass(`MARKET_IDS match (${core.MARKET_IDS.length} markets)`);
  } else {
    fail(`MARKET_IDS drifted — core [${core.MARKET_IDS}] vs web [${web.MARKET_IDS}]`);
  }

  if (core.UNKNOWN_MARKET === web.UNKNOWN_MARKET) {
    pass(`UNKNOWN_MARKET sentinel matches ("${core.UNKNOWN_MARKET}")`);
  } else {
    fail(`UNKNOWN_MARKET drifted — core "${core.UNKNOWN_MARKET}" vs web "${web.UNKNOWN_MARKET}"`);
  }

  for (const [tierName, coreTier, webTier] of [
    ['COUNTRY_PHRASES', core.COUNTRY_PHRASES, web.COUNTRY_PHRASES],
    ['CITY_PHRASES', core.CITY_PHRASES, web.CITY_PHRASES],
  ]) {
    let tierOk = true;
    // Union of ids, so a market present on one side only is a failure rather
    // than an unvisited key.
    const ids = new Set([...Object.keys(coreTier), ...Object.keys(webTier)]);
    for (const id of ids) {
      if (!sameSet(coreTier[id] || [], webTier[id] || [])) {
        const c = new Set(coreTier[id] || []);
        const w = new Set(webTier[id] || []);
        const onlyCore = [...c].filter(v => !w.has(v));
        const onlyWeb = [...w].filter(v => !c.has(v));
        fail(`${tierName}.${id} drifted — core-only [${onlyCore}], web-only [${onlyWeb}]`);
        tierOk = false;
      }
    }
    if (tierOk) pass(`${tierName} match across ${ids.size} markets`);
  }

  const coreLabels = Object.keys(core.MARKET_LABELS).sort();
  if (sameSet(coreLabels, Object.keys(web.MARKET_LABELS).sort())
    && coreLabels.every(k => core.MARKET_LABELS[k] === web.MARKET_LABELS[k])) {
    pass('MARKET_LABELS match');
  } else {
    fail('MARKET_LABELS drifted between core and web mirror');
  }

  // ---- 2. Behaviour ------------------------------------------------------
  // The corpus is derived from the tables, so it covers every phrase both
  // sides claim to know, in the decorated spellings real postings use. The
  // literal cases below it are the shapes PRD §B7 names by name, plus the
  // precedence and word-boundary rules the module header commits to.
  const corpus = [];
  for (const tier of [core.COUNTRY_PHRASES, core.CITY_PHRASES]) {
    for (const phrases of Object.values(tier)) {
      for (const p of phrases) {
        corpus.push(p, `${p}, XX`, `Remote - ${p}`, `${p} (Hybrid)`, p.toUpperCase());
      }
    }
  }
  corpus.push(
    'Bangalore', 'Bengaluru', 'Bangalore, KA', 'Pune (Hybrid)', 'Remote - India',
    'Remote (India) — reporting to London', 'Hyderabad/Bangalore', 'Delhi-NCR',
    'Zürich', 'Punexpected', 'Ukraine', 'San Francisco, CA', '', '   ',
  );

  let mismatches = 0;
  let firstMismatch = null;
  for (const c of corpus) {
    const a = core.marketOf(c);
    const b = web.marketOf(c);
    if (a !== b) {
      mismatches += 1;
      if (!firstMismatch) firstMismatch = `${JSON.stringify(c)} — core "${a}" vs web "${b}"`;
    }
  }
  if (mismatches === 0) {
    pass(`marketOf agrees on all ${corpus.length} corpus locations`);
  } else {
    fail(`marketOf drifted on ${mismatches}/${corpus.length} locations — first: ${firstMismatch}`);
  }

  // Non-string input must not throw on either side: the tracker's location
  // column is hand-edited markdown and reaches this function as whatever the
  // parser produced.
  let threw = null;
  for (const v of [null, undefined, 42, {}, []]) {
    for (const [side, mod] of [['core', core], ['web', web]]) {
      try {
        const got = mod.marketOf(v);
        if (got !== core.UNKNOWN_MARKET) threw = `${side} returned "${got}" for ${JSON.stringify(v)}`;
      } catch (e) {
        threw = `${side} threw on ${JSON.stringify(v)}: ${e.message}`;
      }
    }
  }
  if (threw) fail(`non-string location mishandled — ${threw}`);
  else pass('non-string locations return the unknown sentinel on both sides, no throw');

  // The sentinel must never be a member of MARKET_IDS: a UI that renders the
  // filter tabs from MARKET_IDS and appends the unknown bucket separately
  // would otherwise show "Unknown market" twice.
  if (!core.MARKET_IDS.includes(core.UNKNOWN_MARKET) && !web.MARKET_IDS.includes(web.UNKNOWN_MARKET)) {
    pass('unknown sentinel is not a member of MARKET_IDS');
  } else {
    fail('unknown sentinel leaked into MARKET_IDS — the market filter would render it twice');
  }
}
