#!/usr/bin/env node

/**
 * add-company.mjs — turn one manual sighting into permanent automated coverage
 * (PRD v2 §B6).
 *
 * ── Why this is the highest-leverage thing in Part B ───────────────────────
 *
 * LinkedIn and Naukri stay manual surfaces: both prohibit automated access,
 * LinkedIn enforces it, and the risk lands on the personal account the job
 * search itself depends on. So no scraper, no Firecrawl proxy, no headless
 * session — a managed crawler does not change what a site's terms permit, it
 * just moves the request.
 *
 * What those surfaces ARE good for is hiring signal a human notices: who just
 * raised, who is building a PM function, who posted about a team they are
 * growing. This script is the conversion path for that signal. You browse as a
 * normal user, spot a company you have not seen, run one command, and every
 * FUTURE opening at that company arrives automatically through the ATS tier.
 *
 * One sighting, permanent coverage. That compounding is why the manual surfaces
 * are worth keeping in the workflow at all.
 *
 * ── What it does ──────────────────────────────────────────────────────────
 *
 *   1. Derives a company name (and website, when given a URL).
 *   2. Appends it to config/india-seed-companies.yml, unless already present.
 *   3. Runs discover-ats.mjs on it to detect the ATS.
 *   4. Tells you the exact next command.
 *
 * Step 2 is deliberately separate from step 3: the seed list is the durable
 * artifact. A company whose ATS cannot be detected today is not a dead end — it
 * is the Tier 3 input (PRD §B4, Firecrawl scoped to seed-list domains with no
 * detected ATS), and it stays on the list so a later re-run picks it up when
 * they migrate to a real ATS.
 *
 * Usage:
 *   node add-company.mjs "Acme Corp"
 *   node add-company.mjs https://acme.com/careers/senior-pm
 *   node add-company.mjs "Acme Corp" --website acme.com
 *   node add-company.mjs "Acme Corp" --no-probe    # list only, skip discovery
 *   node add-company.mjs --help
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import * as yaml from 'js-yaml';

const SEED_PATH = 'config/india-seed-companies.yml';

const USAGE = `add-company.mjs — one manual sighting -> permanent automated coverage (PRD v2 §B6)

Usage:
  node add-company.mjs "<Company Name>"
  node add-company.mjs <posting-or-careers-url>
  node add-company.mjs "<Company Name>" --website example.com
  node add-company.mjs "<Company Name>" --no-probe
  node add-company.mjs --help

Appends the company to ${SEED_PATH}, then probes it with discover-ats.mjs so
every future opening there arrives through the ATS tier automatically.

Paste a LinkedIn or Naukri POSTING URL and it will still work — the company
name is taken from your argument, and nothing fetches those sites.`;

// Hosts whose domain names an EMPLOYER, not the employer itself. A careers
// aggregator or an ATS is never the company, so deriving a name from one would
// seed the list with "Greenhouse" instead of the company hiring through it.
const NON_EMPLOYER_HOSTS = new Set([
  'linkedin.com', 'naukri.com', 'indeed.com', 'to.indeed.com', 'in.indeed.com',
  'glassdoor.com', 'glassdoor.co.in', 'monster.com', 'monsterindia.com',
  'shine.com', 'timesjobs.com', 'instahyre.com', 'cutshort.io', 'wellfound.com',
  'angel.co', 'ziprecruiter.com', 'simplyhired.com', 'foundit.in',
  'boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co',
  'jobs.ashbyhq.com', 'jobs.smartrecruiters.com', 'myworkdayjobs.com',
  'apply.workable.com', 'jobs.workable.com', 'breezy.hr', 'recruitee.com',
  'bamboohr.com', 'icims.com', 'taleo.net', 'successfactors.com',
]);

/**
 * Strip a leading `www.` and lowercase. Kept separate so both the
 * non-employer check and the stored website use the same spelling.
 * @param {string} host
 * @returns {string}
 */
export function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

/**
 * Is this host an aggregator/ATS rather than an employer's own domain?
 *
 * Matches on a suffix boundary so `acme.myworkdayjobs.com` is caught by the
 * `myworkdayjobs.com` entry, while a legitimate `notlinkedin.com` is not caught
 * by `linkedin.com`.
 *
 * @param {string} host
 * @returns {boolean}
 */
export function isNonEmployerHost(host) {
  const h = normalizeHost(host);
  if (!h) return false;
  for (const known of NON_EMPLOYER_HOSTS) {
    if (h === known || h.endsWith(`.${known}`)) return true;
  }
  return false;
}

/**
 * Derive `{name, website}` from a positional argument that may be a URL or a
 * plain company name.
 *
 * A URL on the employer's own domain yields both. A URL on an aggregator yields
 * neither — the caller must supply the name, because guessing "Linkedin" as the
 * employer is worse than asking.
 *
 * @param {string} input
 * @returns {{name: string|null, website: string|null, fromAggregator: boolean}}
 */
