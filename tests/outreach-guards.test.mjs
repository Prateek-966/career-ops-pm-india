// tests/outreach-guards.test.mjs — the rules that keep outreach from becoming
// a spam cannon or a fabrication engine.
//
// An outreach email is the only artifact this system produces that reaches a
// real person, under the candidate's name, irreversibly. A tailored CV can be
// regenerated; a sent email cannot be unsent. So the guards around it are
// asserted here rather than left to prose in a mode file that a future session
// might read past.
//
// Four things are frozen:
//
//   1. NO code path sends. `modes/email.md` has said "Never submit. Never send
//      email. Never click send." since long before this feature existed.
//      Creating a Gmail DRAFT is compatible with that rule; calling Gmail's
//      send is not, and the distinction is one autocomplete away from being
//      lost.
//   2. No cv.md, no draft. Without ground truth an outreach email is invention
//      aimed at a hiring manager.
//   3. No published source for an address, no draft. Guessed
//      firstname.lastname@ patterns are the mechanism by which outreach becomes
//      spam.
//   4. No untraceable numbers. The same rule negotiation-roi.mjs applies to
//      salary anchors, for the same reason: a figure the reader cannot check is
//      a figure that may have been invented.

import { pass, fail, ROOT } from './helpers.mjs';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { validatePayload, numericClaims, claimIsGrounded, contactRow } from '../outreach-draft.mjs';

console.log('\nOutreach guards — never send, never fabricate, never guess an address');

// ── 1. Nothing anywhere sends ─────────────────────────────────────────────

{
  // Walk the repo's own source, skipping vendored/generated trees and this
  // file. A hit is a real send path; the strings here are the Gmail MCP tool
  // names, which is what a caller would actually invoke.
  const SEND_TOOLS = ['Gmail__send_message', 'Gmail__reply', 'Gmail__forward'];
  const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'output', 'batch', 'data']);
  const CODE_EXT = new Set(['.mjs', '.js', '.ts', '.tsx', '.md']);

  /** @param {string} dir @param {string[]} out */
  const walk = (dir, out) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const p = join(dir, entry);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, out);
      else if (CODE_EXT.has(extname(entry))) out.push(p);
    }
    return out;
  };

  const files = walk(ROOT, []);
  const offenders = [];
  for (const f of files) {
    if (f.endsWith('outreach-guards.test.mjs')) continue; // this file names them
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const tool of SEND_TOOLS) {
      if (!text.includes(tool)) continue;
      // A prohibition is not a use. Lines that forbid the tool are the point.
      const offending = text.split('\n').filter((ln) => {
        if (!ln.includes(tool)) return false;
        return !/never|not\s|refus|forbid|prohibit|must not|do not|don't|instead of|rather than/i.test(ln);
      });
      if (offending.length > 0) offenders.push(`${f.slice(ROOT.length + 1)} → ${tool}`);
    }
  }

  if (offenders.length === 0) {
    pass(`no send path in ${files.length} source files — draft only`);
  } else {
    fail(`a Gmail SEND path exists: ${offenders.join(', ')} — outreach is draft-only, always`);
  }
}

{
  // The mode must name create_draft, or the "draft only" rule has no mechanism.
  const modePath = join(ROOT, 'modes', 'outreach.md');
  if (!existsSync(modePath)) {
    fail('modes/outreach.md is missing');
  } else {
    const mode = readFileSync(modePath, 'utf8');
    if (mode.includes('create_draft')) pass('modes/outreach.md routes through create_draft');
    else fail('modes/outreach.md does not name create_draft — the draft-only rule has no mechanism');
  }
}

// ── 2-4. The payload gates ────────────────────────────────────────────────

const CV = '# CV\n- Cut partner onboarding from 6 weeks to 5 days across 40 partners.\n- 8 years in enterprise B2B product.\n';

const base = () => ({
  tracker: '042',
  company: 'Acme',
  role: 'Senior Product Manager',
  contact: {
    name: 'Priya Sharma',
    title: 'Director of Product',
    type: 'hiring-manager',
    email: 'priya@acme.com',
    source_url: 'https://acme.com/about/leadership',
  },
  subject: 'Senior PM, platform',
  body: 'I cut partner onboarding from 6 weeks to 5 days across 40 partners, and I have 8 years in enterprise B2B product.',
});

const errorsFor = (mutate, cvText = CV, existingLog = '') => {
  const p = base();
  if (mutate) mutate(p);
  const r = validatePayload(p, { cvText, existingLog });
  return r.ok ? [] : r.errors;
};

{
  const r = validatePayload(base(), { cvText: CV, existingLog: '' });
  if (r.ok) pass('a fully grounded, fully sourced payload is accepted');
  else fail(`a valid payload was refused: ${r.errors.join(' | ')}`);
}

{
  const errs = errorsFor(null, null);
  if (errs.some((e) => e.includes('cv.md is missing'))) {
    pass('no cv.md → refused (no ground truth, so nothing may be claimed)');
  } else {
    fail('a draft was allowed with no cv.md — every claim would be invention');
  }
}

{
  const errs = errorsFor((p) => { delete p.contact.source_url; });
  if (errs.some((e) => e.includes('source_url is required'))) {
    pass('address with no published source → refused (no guessed patterns)');
  } else {
    fail('an address with no published source was accepted — this is how outreach becomes spam');
  }
}

