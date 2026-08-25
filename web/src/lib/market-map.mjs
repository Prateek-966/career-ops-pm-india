// market-map.mjs — MIRROR of the repo-root market-map.mjs (PRD v2 §B7).
//
// DO NOT EDIT ONE SIDE ONLY. The web app cannot import the core module at
// build time: Turbopack's root is pinned to web/ and refuses modules outside
// it (web/next.config.mjs; same constraint documented in
// web/src/lib/tracker-table.mjs and web/src/lib/profile-keywords.mjs). So the
// logic is mirrored here, and tests/market-map-parity.test.mjs — which runs in
// the ROOT suite, the required check — freezes the two together on both the
// phrase tables and the normalized output.
//
// Everything below this header is a verbatim copy of the root module. When you
// change one, change the other in the same commit; the parity test will fail
// the build if you do not.

/** Market ids this module can return, plus the sentinel. */
export const MARKET_IDS = ['india', 'uk_eu', 'gulf'];
export const UNKNOWN_MARKET = 'unknown';

/**
 * Human labels, so a UI never has to invent one from the id. Kept here rather
 * than in config/profile.yml's `markets:` block because the sentinel needs a
 * label too and it has no config entry to carry one.
 */
export const MARKET_LABELS = {
  india: 'India',
  uk_eu: 'UK / EU',
  gulf: 'Gulf',
  [UNKNOWN_MARKET]: 'Unknown market',
};

// Phrases are listed longest-first within each market so that a more specific
// phrase wins over a shorter one it contains ("delhi ncr" before "delhi").
// Order BETWEEN markets does not matter: COUNTRY_PHRASES is consulted before
// CITY_PHRASES, and within a tier the first market with a hit wins, which is
// safe because no phrase appears under two markets.

/**
 * Country / region terms. Checked FIRST — see rule 3 above.
 * @type {Record<string, string[]>}
 */
export const COUNTRY_PHRASES = {
  india: ['india', 'bharat', 'indien'],
  uk_eu: [
    'united kingdom', 'great britain', 'northern ireland', 'republic of ireland',
    'european union', 'uk', 'gb', 'britain', 'england', 'scotland', 'wales',
    'ireland', 'eire', 'netherlands', 'holland', 'germany', 'deutschland',
    'france', 'spain', 'portugal', 'italy', 'poland', 'sweden', 'denmark',
    'norway', 'finland', 'belgium', 'austria', 'switzerland', 'czechia',
    'romania', 'emea', 'europe', 'eu',
  ],
  gulf: [
    'united arab emirates', 'saudi arabia', 'ksa', 'uae', 'qatar', 'bahrain',
    'kuwait', 'oman', 'gcc',
  ],
};

/**
 * City / metro terms. Checked only when no country term matched.
 *
 * The India list carries both spellings of the renamed metros, because
 * postings use them interchangeably and a candidate filtering on "India" must
 * not lose a "Bangalore, KA" row to a "Bengaluru"-only list.
 * @type {Record<string, string[]>}
 */
export const CITY_PHRASES = {
  india: [
    'delhi ncr', 'new delhi', 'greater noida', 'navi mumbai',
    'bengaluru', 'bangalore', 'hyderabad', 'secunderabad', 'chennai', 'madras',
    'mumbai', 'bombay', 'pune', 'kolkata', 'calcutta', 'ahmedabad', 'gurugram',
    'gurgaon', 'noida', 'delhi', 'jaipur', 'kochi', 'cochin', 'coimbatore',
    'indore', 'chandigarh', 'trivandrum', 'thiruvananthapuram', 'bhubaneswar',
    'nagpur', 'vadodara', 'surat', 'mysuru', 'mysore', 'visakhapatnam',
  ],
  uk_eu: [
    'milton keynes', 'san sebastian',
    'london', 'manchester', 'birmingham', 'leeds', 'bristol', 'glasgow',
    'edinburgh', 'cambridge', 'oxford', 'reading', 'belfast', 'cardiff',
    'dublin', 'cork', 'amsterdam', 'rotterdam', 'utrecht', 'eindhoven',
    'berlin', 'munich', 'muenchen', 'hamburg', 'frankfurt', 'cologne',
    'koeln', 'stuttgart', 'paris', 'lyon', 'toulouse', 'madrid', 'barcelona',
    'valencia', 'lisbon', 'lisboa', 'porto', 'milan', 'milano', 'rome',
    'roma', 'warsaw', 'warszawa', 'krakow', 'stockholm', 'copenhagen',
    'oslo', 'helsinki', 'brussels', 'antwerp', 'vienna', 'wien', 'zurich',
    'zuerich', 'geneva', 'prague', 'praha', 'bucharest', 'budapest',
  ],
  gulf: [
    'abu dhabi', 'ras al khaimah',
    'dubai', 'sharjah', 'riyadh', 'jeddah', 'dammam', 'khobar', 'doha',
    'manama', 'kuwait city', 'muscat',
  ],
};

