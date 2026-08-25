#!/usr/bin/env node

/**
 * outreach-draft.mjs — validate and record a hiring-contact outreach email.
 *
 * ── The one thing this file exists to prevent ─────────────────────────────
 *
 * An outreach email is the only artifact in this whole system that reaches a
 * real person, under the candidate's name, irreversibly. A tailored CV can be
 * regenerated; a sent email cannot be unsent. Everything below is arranged
 * around that asymmetry.
 *
 * **This script never sends anything, and neither does any mode that calls it.**
 * It validates a draft and records it. The send is a human pressing send in
 * their own mail client. `modes/email.md` line 15 has said "Never submit. Never
 * send email. Never click send." since long before this file existed; creating a
 * Gmail *draft* is compatible with that rule, and calling Gmail's send is not.
 * `tests/outreach-guards.test.mjs` enforces the distinction.
 *
 * ── The four gates ────────────────────────────────────────────────────────
 *
 * 1. `cv.md` must exist. Without it there is no ground truth, and a generated
 *    "why you should hire me" is invention aimed at a hiring manager.
 *
 * 2. Every number in the body must appear in `cv.md`. This is the same rule
 *    `negotiation-roi.mjs` applies to salary anchors, for the same reason: a
 *    figure that cannot be traced is a figure that was made up, and the reader
 *    has no way to tell. Rephrase or drop it — do not "approximately" it.
 *
 * 3. The contact's email must carry a `source_url`: a page where the company
 *    actually published it. Guessed `firstname.lastname@` patterns bounce, harm
 *    the sender's reputation, and are the mechanism by which outreach becomes
 *    spam. If you cannot point at where you found it, you did not find it.
 *
 * 4. One draft per contact per role. Re-running is idempotent rather than
 *    additive, so an automation loop cannot turn into a repeat mailing.
 *
 * Usage:
 *   node outreach-draft.mjs payload.json
 *   node outreach-draft.mjs --stdin
 *   node outreach-draft.mjs --stdin --dry-run    # validate, write nothing
 *   node outreach-draft.mjs --help
 *
 * Payload:
 *   {
 *     "tracker": "042",
 *     "company": "Acme",
 *     "role":    "Senior Product Manager",
 *     "contact": {
 *       "name":  "Priya Sharma",
 *       "title": "Director of Product",
 *       "type":  "hiring-manager",
 *       "email": "priya.sharma@acme.com",
 *       "source_url": "https://acme.com/about/leadership",
 *       "linkedin": "linkedin.com/in/..."
 *     },
 *     "subject": "...",
 *     "body":    "..."
 *   }
 *
 * On success prints `{ ok: true, draft: { to, subject, body }, ... }` — the
 * `draft` object is what the caller hands to Gmail's create_draft, and nothing
 * else.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CV_PATH = join(ROOT, 'cv.md');
const CONTACTS_PATH = join(ROOT, 'data/contacts.tsv');
const OUTREACH_LOG = join(ROOT, 'data/outreach-log.tsv');

/** contacto.md's taxonomy, mirrored by contacts.mjs. */
const CONTACT_TYPES = ['recruiter', 'hiring-manager', 'peer', 'interviewer', 'other'];

const USAGE = `outreach-draft.mjs — validate and record a hiring-contact outreach email

Usage:
  node outreach-draft.mjs <payload.json> [--dry-run]
  node outreach-draft.mjs --stdin [--dry-run]
  node outreach-draft.mjs --help

Validates the draft against cv.md, records the contact and the outreach, and
prints the { to, subject, body } payload for a Gmail DRAFT.

It never sends. The send is a human action.`;

/**
 * Numeric claims in a piece of prose.
 *
 * Deliberately broad: percentages, plain integers, decimals, and figures with a
 * scale suffix (k, L, Cr, M, B, x). A false positive costs one rephrase; a false
 * negative puts an invented number in front of a hiring manager.
 *
 * Ordinals and a bare four-digit year are excluded — "3rd" and "2019" carry no
 * magnitude claim on their own, and a date that matters ("at Acme since 2019")
 * is in cv.md anyway, so it passes the trace check rather than needing an
 * exemption.
 *
 * @param {string} text
 * @returns {string[]} Normalized numeric tokens, de-duplicated, in order.
 */