export function deriveCompany(input) {
  const raw = String(input || '').trim();
  if (!raw) return { name: null, website: null, fromAggregator: false };

  const looksLikeUrl = /^https?:\/\//i.test(raw);
  if (!looksLikeUrl) return { name: raw, website: null, fromAggregator: false };

  let host;
  try {
    host = normalizeHost(new URL(raw).hostname);
  } catch {
    return { name: null, website: null, fromAggregator: false };
  }

  if (isNonEmployerHost(host)) return { name: null, website: null, fromAggregator: true };

  // Employer domain: the registrable label is the best available name guess.
  // Title-cased rather than left lowercase because it lands in a YAML `name:`
  // a human will read — and discover-ats probes slugs, not this string.
  const labels = host.split('.').filter(Boolean);
  const label = labels.length > 2 && labels[0] !== 'careers' && labels[0] !== 'jobs'
    ? labels[0]
    : (labels.length > 2 ? labels[1] : labels[0]);
  const name = label
    ? label.split(/[-_]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
    : null;
  return { name, website: host, fromAggregator: false };
}

/**
 * Compare company names the way a human would: case-, punctuation- and
 * whitespace-insensitively. "Acme Corp." and "acme corp" are one company.
 * @param {unknown} name
 * @returns {string}
 */
export function companyKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/(?<=[a-z])\p{Mn}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Append a company to the seed YAML if absent.
 *
 * Text append rather than yaml.dump of the whole document, on purpose: the seed
 * file is a hand-maintained, heavily commented artifact and a round-trip through
 * js-yaml would strip every comment in it, including the "how to grow this list"
 * instructions that make it useful.
 *
 * @param {string} text Current file contents.
 * @param {{name: string, website?: string|null}} entry
 * @returns {{text: string, status: 'added'|'present'}}
 */
export function applyAddCompany(text, entry) {
  const doc = yaml.load(text) || {};
  const existing = Array.isArray(doc.companies) ? doc.companies : [];
  const key = companyKey(entry.name);
  if (existing.some(c => companyKey(c?.name) === key)) {
    return { text, status: 'present' };
  }
  const lines = [`  - name: ${JSON.stringify(entry.name)}`];
  if (entry.website) lines.push(`    website: ${entry.website}`);
  const block = `${lines.join('\n')}\n`;
  // Append at end of file: the list is one flat `companies:` sequence, and the
  // bucket comments are documentation for a reader, not parsed structure.
  const base = text.endsWith('\n') ? text : `${text}\n`;
  return { text: base + block, status: 'added' };
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return args.length === 0 ? 2 : 0;
  }

  const noProbe = args.includes('--no-probe');
  const websiteIdx = args.indexOf('--website');
  const websiteFlag = websiteIdx !== -1 ? args[websiteIdx + 1] : null;
  // Exclude the flag's OPERAND by index, but only when the flag is actually
  // present: with websiteIdx === -1, `websiteIdx + 1` is 0 and would silently
  // drop the first positional argument — i.e. the company name itself.
  const operandIdx = websiteIdx !== -1 ? websiteIdx + 1 : -1;
  const positional = args.filter((a, i) => !a.startsWith('--') && i !== operandIdx);
  const input = positional.join(' ').trim();

  const derived = deriveCompany(input);
  const name = derived.name;
  const website = websiteFlag ? normalizeHost(websiteFlag) : derived.website;

  if (!name) {
    if (derived.fromAggregator) {
      console.error(
        'add-company: that URL is an aggregator or ATS, so it does not name the employer.\n'
        + '  Pass the company name instead:  node add-company.mjs "Acme Corp"\n'
        + '  (Nothing was fetched — LinkedIn and Naukri are never requested by this tool.)',
      );
    } else {
      console.error('add-company: could not derive a company name. Pass one explicitly. See --help.');
    }
    return 2;
  }

  if (!existsSync(SEED_PATH)) {
    // The seed list is user-layer (gitignored — it records which companies you
    // are watching) and is installed from templates/ on setup. A missing file
    // means setup has not run, not that the list is empty.
    console.error(
      `add-company: ${SEED_PATH} not found.\n`
      + '  Run `npm run setup:pm-india` to install it from templates/, then try again.\n'
      + '  (If you are not in the repo root, cd there first.)',
    );
    return 2;
  }

  const before = readFileSync(SEED_PATH, 'utf8');
  let out;
  try {
    out = applyAddCompany(before, { name, website });
  } catch (e) {
    console.error(`add-company: ${SEED_PATH} could not be parsed: ${e.message}`);
    return 1;
  }

  if (out.status === 'present') {
    console.log(`= ${name} is already on the seed list (${SEED_PATH}).`);
  } else {
    writeFileSync(SEED_PATH, out.text, 'utf8');
    console.log(`+ Added ${name}${website ? ` (${website})` : ''} to ${SEED_PATH}.`);
  }

  if (noProbe) {
    console.log(`\nNext:  node discover-ats.mjs ${JSON.stringify(name)}`);
    return 0;
  }

  console.log(`\nProbing ${name} for a supported ATS…\n`);
  const probe = spawnSync(process.execPath, ['discover-ats.mjs', name, '--summary'], {
    stdio: 'inherit',
  });

  console.log(
    '\nNext:\n'
    + `  node discover-ats.mjs ${JSON.stringify(name)} --write   # add the tenant to portals.yml\n`
    + '  npm run validate:portals && npm run verify:portals\n'
    + '\nIf no ATS was detected, leave it on the seed list anyway — that is the\n'
    + 'Tier 3 (Firecrawl) input, and a re-probe will find it if they migrate.',
  );

  return probe.status === null ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv);
}

export { main };