/**
 * Fold a raw location into a lowercase token list.
 *
 * Accent folding first, for the same reason role-matcher.mjs does it: an accent
 * otherwise acts as a separator and "Zürich" becomes ["z", "rich"], leaving a
 * phantom token no list covers. Only marks sitting on an ASCII Latin base are
 * stripped, so Devanagari matras in a Hindi-script location are left intact
 * rather than glued into one token.
 *
 * Every non-alphanumeric character is a separator, which is what makes
 * "Pune(Hybrid)", "Bangalore/Remote" and "Delhi-NCR" tokenize the same way as
 * their spaced spellings.
 *
 * @param {unknown} value Raw location, possibly not a string.
 * @returns {string[]} Lowercased tokens, in order, no empties.
 */
export function locationTokens(value) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/(?<=[a-z])\p{Mn}/gu, '')
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Does `tokens` contain `phrase`'s words consecutively?
 *
 * Phrase-over-tokens rather than substring-over-string: it gives whole-word
 * matching and multi-word places in one rule, so "uk" cannot fire inside
 * "Ukraine" and "Abu Dhabi" still matches across the space.
 *
 * @param {string[]} tokens
 * @param {string} phrase Lowercase, space-separated.
 * @returns {boolean}
 */
function hasPhrase(tokens, phrase) {
  const words = phrase.split(' ');
  if (words.length === 0) return false;
  outer: for (let i = 0; i + words.length <= tokens.length; i += 1) {
    for (let j = 0; j < words.length; j += 1) {
      if (tokens[i + j] !== words[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Normalize a free-text location to a market id.
 *
 * Handles the shapes the PRD names explicitly — "Bangalore", "Bengaluru",
 * "Bangalore, KA", "Pune (Hybrid)", "Remote - India" — and returns
 * `unknown` for anything else rather than guessing.
 *
 * An empty or missing location is `unknown` too, NOT a default market. A
 * posting with no location is exactly the case a human needs to look at, and
 * defaulting it to the home market would hide it in the bucket the candidate
 * scrolls past fastest.
 *
 * @param {unknown} location Free-text location from a posting or tracker row.
 * @returns {string} A member of MARKET_IDS, or UNKNOWN_MARKET.
 */
export function marketOf(location) {
  const tokens = locationTokens(location);
  if (tokens.length === 0) return UNKNOWN_MARKET;
  for (const tier of [COUNTRY_PHRASES, CITY_PHRASES]) {
    for (const id of MARKET_IDS) {
      const phrases = tier[id] || [];
      for (const phrase of phrases) {
        if (hasPhrase(tokens, phrase)) return id;
      }
    }
  }
  return UNKNOWN_MARKET;
}

/**
 * Display label for a market id, including the sentinel and any id this module
 * does not know (which renders as itself rather than throwing — a UI must not
 * crash on a tracker note someone hand-edited).
 *
 * @param {string} id
 * @returns {string}
 */
export function marketLabel(id) {
  return MARKET_LABELS[id] || String(id ?? UNKNOWN_MARKET);
}
