#!/usr/bin/env node

/**
 * setup-pm-india.mjs — install the PM/India configuration into the user layer.
 *
 * ── Why this script exists ────────────────────────────────────────────────
 *
 * PRD v2's Part A deliverables ARE user-layer files: `config/profile.yml`,
 * `portals.yml`, `modes/_custom.md`. Those three are gitignored on purpose —
 * they hold a real person's targeting, comp expectations and contact details,
 * and `tests/user-layer-gitignored` fails the build if any of them becomes
 * committable. That guard is correct and this fork keeps it.
 *
 * But a gitignored file does not survive a fresh clone, and the PM archetype
 * ladder, the broad-positive title filter and the GCC rubric are real work that
 * has to. So the work lives in `templates/` (committed, no personal data) and
 * this script copies it into place (gitignored, personal).
 *
 * Same split the repo already uses for `config/profile.example.yml` and
 * `templates/portals.example.yml` — this is the PM/India edition of it.
 *
 * ── Safety ────────────────────────────────────────────────────────────────
 *
 * Never overwrites an existing file without `--force`. These are files a user
 * edits by hand for months; a setup command that clobbers them silently is a
 * data-loss bug. `--force` takes a `.bak` copy first.
 *
 * Usage:
 *   node scripts/setup-pm-india.mjs            # install what is missing
 *   node scripts/setup-pm-india.mjs --force    # overwrite, keeping .bak copies
 *   node scripts/setup-pm-india.mjs --dry-run
 *   npm run setup:pm-india
 */

import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * template → destination. Destination paths are exactly the ones
 * `node doctor.mjs` checks and every mode reads.
 */
const INSTALLS = [
  {
    from: 'templates/profile.pm-india.example.yml',
    to: 'config/profile.yml',
    note: 'PM archetype ladder, narrative, markets. Fill in the `candidate:` block.',
  },
  {
    from: 'templates/portals.pm-india.yml',
    to: 'portals.yml',
    note: 'Broad-positive PM title filter. Seed tenants with `npm run seed:india:write`.',
  },
  {
    from: 'modes/_custom.pm-india.template.md',
    to: 'modes/_custom.md',
    note: 'The PM rubric override, including the GCC-vs-product dimension.',
  },
  {
    from: 'templates/india-seed-companies.yml',
    to: 'config/india-seed-companies.yml',
    note: '149 India-hiring companies. Grow it with `npm run add-company`.',
  },
  {
    from: 'templates/story-bank-pm-template.md',
    to: 'interview-prep/story-bank.md',
    note: 'PM-shaped STAR scaffold. Every field is _TODO_ until you write it.',
  },
];

const USAGE = `setup-pm-india.mjs — install the PM/India config into the user layer

Usage:
  node scripts/setup-pm-india.mjs [--force] [--dry-run]
  node scripts/setup-pm-india.mjs --help

Copies the committed templates to the gitignored paths the CLI actually reads.
Existing files are kept unless --force is given (which writes a .bak first).`;

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');

  let installed = 0;
  let kept = 0;
  let missingTemplate = 0;

  for (const { from, to, note } of INSTALLS) {
    const src = join(ROOT, from);
    const dest = join(ROOT, to);

    if (!existsSync(src)) {
      console.error(`✗ ${to} — template missing at ${from}`);
      missingTemplate += 1;
      continue;
    }

    if (existsSync(dest) && !force) {
      console.log(`= ${to} — already exists, left alone`);
      kept += 1;
      continue;
    }

    if (dryRun) {
      console.log(`+ ${to} — would install from ${from}`);
      installed += 1;
      continue;
    }

    mkdirSync(dirname(dest), { recursive: true });
    if (existsSync(dest) && force) {
      copyFileSync(dest, `${dest}.bak`);
      console.log(`  (kept your previous version at ${to}.bak)`);
    }
    copyFileSync(src, dest);
    console.log(`+ ${to} — ${note}`);
    installed += 1;
  }

  console.log(
    `\n${dryRun ? 'Would install' : 'Installed'} ${installed}, kept ${kept}`
    + (missingTemplate ? `, ${missingTemplate} template(s) missing` : ''),
  );

  if (kept > 0 && !force) {
    console.log('Re-run with --force to overwrite the kept files (a .bak is written first).');
  }

  if (!dryRun && missingTemplate === 0) {
    console.log(
      '\nNext:\n'
      + '  1. Add your CV as cv.md, and fill the `candidate:` block in config/profile.yml\n'
      + '  2. node doctor.mjs              # confirms setup is complete\n'
      + '  3. npm run seed:india:write     # detect ATS tenants for the seed companies\n'
      + '  4. npm run validate:portals && npm run verify:portals\n'
      + '  5. npm run scan                 # or run modes/india-scan.md for the Indeed tier',
    );
  }

  return missingTemplate > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv);
}

export { main, INSTALLS };