export function numericClaims(text) {
  const out = [];
  const seen = new Set();
  // Trailing guard is a negative lookahead, NOT `\b`. After a `%` the position
  // sits between two non-word characters, where `\b` fails — so the engine
  // backtracked, dropped the suffix, and read "40%" as a bare "40". That made
  // the CV's "40%" and the email's "40%" compare as different tokens in one
  // direction and identical in the other.
  //
  // Longest alternatives first: `l` before `lakh` would match the `l` and leave
  // "akh" behind.
  const re = /(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*(percent|lakhs|lakh|crores|crore|pp|cr|mn|bn|%|k|l|m|b|x)?(?![a-z0-9])/gi;
  for (const m of String(text ?? '').matchAll(re)) {
    const digits = m[1].replace(/,/g, '');
    const suffix = (m[2] || '').toLowerCase();
    // A bare 4-digit year with no unit is a date, not a magnitude.
    if (!suffix && /^\d{4}$/.test(digits)) {
      const n = Number(digits);
      if (n >= 1900 && n <= 2100) continue;
    }
    const token = suffix ? `${digits}${suffix}` : digits;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Does `claim` appear in the CV?
 *
 * Compares on digits-with-optional-suffix, so "40%" in the email matches
 * "40 %" or "40percent" in the CV, and "1,20,000" matches "120000". The point
 * is to catch invention, not to police formatting.
 *
 * @param {string} claim Normalized token from numericClaims.
 * @param {string[]} cvClaims Normalized tokens from the CV.
 * @returns {boolean}
 */
export function claimIsGrounded(claim, cvClaims) {
  if (cvClaims.includes(claim)) return true;
  // A bare number in the email is also satisfied by the same number carrying a
  // unit in the CV ("40" vs "40%"), because the CV is the more specific side.
  const bare = claim.replace(/[a-z%]+$/i, '');
  return cvClaims.some((c) => c === bare || c.replace(/[a-z%]+$/i, '') === bare);
}

/**
 * Validate a payload. Pure — no reads, no writes — so the gates are testable
 * without a CV or a contacts file on disk.
 *
 * @param {any} payload
 * @param {{cvText: string|null, existingLog: string}} ctx
 * @returns {{ok: true, warnings: string[]} | {ok: false, errors: string[], warnings: string[]}}
 */
export function validatePayload(payload, { cvText, existingLog = '' }) {
  const errors = [];
  const warnings = [];
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  // Gate 1 — ground truth must exist.
  if (!cvText) {
    errors.push(
      'cv.md is missing. Every claim in an outreach email has to trace to it, so there is nothing '
      + 'to write from. Add your CV as cv.md first (`node doctor.mjs` reports it).',
    );
  }

  const company = str(payload?.company);
  const role = str(payload?.role);
  const tracker = str(payload?.tracker);
  if (!company) errors.push('payload.company is required');
  if (!role) errors.push('payload.role is required');
  if (!tracker) errors.push('payload.tracker is required — the tracker row this outreach belongs to');

  const subject = str(payload?.subject);
  const body = str(payload?.body);
  if (!subject) errors.push('payload.subject is required');
  if (!body) errors.push('payload.body is required');

  // Gate 3 — the address must have a published source.
  const c = payload?.contact || {};
  const name = str(c.name);
  const email = str(c.email);
  const sourceUrl = str(c.source_url);
  const type = str(c.type) || 'other';

  if (!name) errors.push('contact.name is required — never address a stranger as "Hiring Manager" and call it outreach');
  if (!email) {
    errors.push('contact.email is required');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push(`contact.email is not a valid address: ${email}`);
  }
  if (!sourceUrl) {
    errors.push(
      'contact.source_url is required: the page where the company actually published this address. '
      + 'A guessed firstname.lastname@ pattern is how outreach becomes spam — if you cannot point at '
      + 'where you found it, you did not find it.',
    );
  } else if (!/^https?:\/\//i.test(sourceUrl)) {
    errors.push(`contact.source_url must be an http(s) URL: ${sourceUrl}`);
  }
  if (!CONTACT_TYPES.includes(type)) {
    errors.push(`contact.type must be one of ${CONTACT_TYPES.join(', ')} (got "${type}")`);
  }

  // A published address on a domain unrelated to both the company and the page
  // it came from is worth a second look, but it is legitimate often enough
  // (agency recruiters, personal domains) that it is a warning, not a block.
  if (email && sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
    try {
      const host = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, '');
      const emailDomain = email.split('@')[1].toLowerCase();
      const root = (h) => h.split('.').slice(-2).join('.');
      if (root(host) !== root(emailDomain)) {
        warnings.push(
          `the address is on ${emailDomain} but was found on ${host} — fine for an agency recruiter `
          + 'or a personal domain, worth re-checking otherwise',
        );
      }
    } catch { /* URL already validated above */ }
  }

  // Gate 2 — no untraceable numbers.
  if (cvText && body) {
    const cvClaims = numericClaims(cvText);
    const ungrounded = numericClaims(body).filter((n) => !claimIsGrounded(n, cvClaims));
    if (ungrounded.length > 0) {
      errors.push(
        `these numbers appear in the email but not in cv.md: ${ungrounded.join(', ')}. `
        + 'Every figure has to trace to the CV — rephrase or drop them. If one is the company\'s own '
        + 'figure quoted from the JD, say it qualitatively instead.',
      );
    }
  }

  // Gate 4 — one draft per contact per role.
  if (email && tracker && existingLog.includes(`\t${tracker}\t`) && existingLog.includes(email)) {
    for (const line of existingLog.split('\n')) {
      const cells = line.split('\t');
      if (cells[1] === tracker && cells[4] === email) {
        errors.push(
          `already drafted outreach to ${email} for tracker #${tracker} on ${cells[0]}. `
          + 'One approach per person per role — a second email is a follow-up, which belongs in '
          + '`data/follow-ups.md` via `node followup-cadence.mjs`, not here.',
        );
        break;
      }
    }
  }

  return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, warnings };
}

/**
 * The contacts.tsv line for this contact.
 * Schema (contacts.mjs): name, company, type, title, phone, email, linkedin, tracker#, notes
 * @param {any} payload
 * @returns {string}
 */
export function contactRow(payload) {
  const c = payload.contact || {};
  const cell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  return [
    cell(c.name),
    cell(payload.company),
    cell(c.type || 'other'),
    cell(c.title),
    '',                       // phone — outreach never collects one
    cell(c.email),
    cell(c.linkedin),
    cell(payload.tracker) || '-',
    cell(`found: ${c.source_url}`),
  ].join('\t');
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  const dryRun = args.includes('--dry-run');
  const useStdin = args.includes('--stdin');
  const fileArg = args.find((a) => !a.startsWith('-'));
  if (!useStdin && !fileArg) {
    console.error('outreach-draft: pass --stdin or a payload.json path. See --help.');
    return 2;
  }

  let payload;
  try {
    payload = JSON.parse(useStdin ? readFileSync(0, 'utf8') : readFileSync(fileArg, 'utf8'));
  } catch (e) {
    console.error(`outreach-draft: could not read/parse payload: ${e.message}`);
    return 2;
  }

  const cvText = existsSync(CV_PATH) ? readFileSync(CV_PATH, 'utf8') : null;
  const existingLog = existsSync(OUTREACH_LOG) ? readFileSync(OUTREACH_LOG, 'utf8') : '';

  const result = validatePayload(payload, { cvText, existingLog });
  if (!result.ok) {
    console.error('outreach-draft: refused — nothing was written.\n');
    for (const e of result.errors) console.error(`  ✗ ${e}\n`);
    for (const w of result.warnings) console.error(`  ! ${w}\n`);
    return 1;
  }

  const date = new Date().toISOString().slice(0, 10);

  if (!dryRun) {
    mkdirSync(dirname(CONTACTS_PATH), { recursive: true });
    if (!existsSync(CONTACTS_PATH)) {
      writeFileSync(CONTACTS_PATH, '# name\tcompany\ttype\ttitle\tphone\temail\tlinkedin\ttracker#\tnotes\n', 'utf8');
    }
    appendFileSync(CONTACTS_PATH, `${contactRow(payload)}\n`, 'utf8');

    if (!existsSync(OUTREACH_LOG)) {
      writeFileSync(OUTREACH_LOG, '# date\ttracker#\tcompany\trole\temail\tstatus\tsubject\n', 'utf8');
    }
    const cell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
    appendFileSync(OUTREACH_LOG, [
      date, cell(payload.tracker), cell(payload.company), cell(payload.role),
      cell(payload.contact.email), 'drafted', cell(payload.subject),
    ].join('\t') + '\n', 'utf8');
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun,
    warnings: result.warnings,
    // The ONLY thing that should be handed to Gmail, and it is a DRAFT.
    draft: {
      to: payload.contact.email,
      subject: payload.subject,
      body: payload.body,
    },
    recorded: dryRun ? null : { contacts: 'data/contacts.tsv', outreach: 'data/outreach-log.tsv' },
    nextSteps: [
      'Create the Gmail DRAFT from `draft` above — never send.',
      `node set-status.mjs ${payload.tracker} Applied --note "outreach drafted to ${payload.contact.email}"`,
      `node followup-seed.mjs   # pins the first follow-up date for #${payload.tracker}`,
      'Then review the draft in Gmail and press send yourself.',
    ],
  }, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv);
}

export { main, CONTACT_TYPES };