{
  const errs = errorsFor((p) => { p.contact.source_url = 'found it on a spreadsheet'; });
  if (errs.some((e) => e.includes('must be an http(s) URL'))) {
    pass('a non-URL source is refused — "I have it somewhere" is not a source');
  } else {
    fail('a non-URL source_url was accepted');
  }
}

{
  const errs = errorsFor((p) => { p.body += ' We lifted activation 32% in the first quarter.'; });
  if (errs.some((e) => e.includes('32'))) {
    pass('an untraceable number → refused, and the number is named');
  } else {
    fail('a number absent from cv.md reached the draft — that is fabrication to a hiring manager');
  }
}

{
  const errs = errorsFor((p) => { delete p.contact.name; });
  if (errs.some((e) => e.includes('contact.name is required'))) {
    pass('no addressee → refused ("Hiring Manager" is a broadcast, not outreach)');
  } else {
    fail('a nameless addressee was accepted');
  }
}

{
  const errs = errorsFor((p) => { p.contact.type = 'friend-of-a-friend'; });
  if (errs.some((e) => e.includes('contact.type must be one of'))) {
    pass('an off-taxonomy contact type is refused');
  } else {
    fail('an off-taxonomy contact.type was accepted — contacts.mjs would report it as malformed');
  }
}

{
  const errs = errorsFor((p) => { p.contact.email = 'not-an-address'; });
  if (errs.some((e) => e.includes('not a valid address'))) {
    pass('a malformed email address is refused');
  } else {
    fail('a malformed email address was accepted');
  }
}

{
  // Gate 4: one approach per person per role. A loop that re-runs must not
  // turn into a repeat mailing.
  const log = '# date\ttracker#\tcompany\trole\temail\tstatus\tsubject\n'
    + '2026-08-20\t042\tAcme\tSenior Product Manager\tpriya@acme.com\tdrafted\tSenior PM\n';
  const errs = errorsFor(null, CV, log);
  if (errs.some((e) => e.includes('already drafted outreach'))) {
    pass('a second draft to the same person for the same role → refused');
  } else {
    fail('a repeat approach was allowed — an automation loop would become a repeat mailing');
  }
}

{
  // …but the same person for a DIFFERENT role is legitimate.
  const log = '# date\ttracker#\tcompany\trole\temail\tstatus\tsubject\n'
    + '2026-08-20\t007\tAcme\tPrincipal PM\tpriya@acme.com\tdrafted\tPrincipal PM\n';
  const r = validatePayload(base(), { cvText: CV, existingLog: log });
  if (r.ok) pass('the same contact for a different role is still allowed');
  else fail(`a legitimate second-role approach was refused: ${r.errors.join(' | ')}`);
}

{
  const r = validatePayload({ ...base(), contact: { ...base().contact, email: 'p@recruiters.example', source_url: 'https://acme.com/team' } }, { cvText: CV, existingLog: '' });
  if (r.ok && r.warnings.some((w) => w.includes('recruiters.example'))) {
    pass('an off-domain address warns but is not blocked (agency recruiters are real)');
  } else if (!r.ok) {
    fail('an off-domain address was blocked — agency recruiters use their own domains');
  } else {
    fail('an off-domain address produced no warning');
  }
}

// ── numericClaims behaviour ───────────────────────────────────────────────

{
  const claims = numericClaims('Grew it 40% over 18 months, from ₹1,20,000 to 3.5x that, since 2019.');
  const has = (t) => claims.includes(t);
  if (has('40%') && has('18') && has('120000') && has('3.5x') && !claims.includes('2019')) {
    pass(`numericClaims extracts figures and skips a bare year (${claims.join(', ')})`);
  } else {
    fail(`numericClaims wrong: ${claims.join(', ')}`);
  }
}

{
  // The CV being MORE specific than the email must not read as a mismatch.
  if (claimIsGrounded('40', ['40%']) && claimIsGrounded('40%', ['40%']) && !claimIsGrounded('41', ['40%'])) {
    pass('a bare number in the email is satisfied by the same figure with a unit in the CV');
  } else {
    fail('claimIsGrounded is wrong about unit-bearing CV figures');
  }
}

// ── contacts.tsv row shape ────────────────────────────────────────────────

{
  const row = contactRow(base()).split('\t');
  // contacts.mjs schema: name, company, type, title, phone, email, linkedin, tracker#, notes
  if (row.length === 9 && row[0] === 'Priya Sharma' && row[1] === 'Acme'
      && row[2] === 'hiring-manager' && row[5] === 'priya@acme.com' && row[7] === '042'
      && row[8].includes('https://acme.com/about/leadership')) {
    pass('contactRow matches the 9-column contacts.tsv schema and records the source');
  } else {
    fail(`contactRow drifted from the contacts.mjs schema: ${JSON.stringify(row)}`);
  }
}

{
  // Tabs or newlines in a field would shift every column after it.
  const p = base();
  p.contact.name = 'Priya\tSharma\nDirector';
  const row = contactRow(p).split('\t');
  if (row.length === 9) pass('embedded tabs/newlines are scrubbed, so columns cannot shift');
  else fail(`a field containing a tab shifted the columns: ${row.length} cells`);
}
